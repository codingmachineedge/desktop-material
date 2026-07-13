#!/usr/bin/env python3
"""Loopback-only GitHub fixture used by the P0 production UI gate.

The server exposes a deliberately small REST surface and delegates the exact
fixture repository path to ``git http-backend``. It never proxies requests and
admits only the explicitly modeled in-memory pull request and Actions mutations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import zipfile
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import parse_qs, unquote, urlsplit


OWNER = "material-fixture-owner"
REPOSITORY = "material-fixture"
FEATURE_BRANCH = "feature/material-verification"
DEFAULT_BRANCH = "main"
ACCOUNT_LOGIN = "material-verifier-p0"
ACCOUNT_ID = 7_130_701
WORKFLOW_ID = 84_001
WORKFLOW_RUN_ID = 84_101
WORKFLOW_JOB_ID = 84_201
ARTIFACT_ID = 84_301
WORKFLOW_RUN_COUNT = 52
SUCCESS_WORKFLOW_RUN_COUNT = 51
WORKFLOW_RUN_PAGE_SIZE = 50
WORKFLOW_RUN_SENTINEL_ID = WORKFLOW_RUN_ID + SUCCESS_WORKFLOW_RUN_COUNT - 1
INSPECTOR_WORKFLOW_RUN_ID = WORKFLOW_RUN_ID + WORKFLOW_RUN_COUNT - 1
INSPECTOR_LATEST_ATTEMPT = 2
INSPECTOR_JOB_COUNT = 51
INSPECTOR_JOB_PAGE_SIZE = 50
INSPECTOR_CURRENT_JOB_ID = 85_051
INSPECTOR_CURRENT_JOB_SENTINEL_ID = (
    INSPECTOR_CURRENT_JOB_ID + INSPECTOR_JOB_COUNT - 1
)
INSPECTOR_HISTORICAL_JOB_ID = 85_000
INSPECTOR_HISTORICAL_JOB_SENTINEL_ID = (
    INSPECTOR_HISTORICAL_JOB_ID + INSPECTOR_JOB_COUNT - 1
)
PENDING_ENVIRONMENT_IDS = (86_101, 86_102)
ARTIFACT_COUNT = 31
ARTIFACT_PAGE_SIZE = 30
ARTIFACT_SENTINEL_ID = ARTIFACT_ID + ARTIFACT_COUNT - 1
RULESET_IDS = (91_001, 91_002)
FIXTURE_TOKEN = "dm-p0-loopback-token-20260713"
FIXTURE_HTML_URL = "http://material-provider.invalid"
ENTERPRISE_VERSION = "3.17.2"
FIXED_TIME = "2026-07-13T14:30:00Z"
HEAD_SHA = "7" * 40
MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024
MAX_ROUTE_IDENTIFIER_DIGITS = 18


@dataclass(frozen=True)
class FixtureResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


def json_response(value: Any, status: int = HTTPStatus.OK) -> FixtureResponse:
    body = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return FixtureResponse(
        int(status),
        {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": str(len(body)),
        },
        body,
    )


def empty_response(status: int = HTTPStatus.NO_CONTENT) -> FixtureResponse:
    return FixtureResponse(int(status), {"Content-Length": "0"}, b"")


def text_response(
    value: str,
    status: int = HTTPStatus.OK,
    content_type: str = "text/plain; charset=utf-8",
) -> FixtureResponse:
    body = value.encode("utf-8")
    return FixtureResponse(
        int(status),
        {"Content-Type": content_type, "Content-Length": str(len(body))},
        body,
    )


def parse_route_identifier(value: str) -> int:
    """Parse a regex-validated decimal id without reaching Python's int limit."""

    return -1 if len(value) > MAX_ROUTE_IDENTIFIER_DIGITS else int(value)


def make_deterministic_artifact(path: Path) -> None:
    """Create a stable, harmless archive without relying on host timestamps."""

    path.parent.mkdir(parents=True, exist_ok=True)
    entries = {
        "reports/material-ui-gate.txt": (
            "Desktop Material P0 fixture\n"
            "Synthetic evidence only; no user or GitHub data is present.\n"
        ),
        "reports/viewport-results.json": json.dumps(
            {
                "regular": "pending-runtime-verification",
                "minimumWidth": "pending-runtime-verification",
                "zoom200": "pending-runtime-verification",
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name, (2026, 7, 13, 14, 30, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content.encode("utf-8"))
        # Stored deterministic bytes keep the transfer large enough for the
        # real UI to expose progress and cancellation without excessive disk
        # or memory use. No archive entry can escape the destination.
        payload = bytearray()
        counter = 0
        while len(payload) < 2 * 1024 * 1024:
            payload.extend(hashlib.sha256(f"material-p0-{counter}".encode()).digest())
            counter += 1
        info = zipfile.ZipInfo("reports/cancel-transfer.bin", (2026, 7, 13, 14, 30, 0))
        info.compress_type = zipfile.ZIP_STORED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, bytes(payload[: 2 * 1024 * 1024]))


class ProviderState:
    """Pure request dispatcher shared by the HTTP handler and unit tests."""

    def __init__(
        self,
        artifact_path: Path,
        *,
        html_url: str = FIXTURE_HTML_URL,
    ) -> None:
        self.artifact_path = artifact_path
        self.token = FIXTURE_TOKEN
        self.html_url = html_url.rstrip("/")
        self.pull_requests: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self.inspector_page_two_failures_remaining = 1
        self.pending_environment_ids = set(PENDING_ENVIRONMENT_IDS)
        self.review_history = [self._initial_review_history()]
        self.review_requests: list[dict[str, Any]] = []
        self.rerun_job_ids: set[int] = set()
        self.fork_approved = False
        self.artifact_bytes = artifact_path.read_bytes()
        self.artifact_hex_digest = hashlib.sha256(self.artifact_bytes).hexdigest()

    @property
    def repository_html_url(self) -> str:
        return f"{self.html_url}/{OWNER}/{REPOSITORY}"

    @property
    def repository_clone_url(self) -> str:
        return f"{self.html_url}/{OWNER}/{REPOSITORY}.git"

    @property
    def identity(self) -> dict[str, Any]:
        return {
            "id": ACCOUNT_ID,
            "login": ACCOUNT_LOGIN,
            "name": "Material Verification Account With Wrapped Identity",
            "email": "material-verifier@example.invalid",
            "avatar_url": "",
            "html_url": f"{self.html_url}/{ACCOUNT_LOGIN}",
            "type": "User",
            "plan": {"name": "enterprise"},
        }

    @property
    def repository(self) -> dict[str, Any]:
        return {
            "id": 7_130_702,
            "name": REPOSITORY,
            "full_name": f"{OWNER}/{REPOSITORY}",
            "private": True,
            "owner": {
                "id": 7_130_703,
                "login": OWNER,
                "avatar_url": "",
                "html_url": f"{self.html_url}/{OWNER}",
                "type": "Organization",
            },
            "html_url": self.repository_html_url,
            "clone_url": self.repository_clone_url,
            "ssh_url": f"git@material-provider.invalid:{OWNER}/{REPOSITORY}.git",
            "fork": False,
            "default_branch": DEFAULT_BRANCH,
            "pushed_at": FIXED_TIME,
            "has_issues": True,
            "has_pull_requests": True,
            "archived": False,
            "disabled": False,
            "pull_request_creation_policy": "all",
            "allow_merge_commit": True,
            "allow_squash_merge": True,
            "allow_rebase_merge": True,
            "permissions": {"admin": True, "push": True, "pull": True},
        }

    @property
    def workflow(self) -> dict[str, Any]:
        return {
            "id": WORKFLOW_ID,
            "name": "Production desktop viewport, artifact, and accessibility verification",
            "path": ".github/workflows/material-production-verification.yml",
            "state": "active",
            "html_url": f"{self.repository_html_url}/actions/workflows/{WORKFLOW_ID}",
            "created_at": FIXED_TIME,
            "updated_at": FIXED_TIME,
        }

    @property
    def workflow_run(self) -> dict[str, Any]:
        return self.workflow_run_for(0)

    def workflow_run_for(self, index: int) -> dict[str, Any]:
        if index < 0 or index >= WORKFLOW_RUN_COUNT:
            raise ValueError("Workflow run index is outside the fixture.")
        run_id = WORKFLOW_RUN_ID + index
        success = index < SUCCESS_WORKFLOW_RUN_COUNT
        sentinel = run_id == WORKFLOW_RUN_SENTINEL_ID
        inspector = run_id == INSPECTOR_WORKFLOW_RUN_ID
        branch = (
            "feature/material-verification-with-a-deliberately-long-page-two-"
            "sentinel-branch-name-that-must-wrap-without-clipping"
            if sentinel
            else FEATURE_BRANCH
        )
        title = (
            "Actions run inspector verifies attempt navigation, page-two job "
            "recovery, deployment review, fork approval, and zero sideways scrolling"
            if inspector
            else (
                "Page two sentinel verifies complete workflow run pagination, "
                "wrapped titles, wrapped branch names, and zero sideways scrolling"
                if sentinel
                else f"Production pagination fixture run {index + 1:02d}"
            )
        )
        actor = dict(self.identity)
        actor["login"] = (
            "material-verifier-with-a-deliberately-long-page-two-actor-identity"
            if sentinel
            else ACCOUNT_LOGIN
        )
        return {
            "id": run_id,
            "workflow_id": WORKFLOW_ID,
            "cancel_url": f"{self.repository_html_url}/actions/runs/{run_id}/cancel",
            "created_at": FIXED_TIME,
            "updated_at": FIXED_TIME,
            "logs_url": f"{self.repository_html_url}/actions/runs/{run_id}/logs",
            "name": self.workflow["name"],
            "display_title": title,
            "rerun_url": f"{self.repository_html_url}/actions/runs/{run_id}/rerun",
            "check_suite_id": 84_102 + index,
            "event": "pull_request",
            "run_number": 73 + index,
            "run_attempt": INSPECTOR_LATEST_ATTEMPT if inspector else 1,
            "head_branch": branch,
            "head_sha": HEAD_SHA,
            "status": "completed",
            "conclusion": (
                "neutral"
                if inspector and self.fork_approved
                else "action_required"
                if inspector
                else "success"
                if success
                else "failure"
            ),
            "html_url": f"{self.repository_html_url}/actions/runs/{run_id}",
            "actor": actor,
        }

    @property
    def artifact(self) -> dict[str, Any]:
        return self.artifact_for(0, WORKFLOW_RUN_ID)

    def artifact_for(self, index: int, workflow_run_id: int) -> dict[str, Any]:
        if index < 0 or index >= ARTIFACT_COUNT:
            raise ValueError("Artifact index is outside the fixture.")
        if not self.is_fixture_run_id(workflow_run_id):
            raise ValueError("Artifact workflow run is outside the fixture.")
        artifact_id = ARTIFACT_ID + index
        name = (
            "page-two-artifact-sentinel-with-a-deliberately-long-name-that-"
            "must-wrap-without-clipping-overlap-or-sideways-scrolling"
            if artifact_id == ARTIFACT_SENTINEL_ID
            else (
                "desktop-material-production-ui-evidence-with-long-wrapped-name"
                if index == 0
                else f"desktop-material-pagination-artifact-{index + 1:02d}"
            )
        )
        return {
            "id": artifact_id,
            "name": name,
            "size_in_bytes": len(self.artifact_bytes),
            "expired": False,
            "created_at": FIXED_TIME,
            "expires_at": "2027-07-13T14:30:00Z",
            "updated_at": FIXED_TIME,
            "digest": f"sha256:{self.artifact_hex_digest}",
            "workflow_run": {
                "id": workflow_run_id,
                "head_branch": FEATURE_BRANCH,
                "head_sha": HEAD_SHA,
            },
        }

    def _environment(self, environment_id: int) -> dict[str, Any]:
        if environment_id not in PENDING_ENVIRONMENT_IDS:
            raise ValueError("Pending environment is outside the fixture.")
        approvable = environment_id == PENDING_ENVIRONMENT_IDS[0]
        name = (
            "Production environment with an intentionally long responsive name "
            "that must wrap without clipping or sideways scrolling"
            if approvable
            else "Locked deployment environment that this account cannot approve"
        )
        reviewers: list[dict[str, Any]] = [
            {
                "type": "Team",
                "reviewer": {
                    "id": 86_201,
                    "name": "Release reviewers with a deliberately long responsive team name",
                    "slug": "release-reviewers",
                    "html_url": f"{self.html_url}/orgs/{OWNER}/teams/release-reviewers",
                },
            }
        ]
        if approvable:
            reviewers.append(
                {
                    "type": "User",
                    "reviewer": {
                        "id": ACCOUNT_ID,
                        "login": ACCOUNT_LOGIN,
                        "html_url": f"{self.html_url}/{ACCOUNT_LOGIN}",
                    },
                }
            )
        return {
            "environment": {
                "id": environment_id,
                "name": name,
                "html_url": (
                    f"{self.repository_html_url}/deployments/activity_log"
                    f"?environment={environment_id}"
                ),
            },
            "wait_timer": 15 if approvable else 0,
            "wait_timer_started_at": FIXED_TIME,
            "current_user_can_approve": approvable,
            "reviewers": reviewers,
        }

    def _review_user(self) -> dict[str, Any]:
        return {
            "id": ACCOUNT_ID,
            "login": ACCOUNT_LOGIN,
            "html_url": f"{self.html_url}/{ACCOUNT_LOGIN}",
        }

    def _reviewed_environment(self, environment_id: int) -> dict[str, Any]:
        environment = self._environment(environment_id)["environment"]
        return {
            "id": environment["id"],
            "name": environment["name"],
            "html_url": environment["html_url"],
        }

    def _initial_review_history(self) -> dict[str, Any]:
        return {
            "state": "rejected",
            "comment": (
                "Earlier synthetic evidence was held until the narrow viewport "
                "and page-two job log were both inspected."
            ),
            "environments": [
                self._reviewed_environment(PENDING_ENVIRONMENT_IDS[1])
            ],
            "user": self._review_user(),
        }

    def _pending_deployments(self) -> FixtureResponse:
        with self._lock:
            environment_ids = sorted(self.pending_environment_ids)
        return json_response(
            [self._environment(environment_id) for environment_id in environment_ids]
        )

    def _review_history_response(self) -> FixtureResponse:
        with self._lock:
            history = list(self.review_history)
        return json_response(history)

    def _review_pending_deployments(self, body: bytes) -> FixtureResponse:
        try:
            request = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return json_response({"message": "Invalid JSON"}, HTTPStatus.BAD_REQUEST)
        if not isinstance(request, dict) or set(request) != {
            "environment_ids",
            "state",
            "comment",
        }:
            return json_response(
                {"message": "Unexpected deployment review fields"},
                HTTPStatus.UNPROCESSABLE_ENTITY,
            )
        environment_ids = request["environment_ids"]
        state = request["state"]
        comment = request["comment"]
        if (
            environment_ids != [PENDING_ENVIRONMENT_IDS[0]]
            or state not in ("approved", "rejected")
            or not isinstance(comment, str)
            or not comment
            or len(comment) > 1_024
            or comment != comment.strip()
            or any(
                ord(value) < 9
                or ord(value) in {11, 12, 13, 127}
                or 14 <= ord(value) <= 31
                for value in comment
            )
        ):
            return json_response(
                {"message": "Invalid deployment review fields"},
                HTTPStatus.UNPROCESSABLE_ENTITY,
            )
        with self._lock:
            if PENDING_ENVIRONMENT_IDS[0] not in self.pending_environment_ids:
                return json_response(
                    {"message": "Deployment is no longer pending"},
                    HTTPStatus.CONFLICT,
                )
            self.pending_environment_ids.remove(PENDING_ENVIRONMENT_IDS[0])
            self.review_requests.append(request)
            self.review_history.append(
                {
                    "state": state,
                    "comment": comment,
                    "environments": [
                        self._reviewed_environment(PENDING_ENVIRONMENT_IDS[0])
                    ],
                    "user": self._review_user(),
                }
            )
        return empty_response()

    def inspector_job_for(self, index: int, attempt: int) -> dict[str, Any]:
        if index < 0 or index >= INSPECTOR_JOB_COUNT:
            raise ValueError("Inspector job index is outside the fixture.")
        if attempt not in {1, INSPECTOR_LATEST_ATTEMPT}:
            raise ValueError("Inspector job attempt is outside the fixture.")
        first_id = (
            INSPECTOR_CURRENT_JOB_ID
            if attempt == INSPECTOR_LATEST_ATTEMPT
            else INSPECTOR_HISTORICAL_JOB_ID
        )
        job_id = first_id + index
        sentinel = index == INSPECTOR_JOB_COUNT - 1
        conclusion = "failure" if sentinel else "success"
        name = (
            (
                "Page-two current-attempt Windows packaging sentinel with an "
                "intentionally long responsive name"
            )
            if sentinel and attempt == INSPECTOR_LATEST_ATTEMPT
            else (
                "Page-two historical-attempt Linux timeout sentinel with an "
                "intentionally long responsive name"
                if sentinel
                else f"Attempt {attempt} production verification job {index + 1:02d}"
            )
        )
        final_step = (
            "Verify a long job-step identity wraps without clipping, overlap, "
            "or horizontal document scrolling"
            if sentinel
            else "Verify deterministic fixture state"
        )
        return {
            "id": job_id,
            "run_id": INSPECTOR_WORKFLOW_RUN_ID,
            "name": name,
            "status": "completed",
            "conclusion": conclusion,
            "completed_at": FIXED_TIME,
            "started_at": FIXED_TIME,
            "html_url": (
                f"{self.repository_html_url}/actions/runs/"
                f"{INSPECTOR_WORKFLOW_RUN_ID}/job/{job_id}"
            ),
            "steps": [
                {
                    "name": "Check out the synthetic fixture repository",
                    "number": 1,
                    "status": "completed",
                    "conclusion": "success",
                    "completed_at": FIXED_TIME,
                    "started_at": FIXED_TIME,
                },
                {
                    "name": final_step,
                    "number": 2,
                    "status": "completed",
                    "conclusion": conclusion,
                    "completed_at": FIXED_TIME,
                    "started_at": FIXED_TIME,
                },
            ],
        }

    def _inspector_jobs(
        self,
        query: Mapping[str, list[str]],
        *,
        attempt: int,
        latest: bool,
    ) -> FixtureResponse:
        allowed = {"page", "per_page", "filter"} if latest else {"page", "per_page"}
        paging = self._page(
            query,
            expected_page_size=INSPECTOR_JOB_PAGE_SIZE,
            allowed=allowed,
        )
        if (
            paging is None
            or (latest and query.get("filter") != ["latest"])
            or (not latest and "filter" in query)
        ):
            return json_response(
                {"message": "Invalid workflow job pagination or attempt filter."},
                HTTPStatus.UNPROCESSABLE_ENTITY,
            )
        page, page_size = paging
        if latest and page == 2:
            with self._lock:
                if self.inspector_page_two_failures_remaining > 0:
                    self.inspector_page_two_failures_remaining -= 1
                    return json_response(
                        {"message": "Synthetic one-shot page-two service failure"},
                        HTTPStatus.SERVICE_UNAVAILABLE,
                    )
        jobs = [
            self.inspector_job_for(index, attempt)
            for index in range(INSPECTOR_JOB_COUNT)
        ]
        start = (page - 1) * page_size
        return json_response(
            {
                "total_count": len(jobs),
                "jobs": jobs[start : start + page_size],
            }
        )

    @staticmethod
    def is_inspector_job_id(value: int) -> bool:
        return (
            INSPECTOR_HISTORICAL_JOB_ID
            <= value
            <= INSPECTOR_HISTORICAL_JOB_SENTINEL_ID
            or INSPECTOR_CURRENT_JOB_ID
            <= value
            <= INSPECTOR_CURRENT_JOB_SENTINEL_ID
        )

    def inspector_job_log(self, job_id: int) -> str:
        if not self.is_inspector_job_id(job_id):
            raise ValueError("Inspector job log is outside the fixture.")
        return (
            "2026-07-13T14:30:00.000Z ##[group]Desktop Material production UI gate\n"
            "2026-07-13T14:30:00.100Z \u001b[32mLoopback fixture authenticated\u001b[0m\n"
            f"2026-07-13T14:30:00.200Z Exact workflow job {job_id}\n"
            "2026-07-13T14:30:00.300Z No credentials or user data are present.\n"
            "2026-07-13T14:30:00.400Z Long log content wraps inside the owned "
            "viewer without widening the document or overlapping search controls.\n"
            "2026-07-13T14:30:00.500Z ##[endgroup]\n"
        )

    @staticmethod
    def is_fixture_run_id(value: int) -> bool:
        return WORKFLOW_RUN_ID <= value < WORKFLOW_RUN_ID + WORKFLOW_RUN_COUNT

    @staticmethod
    def is_fixture_artifact_id(value: int) -> bool:
        return ARTIFACT_ID <= value < ARTIFACT_ID + ARTIFACT_COUNT

    @staticmethod
    def _page(
        query: Mapping[str, list[str]],
        *,
        expected_page_size: int,
        allowed: set[str],
    ) -> tuple[int, int] | None:
        if any(key not in allowed for key in query):
            return None
        page_values = query.get("page", ["1"])
        size_values = query.get("per_page", [str(expected_page_size)])
        if len(page_values) != 1 or len(size_values) != 1:
            return None
        try:
            page = int(page_values[0])
            page_size = int(size_values[0])
        except ValueError:
            return None
        if page < 1 or page > 1_000_000 or page_size != expected_page_size:
            return None
        return page, page_size

    def _workflow_runs(self, query: Mapping[str, list[str]]) -> FixtureResponse:
        allowed = {"page", "per_page", "branch", "event", "status"}
        paging = self._page(
            query,
            expected_page_size=WORKFLOW_RUN_PAGE_SIZE,
            allowed=allowed,
        )
        if paging is None or any(len(query.get(key, [])) > 1 for key in allowed):
            return json_response(
                {"message": "Invalid workflow run pagination or filter."},
                HTTPStatus.UNPROCESSABLE_ENTITY,
            )
        page, page_size = paging
        runs = [self.workflow_run_for(index) for index in range(WORKFLOW_RUN_COUNT)]
        branch = query.get("branch", [None])[0]
        event = query.get("event", [None])[0]
        status = query.get("status", [None])[0]
        if branch is not None:
            runs = [run for run in runs if run["head_branch"] == branch]
        if event is not None:
            runs = [run for run in runs if run["event"] == event]
        if status is not None:
            if status in {"success", "failure"}:
                runs = [run for run in runs if run["conclusion"] == status]
            else:
                runs = [run for run in runs if run["status"] == status]
        start = (page - 1) * page_size
        return json_response(
            {
                "total_count": len(runs),
                "workflow_runs": runs[start : start + page_size],
            }
        )

    def _artifacts(
        self,
        query: Mapping[str, list[str]],
        workflow_run_id: int,
    ) -> FixtureResponse:
        paging = self._page(
            query,
            expected_page_size=ARTIFACT_PAGE_SIZE,
            allowed={"page", "per_page"},
        )
        if paging is None:
            return json_response(
                {"message": "Invalid artifact pagination."},
                HTTPStatus.UNPROCESSABLE_ENTITY,
            )
        page, page_size = paging
        artifacts = [
            self.artifact_for(index, workflow_run_id)
            for index in range(ARTIFACT_COUNT)
        ]
        start = (page - 1) * page_size
        return json_response(
            {
                "total_count": len(artifacts),
                "artifacts": artifacts[start : start + page_size],
            }
        )

    def _authorized(self, headers: Mapping[str, str]) -> bool:
        authorization = next(
            (value for key, value in headers.items() if key.lower() == "authorization"),
            "",
        )
        return authorization == f"Bearer {self.token}"

    def _branch_rules(self) -> list[dict[str, Any]]:
        long_check = "ci/material-desktop-production-viewport-geometry-and-accessibility"
        return [
            {
                "ruleset_id": RULESET_IDS[0],
                "type": "required_status_checks",
                "parameters": {
                    "required_status_checks": [
                        {"context": long_check},
                        {"context": "security/loopback-artifact-integrity"},
                    ],
                    "strict_required_status_checks_policy": True,
                },
            },
            {
                "ruleset_id": RULESET_IDS[0],
                "type": "pull_request",
                "parameters": {
                    "required_approving_review_count": 2,
                    "dismiss_stale_reviews_on_push": True,
                    "require_code_owner_review": True,
                    "require_last_push_approval": True,
                    "required_review_thread_resolution": True,
                },
            },
            {"ruleset_id": RULESET_IDS[0], "type": "required_signatures"},
            {"ruleset_id": RULESET_IDS[0], "type": "required_linear_history"},
            {"ruleset_id": RULESET_IDS[0], "type": "non_fast_forward"},
            {"ruleset_id": RULESET_IDS[0], "type": "deletion"},
            {
                "ruleset_id": RULESET_IDS[1],
                "type": "merge_queue",
                "parameters": {
                    "check_response_timeout_minutes": 60,
                    "grouping_strategy": "ALLGREEN",
                    "max_entries_to_build": 5,
                    "max_entries_to_merge": 5,
                    "merge_method": "SQUASH",
                    "min_entries_to_merge": 1,
                    "min_entries_to_merge_wait_minutes": 5,
                },
            },
            {
                "ruleset_id": RULESET_IDS[1],
                "type": "required_deployments",
                "parameters": {
                    "required_deployment_environments": [
                        "github-pages-production-environment-with-wrapped-name"
                    ]
                },
            },
            {
                "ruleset_id": RULESET_IDS[1],
                "type": "branch_name_pattern",
                "parameters": {
                    "operator": "starts_with",
                    "pattern": "feature/material-",
                    "negate": False,
                },
            },
        ]

    def _classic_protection(self) -> dict[str, Any]:
        return {
            "required_status_checks": {
                "strict": True,
                "contexts": ["classic/material-build-and-unit-tests"],
                "checks": [{"context": "classic/material-build-and-unit-tests"}],
            },
            "required_pull_request_reviews": {
                "dismiss_stale_reviews": True,
                "require_code_owner_reviews": True,
                "required_approving_review_count": 2,
                "require_last_push_approval": True,
                "dismissal_restrictions": {"users": [], "teams": [], "apps": []},
                "bypass_pull_request_allowances": {"users": [], "teams": [], "apps": []},
            },
            "required_signatures": {"enabled": True},
            "required_linear_history": {"enabled": True},
            "allow_force_pushes": {"enabled": False},
            "allow_deletions": {"enabled": False},
            "required_conversation_resolution": {"enabled": True},
            "lock_branch": {"enabled": False},
            "allow_fork_syncing": {"enabled": False},
            "enforce_admins": {"enabled": True},
        }

    def dispatch(
        self,
        method: str,
        raw_target: str,
        headers: Mapping[str, str],
        body: bytes = b"",
    ) -> FixtureResponse:
        parsed = urlsplit(raw_target)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query, keep_blank_values=True)
        log_download_match = re.fullmatch(r"/downloads/actions/jobs/(\d+)/logs", path)
        if method == "GET" and log_download_match is not None and not query:
            job_id = parse_route_identifier(log_download_match.group(1))
            if not self.is_inspector_job_id(job_id):
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            return text_response(self.inspector_job_log(job_id))
        api_prefix = "/api/v3"
        if not path.startswith(api_prefix):
            return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
        if method == "OPTIONS":
            return empty_response(HTTPStatus.NO_CONTENT)
        if not self._authorized(headers):
            return json_response({"message": "Bad credentials"}, HTTPStatus.UNAUTHORIZED)

        resource = path[len(api_prefix) :] or "/"
        repo_root = f"/repos/{OWNER}/{REPOSITORY}"

        if method == "HEAD" and resource in {"/meta", f"{repo_root}/git"}:
            return empty_response(HTTPStatus.OK)
        if method == "GET" and resource == "/user":
            return json_response(self.identity)
        if method == "GET" and resource == "/user/emails":
            return json_response(
                [
                    {
                        "email": "material-verifier@example.invalid",
                        "verified": True,
                        "primary": True,
                        "visibility": "private",
                    }
                ]
            )
        if method == "GET" and resource == "/user/repos":
            return json_response([self.repository])
        if method == "GET" and resource in {"/user/orgs", "/organizations", "/notifications"}:
            return json_response([])
        if method == "GET" and resource == "/desktop_internal/features":
            return json_response({"features": []})
        if method == "POST" and resource == "/graphql":
            return json_response(
                {
                    "data": {
                        "viewer": {
                            "copilotEndpoints": {"api": ""},
                            "copilotLicenseType": "none",
                            "isCopilotDesktopEnabled": False,
                        }
                    }
                }
            )
        if method == "GET" and resource == repo_root:
            return json_response(self.repository)
        if method == "GET" and resource == f"{repo_root}/branches":
            branches = [
                {"name": DEFAULT_BRANCH, "protected": True},
                {"name": FEATURE_BRANCH, "protected": True},
            ]
            if query.get("protected") == ["true"]:
                return json_response(branches)
            return json_response(branches)

        branch_prefix = f"{repo_root}/branches/{FEATURE_BRANCH}"
        if method == "GET" and resource == branch_prefix:
            return json_response(
                {"name": FEATURE_BRANCH, "protected": True, "commit": {"sha": HEAD_SHA}}
            )
        if method == "GET" and resource == f"{branch_prefix}/protection":
            return json_response(self._classic_protection())
        if method == "GET" and resource == f"{branch_prefix}/push_control":
            return json_response(
                {
                    "pattern": FEATURE_BRANCH,
                    "required_signatures": True,
                    "required_status_checks": [
                        "classic/material-build-and-unit-tests"
                    ],
                    "required_approving_review_count": 2,
                    "required_linear_history": True,
                    "allow_actor": True,
                    "allow_deletions": False,
                    "allow_force_pushes": False,
                }
            )
        if method == "GET" and resource == f"{repo_root}/rules/branches/{FEATURE_BRANCH}":
            return json_response(self._branch_rules())
        if method == "GET" and resource == f"{repo_root}/rulesets":
            return json_response([{"id": value} for value in RULESET_IDS])
        if method == "GET" and resource == f"{repo_root}/rulesets/{RULESET_IDS[0]}":
            return json_response(
                {
                    "id": RULESET_IDS[0],
                    "name": "Production integrity, review, and signed-history policy",
                    "source_type": "Repository",
                    "source": f"{OWNER}/{REPOSITORY}",
                    "current_user_can_bypass": "never",
                    "_links": {
                        "html": {
                            "href": f"{self.repository_html_url}/settings/rules/{RULESET_IDS[0]}"
                        }
                    },
                }
            )
        if method == "GET" and resource == f"{repo_root}/rulesets/{RULESET_IDS[1]}":
            return json_response(
                {
                    "id": RULESET_IDS[1],
                    "name": "Merge queue, deployment, and branch naming policy with deliberately long identity",
                    "source_type": "Organization",
                    "source": OWNER,
                    "current_user_can_bypass": "pull_requests_only",
                    "_links": {
                        "html": {
                            "href": f"{self.html_url}/organizations/{OWNER}/settings/rules/{RULESET_IDS[1]}"
                        }
                    },
                }
            )

        if method == "GET" and resource == f"{repo_root}/actions/workflows":
            return json_response({"total_count": 1, "workflows": [self.workflow]})
        if method == "GET" and resource in {
            f"{repo_root}/actions/runs",
            f"{repo_root}/actions/workflows/{WORKFLOW_ID}/runs",
        }:
            return self._workflow_runs(query)

        jobs_match = re.fullmatch(
            re.escape(f"{repo_root}/actions/runs/") + r"(\d+)/jobs",
            resource,
        )
        if method == "GET" and jobs_match is not None:
            run_id = parse_route_identifier(jobs_match.group(1))
            if not self.is_fixture_run_id(run_id):
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            if run_id == INSPECTOR_WORKFLOW_RUN_ID:
                return self._inspector_jobs(
                    query,
                    attempt=INSPECTOR_LATEST_ATTEMPT,
                    latest=True,
                )
            if query:
                paging = self._page(
                    query,
                    expected_page_size=INSPECTOR_JOB_PAGE_SIZE,
                    allowed={"page", "per_page", "filter"},
                )
                if paging is None or query.get("filter") != ["latest"]:
                    return json_response(
                        {"message": "Invalid workflow job pagination."},
                        HTTPStatus.UNPROCESSABLE_ENTITY,
                    )
                page, _page_size = paging
            else:
                page = 1
            job_id = WORKFLOW_JOB_ID + (run_id - WORKFLOW_RUN_ID)
            return json_response(
                {
                    "total_count": 1,
                    "jobs": (
                        [
                            {
                                "id": job_id,
                                "run_id": run_id,
                                "name": "Verify regular, narrow, short, and 200 percent viewport layouts",
                                "status": "completed",
                                "conclusion": "success",
                                "completed_at": FIXED_TIME,
                                "started_at": FIXED_TIME,
                                "html_url": f"{self.repository_html_url}/actions/runs/{run_id}/job/{job_id}",
                                "steps": [],
                            }
                        ]
                        if page == 1
                        else []
                    ),
                }
            )

        historical_jobs_match = re.fullmatch(
            re.escape(f"{repo_root}/actions/runs/")
            + r"(\d+)/attempts/(\d+)/jobs",
            resource,
        )
        if method == "GET" and historical_jobs_match is not None:
            run_id = parse_route_identifier(historical_jobs_match.group(1))
            attempt = parse_route_identifier(historical_jobs_match.group(2))
            if run_id != INSPECTOR_WORKFLOW_RUN_ID or attempt != 1:
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            return self._inspector_jobs(query, attempt=attempt, latest=False)

        run_pending_match = re.fullmatch(
            re.escape(f"{repo_root}/actions/runs/")
            + r"(\d+)/pending_deployments",
            resource,
        )
        if run_pending_match is not None:
            run_id = parse_route_identifier(run_pending_match.group(1))
            if run_id != INSPECTOR_WORKFLOW_RUN_ID or query:
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            if method == "GET":
                return self._pending_deployments()
            if method == "POST":
                return self._review_pending_deployments(body)

        run_approvals_match = re.fullmatch(
            re.escape(f"{repo_root}/actions/runs/") + r"(\d+)/approvals",
            resource,
        )
        if method == "GET" and run_approvals_match is not None:
            run_id = parse_route_identifier(run_approvals_match.group(1))
            if run_id != INSPECTOR_WORKFLOW_RUN_ID or query:
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            return self._review_history_response()

        job_logs_match = re.fullmatch(
            re.escape(f"{repo_root}/actions/jobs/") + r"(\d+)/logs",
            resource,
        )
        if method == "GET" and job_logs_match is not None:
            job_id = parse_route_identifier(job_logs_match.group(1))
            if not self.is_inspector_job_id(job_id) or query:
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            return FixtureResponse(
                int(HTTPStatus.FOUND),
                {
                    "Content-Length": "0",
                    "Location": f"/downloads/actions/jobs/{job_id}/logs",
                },
                b"",
            )

        rerun_job_match = re.fullmatch(
            re.escape(f"{repo_root}/actions/jobs/") + r"(\d+)/rerun",
            resource,
        )
        if method == "POST" and rerun_job_match is not None:
            job_id = parse_route_identifier(rerun_job_match.group(1))
            if job_id not in {
                INSPECTOR_CURRENT_JOB_SENTINEL_ID,
                INSPECTOR_HISTORICAL_JOB_SENTINEL_ID,
            } or query:
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            if body:
                return json_response(
                    {"message": "Job re-run body must be empty"},
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                )
            with self._lock:
                if job_id in self.rerun_job_ids:
                    return json_response(
                        {"message": "Job re-run was already requested"},
                        HTTPStatus.CONFLICT,
                    )
                self.rerun_job_ids.add(job_id)
            return empty_response(HTTPStatus.CREATED)

        approve_run_match = re.fullmatch(
            re.escape(f"{repo_root}/actions/runs/") + r"(\d+)/approve",
            resource,
        )
        if method == "POST" and approve_run_match is not None:
            run_id = parse_route_identifier(approve_run_match.group(1))
            if run_id != INSPECTOR_WORKFLOW_RUN_ID or query:
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            if body:
                return json_response(
                    {"message": "Fork approval body must be empty"},
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                )
            with self._lock:
                if self.fork_approved:
                    return json_response(
                        {"message": "Fork run is already approved"},
                        HTTPStatus.CONFLICT,
                    )
                self.fork_approved = True
            return empty_response()

        artifacts_match = re.fullmatch(
            re.escape(f"{repo_root}/actions/runs/") + r"(\d+)/artifacts",
            resource,
        )
        if method == "GET" and artifacts_match is not None:
            run_id = parse_route_identifier(artifacts_match.group(1))
            if not self.is_fixture_run_id(run_id):
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            return self._artifacts(query, run_id)

        download_match = re.fullmatch(
            re.escape(f"{repo_root}/actions/artifacts/") + r"(\d+)/zip",
            resource,
        )
        if method == "GET" and download_match is not None:
            artifact_id = parse_route_identifier(download_match.group(1))
            if not self.is_fixture_artifact_id(artifact_id):
                return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)
            return FixtureResponse(
                HTTPStatus.OK,
                {
                    "Content-Type": "application/zip",
                    "Content-Length": str(len(self.artifact_bytes)),
                },
                self.artifact_bytes,
            )
        if method == "GET" and resource == f"{repo_root}/attestations/sha256:{self.artifact_hex_digest}":
            return json_response({"attestations": [{"fixture": True}]})

        if method == "GET" and resource == f"{repo_root}/pulls":
            # The creation receipt is intentionally in-memory only. Returning
            # a partial PR object to a background list refresh would violate
            # the larger IAPIPullRequest contract, so the list remains empty.
            return json_response([])
        if method == "GET" and resource in {
            f"{repo_root}/issues",
            f"{repo_root}/labels",
            f"{repo_root}/milestones",
            f"{repo_root}/mentionables/users",
        }:
            return json_response([])
        if method == "POST" and resource == f"{repo_root}/pulls":
            try:
                request = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return json_response({"message": "Invalid JSON"}, HTTPStatus.BAD_REQUEST)
            expected_keys = {"title", "body", "head", "base", "draft"}
            if not isinstance(request, dict) or set(request) != expected_keys:
                return json_response(
                    {"message": "Unexpected pull request fields"},
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                )
            if (
                not isinstance(request["title"], str)
                or not request["title"]
                or not isinstance(request["body"], str)
                or not isinstance(request["head"], str)
                or not isinstance(request["base"], str)
                or not isinstance(request["draft"], bool)
            ):
                return json_response(
                    {"message": "Invalid pull request fields"},
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                )
            if (
                request["head"] != FEATURE_BRANCH
                or request["base"] != DEFAULT_BRANCH
            ):
                return json_response(
                    {"message": "Pull request refs do not match the fixture"},
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                )
            with self._lock:
                number = 73 + len(self.pull_requests)
                head = request["head"]
                head_ref = head.split(":", 1)[-1]
                head_label = head if ":" in head else f"{OWNER}:{head}"
                created = {
                    "number": number,
                    "title": request["title"],
                    "body": request["body"],
                    "state": "open",
                    "draft": request["draft"],
                    "head": {"ref": head_ref, "label": head_label},
                    "base": {"ref": request["base"]},
                    "html_url": f"{self.repository_html_url}/pull/{number}",
                }
                self.pull_requests.append(created)
            return json_response(created, HTTPStatus.CREATED)

        if method in {"POST", "PUT", "PATCH", "DELETE"}:
            return json_response(
                {"message": "Mutation is not enabled in this fixture"},
                HTTPStatus.METHOD_NOT_ALLOWED,
            )
        return json_response({"message": "Not Found"}, HTTPStatus.NOT_FOUND)


class FixtureHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        state: ProviderState,
        git_project_root: Path,
        request_log: Path,
        git_executable: str,
    ) -> None:
        super().__init__(address, FixtureRequestHandler)
        self.state = state
        self.git_project_root = git_project_root
        self.request_log = request_log
        self.git_executable = git_executable
        self.log_lock = threading.Lock()

    def append_log(self, entry: Mapping[str, Any]) -> None:
        with self.log_lock:
            self.request_log.parent.mkdir(parents=True, exist_ok=True)
            with self.request_log.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(json.dumps(entry, sort_keys=True) + "\n")


class FixtureRequestHandler(BaseHTTPRequestHandler):
    server: FixtureHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def do_HEAD(self) -> None:  # noqa: N802
        self._handle()

    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()

    def do_PUT(self) -> None:  # noqa: N802
        self._handle()

    def do_PATCH(self) -> None:  # noqa: N802
        self._handle()

    def do_DELETE(self) -> None:  # noqa: N802
        self._handle()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._handle()

    def _read_body(self) -> tuple[bytes, FixtureResponse | None]:
        if self.headers.get("Transfer-Encoding") is not None:
            return b"", json_response(
                {"message": "Chunked request bodies are not supported"},
                HTTPStatus.BAD_REQUEST,
            )
        value = self.headers.get("Content-Length")
        if value is None:
            return b"", None
        if re.fullmatch(r"\d+", value) is None:
            return b"", json_response(
                {"message": "Invalid Content-Length"},
                HTTPStatus.BAD_REQUEST,
            )
        normalized_value = value.lstrip("0") or "0"
        if len(normalized_value) > len(str(MAX_REQUEST_BODY_BYTES)):
            return b"", json_response(
                {"message": "Request body is too large"},
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            )
        length = int(normalized_value)
        if length > MAX_REQUEST_BODY_BYTES:
            return b"", json_response(
                {"message": "Request body is too large"},
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            )
        body = self.rfile.read(length)
        if len(body) != length:
            return b"", json_response(
                {"message": "Incomplete request body"},
                HTTPStatus.BAD_REQUEST,
            )
        return body, None

    def _is_git_request(self) -> bool:
        parsed = urlsplit(self.path)
        prefix = f"/{OWNER}/{REPOSITORY}.git"
        if parsed.scheme and (
            parsed.scheme != "http"
            or parsed.netloc not in {"material-provider.invalid", "localhost"}
        ):
            return False
        return (
            parsed.path == prefix
            or parsed.path.startswith(prefix + "/")
        ) and ".." not in unquote(parsed.path).split("/")

    def _handle(self) -> None:
        body, body_error = self._read_body()
        if body_error is not None:
            self.close_connection = True
            body_error = FixtureResponse(
                body_error.status,
                {**body_error.headers, "Connection": "close"},
                body_error.body,
            )
            self.server.append_log(
                {
                    "kind": "api",
                    "method": self.command,
                    "path": self.path,
                    "status": int(body_error.status),
                    "authorized": self.server.state._authorized(
                        dict(self.headers.items())
                    ),
                    "body_sha256": None,
                }
            )
            self._send(body_error, include_body=self.command != "HEAD")
            return
        if self._is_git_request():
            self._serve_git_backend(body)
            return
        response = self.server.state.dispatch(
            self.command,
            self.path,
            dict(self.headers.items()),
            body,
        )
        self.server.append_log(
            {
                "kind": "api",
                "method": self.command,
                "path": self.path,
                "status": int(response.status),
                "authorized": self.server.state._authorized(dict(self.headers.items())),
                "body_sha256": hashlib.sha256(body).hexdigest() if body else None,
            }
        )
        self._send(response, include_body=self.command != "HEAD")

    def _serve_git_backend(self, body: bytes) -> None:
        parsed = urlsplit(self.path)
        if (
            parse_qs(parsed.query).get("service") == ["git-receive-pack"]
            or parsed.path.endswith("/git-receive-pack")
        ):
            response = json_response(
                {"message": "Git pushes are disabled for this fixture"},
                HTTPStatus.FORBIDDEN,
            )
            self.server.append_log(
                {
                    "kind": "git",
                    "method": self.command,
                    "path": self.path,
                    "status": int(HTTPStatus.FORBIDDEN),
                    "returncode": None,
                    "stderr": None,
                }
            )
            self._send(response)
            return
        env = os.environ.copy()
        env.update(
            {
                "GIT_PROJECT_ROOT": str(self.server.git_project_root),
                "GIT_HTTP_EXPORT_ALL": "1",
                "PATH_INFO": unquote(parsed.path),
                "QUERY_STRING": parsed.query,
                "REQUEST_METHOD": self.command,
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": str(len(body)),
                "REMOTE_ADDR": self.client_address[0],
                "SERVER_NAME": self.server.server_address[0],
                "SERVER_PORT": str(self.server.server_address[1]),
                "SERVER_PROTOCOL": self.request_version,
            }
        )
        process = subprocess.run(
            [self.server.git_executable, "http-backend"],
            input=body,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            check=False,
            timeout=30,
        )
        output = process.stdout
        separator = b"\r\n\r\n" if b"\r\n\r\n" in output else b"\n\n"
        if separator not in output:
            response = json_response(
                {"message": "Git backend failed"},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            self.server.append_log(
                {
                    "kind": "git",
                    "method": self.command,
                    "path": self.path,
                    "status": 500,
                    "returncode": process.returncode,
                    "stderr": process.stderr.decode("utf-8", "replace")[-2000:],
                }
            )
            self._send(response)
            return

        raw_headers, response_body = output.split(separator, 1)
        status = HTTPStatus.OK
        headers: dict[str, str] = {}
        for raw_line in raw_headers.replace(b"\r", b"").split(b"\n"):
            if not raw_line:
                continue
            name, _, value = raw_line.decode("latin-1").partition(":")
            value = value.strip()
            if name.lower() == "status":
                status = int(value.split(" ", 1)[0])
            elif name.lower() not in {"connection", "transfer-encoding"}:
                headers[name] = value
        headers["Content-Length"] = str(len(response_body))
        self.server.append_log(
            {
                "kind": "git",
                "method": self.command,
                "path": self.path,
                "status": int(status),
                "returncode": process.returncode,
                "stderr": process.stderr.decode("utf-8", "replace")[-2000:] or None,
            }
        )
        self._send(
            FixtureResponse(int(status), headers, response_body),
            include_body=self.command != "HEAD",
        )

    def _send(self, response: FixtureResponse, *, include_body: bool = True) -> None:
        self.send_response(int(response.status))
        for name, value in response.headers.items():
            self.send_header(name, value)
        self.send_header("X-GitHub-Request-Id", "DM-P0-LOCAL-20260713")
        self.send_header("X-GitHub-Enterprise-Version", ENTERPRISE_VERSION)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Accept, Authorization, Content-Type, GraphQL-Features, If-None-Match, X-GitHub-Api-Version",
        )
        self.send_header(
            "Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST"
        )
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header(
            "Access-Control-Expose-Headers",
            "ETag, Link, X-GitHub-Enterprise-Version, X-GitHub-Request-Id, X-Poll-Interval",
        )
        self.end_headers()
        if include_body and response.body:
            if re.search(r"/actions/artifacts/\d+/zip(?:\?|$)", self.path):
                for offset in range(0, len(response.body), 32 * 1024):
                    self.wfile.write(response.body[offset : offset + 32 * 1024])
                    self.wfile.flush()
                    time.sleep(0.02)
            else:
                self.wfile.write(response.body)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--git-project-root", type=Path, required=True)
    parser.add_argument("--artifact-file", type=Path, required=True)
    parser.add_argument("--request-log", type=Path, required=True)
    parser.add_argument("--ready-file", type=Path, required=True)
    parser.add_argument("--html-url", default=FIXTURE_HTML_URL)
    parser.add_argument("--git", default="git")
    return parser.parse_args(argv)


def ensure_contained(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    resolved.relative_to(root.resolve())
    return resolved


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.bind != "127.0.0.1":
        raise SystemExit("The fixture provider may bind only to a loopback address.")
    if args.html_url.rstrip("/") != FIXTURE_HTML_URL:
        raise SystemExit(
            f"The fixture HTML URL must remain {FIXTURE_HTML_URL}."
        )
    owned_root = args.ready_file.resolve().parent.parent
    expected_prefix = "desktop-material-p0-ui-"
    if not owned_root.name.startswith(expected_prefix):
        raise SystemExit("The fixture provider requires its named owned run root.")
    temp_root = Path(os.environ["TEMP"]).resolve()
    try:
        owned_root.relative_to(temp_root)
    except ValueError as error:
        raise SystemExit("The fixture provider run root must remain under TEMP.") from error

    git_project_root = ensure_contained(args.git_project_root, owned_root)
    if not git_project_root.is_dir():
        raise SystemExit(f"Git project root does not exist: {git_project_root}")
    bare_repository = git_project_root / OWNER / f"{REPOSITORY}.git"
    if not bare_repository.is_dir() or not (bare_repository / "config").is_file():
        raise SystemExit("The exact fixture bare repository does not exist.")
    receive_pack = subprocess.run(
        [args.git, "-C", str(bare_repository), "config", "--bool", "http.receivepack"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
        timeout=10,
    )
    if receive_pack.returncode != 0 or receive_pack.stdout.strip() != "false":
        raise SystemExit("The fixture bare repository must disable HTTP pushes.")

    artifact_file = ensure_contained(args.artifact_file, owned_root)
    request_log = ensure_contained(args.request_log, owned_root)
    ready_file = ensure_contained(args.ready_file, owned_root)
    make_deterministic_artifact(artifact_file)
    state = ProviderState(artifact_file, html_url=args.html_url)
    server = FixtureHTTPServer(
        (args.bind, args.port),
        state,
        git_project_root,
        request_log,
        args.git,
    )
    host, port = server.server_address[:2]
    endpoint = f"http://localhost:{port}/api/v3"
    ready = {
        "pid": os.getpid(),
        "bind": host,
        "port": port,
        "endpoint": endpoint,
        "htmlUrl": args.html_url,
        "owner": OWNER,
        "repository": REPOSITORY,
        "featureBranch": FEATURE_BRANCH,
        "defaultBranch": DEFAULT_BRANCH,
        "accountLogin": ACCOUNT_LOGIN,
        "accountId": ACCOUNT_ID,
        "credentialService": f"GitHub Desktop Dev - {endpoint}",
        "token": FIXTURE_TOKEN,
        "workflowRunId": WORKFLOW_RUN_ID,
        "workflowRunCount": WORKFLOW_RUN_COUNT,
        "successfulWorkflowRunCount": SUCCESS_WORKFLOW_RUN_COUNT,
        "workflowRunSentinelId": WORKFLOW_RUN_SENTINEL_ID,
        "inspectorWorkflowRunId": INSPECTOR_WORKFLOW_RUN_ID,
        "inspectorLatestAttempt": INSPECTOR_LATEST_ATTEMPT,
        "inspectorJobCount": INSPECTOR_JOB_COUNT,
        "inspectorCurrentJobId": INSPECTOR_CURRENT_JOB_ID,
        "inspectorCurrentJobSentinelId": INSPECTOR_CURRENT_JOB_SENTINEL_ID,
        "inspectorHistoricalJobId": INSPECTOR_HISTORICAL_JOB_ID,
        "inspectorHistoricalJobSentinelId": INSPECTOR_HISTORICAL_JOB_SENTINEL_ID,
        "pendingEnvironmentIds": list(PENDING_ENVIRONMENT_IDS),
        "artifactId": ARTIFACT_ID,
        "artifactCount": ARTIFACT_COUNT,
        "artifactSentinelId": ARTIFACT_SENTINEL_ID,
        "artifactSize": len(state.artifact_bytes),
        "artifactDigest": f"sha256:{state.artifact_hex_digest}",
    }
    ready_file.parent.mkdir(parents=True, exist_ok=True)
    ready_file.write_text(json.dumps(ready, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in ready.items() if key != "token"}), flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
