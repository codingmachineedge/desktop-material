#!/usr/bin/env python3
"""Deterministic loopback-only GitLab merge-request API fixture.

The fixture implements the bounded subset of GitLab REST v4 used by Desktop
Material's merge-request workspace. It never contacts GitLab, keeps all API
state in memory, and writes only normalized, credential-free audit records.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import select
import socket
import sys
import threading
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import parse_qs, quote, urlencode, urlsplit


LOOPBACK_ADDRESS = "127.0.0.1"
FIXTURE_ID = "desktop-material-gitlab-mr"
FIXTURE_PROTOCOL_VERSION = 1
API_PREFIX = "/api/v4"
PRIVATE_TOKEN = "desktop-material-gitlab-token"
PROJECT_ID = 4242
PROJECT_PATH = "material-labs/platform/desktop-material"
ENCODED_PROJECT_PATH = quote(PROJECT_PATH, safe="")
FIXED_TIME = "2026-07-20T16:00:00.000Z"
MAX_REQUEST_BODY_BYTES = 64 * 1024
MAX_PAGE = 1_000
MAX_PER_PAGE = 100
MAX_OFFSET = 10_000
DEFAULT_RESPONSE_DELAY_MS = 600
MAX_RESPONSE_DELAY_MS = 2_000
OWNED_DIRECTORY_NAME = "gitlab-mr"
READY_FILE_NAME = "ready.json"
MUTATION_LOG_FILE_NAME = "mutations.jsonl"
RUN_ROOT_PATTERN = re.compile(
    r"desktop-material-gitlab-mr-[a-z0-9][a-z0-9._-]{5,120}\Z",
    re.IGNORECASE,
)
FAULT_MODES = (
    "none",
    "unavailable",
    "error",
    "malformed",
    "partial",
    "delayed",
)
DRAFT_TITLE_PATTERN = re.compile(r"^(?:\[draft\]|\(draft\)|draft:)\s*", re.I)
BRANCH_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,254}\Z")
SHA_PATTERN = re.compile(r"[0-9a-f]{40}\Z")


class FixtureAPIError(Exception):
    """A deliberate GitLab-shaped API failure."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = int(status)
        self.message = message


@dataclass(frozen=True)
class FixtureResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


@dataclass(frozen=True)
class OwnedFixturePaths:
    run_root: Path
    owned_directory: Path
    ready_file: Path
    mutation_log: Path
    run_id: str


@dataclass(frozen=True)
class MergeRequest:
    iid: int
    title: str
    description: str
    state: str
    source_branch: str
    target_branch: str
    sha: str
    author_id: int
    reviewer_ids: tuple[int, ...]
    assignee_ids: tuple[int, ...]
    created_at: str = FIXED_TIME
    updated_at: str = FIXED_TIME
    remove_source_branch: bool = False
    squash: bool = False

    @property
    def draft(self) -> bool:
        return DRAFT_TITLE_PATTERN.match(self.title) is not None


class FixtureAuditLog:
    """Thread-safe deterministic JSONL audit trail with optional disk backing."""

    def __init__(self, path: Path | None = None) -> None:
        self._lock = threading.RLock()
        self._events: list[dict[str, Any]] = []
        self._stream = None
        if path is not None:
            flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
            if hasattr(os, "O_BINARY"):
                flags |= os.O_BINARY
            descriptor = os.open(path, flags, 0o600)
            self._stream = os.fdopen(
                descriptor, "w", encoding="utf-8", newline="\n"
            )

    def record(self, kind: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            event = {
                "fixture": FIXTURE_ID,
                "kind": kind,
                "sequence": len(self._events) + 1,
                "time": FIXED_TIME,
                **fields,
            }
            serialized = json.dumps(event, separators=(",", ":"), sort_keys=True)
            if PRIVATE_TOKEN in serialized:
                raise AssertionError("fixture audit record contains the private token")
            self._events.append(event)
            if self._stream is not None:
                self._stream.write(serialized + "\n")
                self._stream.flush()
            return copy.deepcopy(event)

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(self._events)

    def close(self) -> None:
        with self._lock:
            if self._stream is not None:
                self._stream.close()
                self._stream = None


USERS: dict[int, dict[str, Any]] = {
    101: {
        "id": 101,
        "username": "ada-maintainer",
        "name": "Ada Maintainer",
        "state": "active",
        "locked": False,
        "avatar_url": None,
        "web_url": "https://gitlab.example.test/ada-maintainer",
        "access_level": 40,
    },
    102: {
        "id": 102,
        "username": "river-author",
        "name": "River Author",
        "state": "active",
        "locked": False,
        "avatar_url": None,
        "web_url": "https://gitlab.example.test/river-author",
        "access_level": 30,
    },
    103: {
        "id": 103,
        "username": "mina-reviewer",
        "name": "Mina Reviewer",
        "state": "active",
        "locked": False,
        "avatar_url": None,
        "web_url": "https://gitlab.example.test/mina-reviewer",
        "access_level": 30,
    },
    104: {
        "id": 104,
        "username": "kai-assignee",
        "name": "Kai Assignee",
        "state": "active",
        "locked": False,
        "avatar_url": None,
        "web_url": "https://gitlab.example.test/kai-assignee",
        "access_level": 30,
    },
}
CURRENT_USER_ID = 101


def _same_path(left: Path, right: Path) -> bool:
    return os.path.normcase(str(left)) == os.path.normcase(str(right))


def resolve_owned_paths(
    run_root: Path, ready_file: Path, mutation_log: Path
) -> OwnedFixturePaths:
    """Resolve exact owned paths while rejecting symlink or junction escapes."""

    temp_value = os.environ.get("TEMP")
    if not temp_value:
        raise ValueError("TEMP must identify the owned fixture parent directory")
    requested_temp = Path(os.path.abspath(temp_value))
    resolved_temp = requested_temp.resolve(strict=True)
    if not resolved_temp.is_dir() or not _same_path(requested_temp, resolved_temp):
        raise ValueError("TEMP must be a real directory, not a symlink or junction")

    requested_root = Path(os.path.abspath(run_root))
    resolved_root = requested_root.resolve(strict=True)
    if (
        not resolved_root.is_dir()
        or not _same_path(requested_root, resolved_root)
        or resolved_root.parent != resolved_temp
        or RUN_ROOT_PATTERN.fullmatch(resolved_root.name) is None
    ):
        raise ValueError(
            "run root must be a real, directly owned TEMP child named "
            "desktop-material-gitlab-mr-*"
        )

    owned_directory = resolved_root / OWNED_DIRECTORY_NAME
    if owned_directory.exists():
        resolved_owned = owned_directory.resolve(strict=True)
        if not resolved_owned.is_dir() or not _same_path(
            owned_directory, resolved_owned
        ):
            raise ValueError("the owned GitLab MR directory may not be a link")
    else:
        owned_directory.mkdir(mode=0o700)
        resolved_owned = owned_directory.resolve(strict=True)
    if resolved_owned.parent != resolved_root:
        raise ValueError("the owned GitLab MR directory escaped the run root")

    expected_ready = resolved_owned / READY_FILE_NAME
    expected_log = resolved_owned / MUTATION_LOG_FILE_NAME
    requested_ready = Path(os.path.abspath(ready_file))
    requested_log = Path(os.path.abspath(mutation_log))
    if not _same_path(requested_ready, expected_ready):
        raise ValueError("ready file must be the exact owned GitLab MR ready path")
    if not _same_path(requested_log, expected_log):
        raise ValueError("mutation log must be the exact owned GitLab MR audit path")
    for candidate, label in (
        (expected_ready, "ready file"),
        (expected_log, "mutation log"),
    ):
        if candidate.exists():
            raise FileExistsError(f"{label} already exists: {candidate.name}")
        if not _same_path(candidate.parent.resolve(strict=True), resolved_owned):
            raise ValueError(f"{label} parent escaped the owned GitLab MR directory")

    return OwnedFixturePaths(
        run_root=resolved_root,
        owned_directory=resolved_owned,
        ready_file=expected_ready,
        mutation_log=expected_log,
        run_id=resolved_root.name.removeprefix("desktop-material-gitlab-mr-"),
    )


def _user_payload(user_id: int, *, include_access: bool = False) -> dict[str, Any]:
    user = copy.deepcopy(USERS[user_id])
    if not include_access:
        user.pop("access_level", None)
    return user


def _head_sha(iid: int) -> str:
    return hashlib.sha256(
        f"{FIXTURE_ID}:merge-request:{iid}".encode("utf-8")
    ).hexdigest()[:40]


def _seed_merge_requests() -> dict[int, MergeRequest]:
    definitions = (
        (41, "Harden GitLab review continuity", "opened", (101, 103), (104,)),
        (40, "[Draft] Add provider-neutral review actions", "opened", (103,), (102,)),
        (39, "Document merge-request recovery", "closed", (101,), (102,)),
        (38, "Ship deterministic approval state", "opened", (101,), (104,)),
        (37, "Introduce GitLab provider metadata", "merged", (), (102,)),
    )
    return {
        iid: MergeRequest(
            iid=iid,
            title=title,
            description=f"Synthetic merge request !{iid} for Desktop Material.",
            state=state,
            source_branch=f"feature/mr-{iid}",
            target_branch="main",
            sha=_head_sha(iid),
            author_id=102,
            reviewer_ids=reviewers,
            assignee_ids=assignees,
        )
        for iid, title, state, reviewers, assignees in definitions
    }


class GitLabMRFixtureState:
    """Thread-safe in-memory GitLab merge-request state."""

    def __init__(self, audit_log: FixtureAuditLog | None = None) -> None:
        self._lock = threading.RLock()
        self.audit_log = audit_log or FixtureAuditLog()
        self._merge_requests: dict[int, MergeRequest] = {}
        self._approvals: dict[int, set[int]] = {}
        self._readiness_remaining: dict[int, int] = {}
        self._next_iid = 42
        self._fault_mode = "none"
        self._active_delayed_requests = 0
        self._restore_seed()

    def _restore_seed(self) -> None:
        self._merge_requests = _seed_merge_requests()
        self._approvals = {iid: set() for iid in self._merge_requests}
        self._approvals[38] = {CURRENT_USER_ID}
        self._readiness_remaining = {iid: 0 for iid in self._merge_requests}
        self._readiness_remaining[41] = 2
        self._next_iid = 42
        self._fault_mode = "none"

    @property
    def fault_mode(self) -> str:
        with self._lock:
            return self._fault_mode

    def record_request(
        self, method: str, route: str, outcome: str, status: int | None
    ) -> None:
        fields: dict[str, Any] = {
            "method": method,
            "route": route,
            "outcome": outcome,
        }
        if status is not None:
            fields["status"] = status
        self.audit_log.record("request", **fields)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "fixture": FIXTURE_ID,
                "projectId": PROJECT_ID,
                "projectPath": PROJECT_PATH,
                "encodedProjectPath": ENCODED_PROJECT_PATH,
                "tokenRequired": True,
                "faultMode": self._fault_mode,
                "mergeRequestIids": sorted(self._merge_requests, reverse=True),
                "nextIid": self._next_iid,
                "approvedIids": sorted(
                    iid for iid, users in self._approvals.items() if users
                ),
                "readinessRemaining": {
                    str(iid): remaining
                    for iid, remaining in sorted(self._readiness_remaining.items())
                    if remaining > 0
                },
                "activeDelayedRequests": self._active_delayed_requests,
            }

    def begin_delayed_request(self) -> None:
        with self._lock:
            self._active_delayed_requests += 1

    def end_delayed_request(self) -> None:
        with self._lock:
            if self._active_delayed_requests <= 0:
                raise AssertionError("delayed request counter underflow")
            self._active_delayed_requests -= 1

    def set_fault_mode(self, mode: str) -> dict[str, Any]:
        if mode not in FAULT_MODES:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "unsupported fault mode")
        with self._lock:
            self._fault_mode = mode
            self.audit_log.record("mutation", operation="set-fault", mode=mode)
            return self.snapshot()

    def reset(self) -> dict[str, Any]:
        with self._lock:
            self._restore_seed()
            self.audit_log.record("mutation", operation="reset")
            return self.snapshot()

    def project(self) -> dict[str, Any]:
        return {
            "id": PROJECT_ID,
            "name": "desktop-material",
            "path": "desktop-material",
            "path_with_namespace": PROJECT_PATH,
            "default_branch": "main",
            "web_url": f"https://gitlab.example.test/{PROJECT_PATH}",
            "http_url_to_repo": f"https://gitlab.example.test/{PROJECT_PATH}.git",
            "ssh_url_to_repo": f"git@gitlab.example.test:{PROJECT_PATH}.git",
            "visibility": "private",
            "namespace": {
                "id": 4200,
                "name": "platform",
                "path": "platform",
                "kind": "group",
                "full_path": "material-labs/platform",
            },
        }

    def current_user(self) -> dict[str, Any]:
        user = _user_payload(CURRENT_USER_ID)
        user.update({"email": "ada@example.test", "public_email": None})
        return user

    def members(self) -> list[dict[str, Any]]:
        return [_user_payload(user_id, include_access=True) for user_id in sorted(USERS)]

    def _derived_status(self, merge_request: MergeRequest) -> str:
        if merge_request.state != "opened":
            return "not_open"
        if merge_request.draft:
            return "draft_status"
        if not self._approvals.get(merge_request.iid):
            return "not_approved"
        return "mergeable"

    def _status_for(self, iid: int, *, advance: bool) -> str:
        remaining = self._readiness_remaining.get(iid, 0)
        if remaining > 0:
            status = "checking" if remaining == 2 else "approvals_syncing"
            if advance:
                self._readiness_remaining[iid] = remaining - 1
            return status
        return self._derived_status(self._merge_requests[iid])

    def _render(self, merge_request: MergeRequest, *, advance: bool) -> dict[str, Any]:
        status = self._status_for(merge_request.iid, advance=advance)
        reviewers = [_user_payload(user_id) for user_id in merge_request.reviewer_ids]
        assignees = [_user_payload(user_id) for user_id in merge_request.assignee_ids]
        return {
            "id": 9000 + merge_request.iid,
            "iid": merge_request.iid,
            "project_id": PROJECT_ID,
            "title": merge_request.title,
            "description": merge_request.description,
            "state": merge_request.state,
            "created_at": merge_request.created_at,
            "updated_at": merge_request.updated_at,
            "source_branch": merge_request.source_branch,
            "target_branch": merge_request.target_branch,
            "source_project_id": PROJECT_ID,
            "target_project_id": PROJECT_ID,
            "sha": merge_request.sha,
            "author": _user_payload(merge_request.author_id),
            "reviewers": reviewers,
            "assignees": assignees,
            "assignee": assignees[0] if assignees else None,
            "draft": merge_request.draft,
            "work_in_progress": merge_request.draft,
            "detailed_merge_status": status,
            "merge_status": (
                "can_be_merged" if status == "mergeable" else "checking"
            ),
            "has_conflicts": False,
            "labels": ["provider:gitlab", "review"],
            "references": {
                "short": f"!{merge_request.iid}",
                "relative": f"!{merge_request.iid}",
                "full": f"{PROJECT_PATH}!{merge_request.iid}",
            },
            "web_url": (
                f"https://gitlab.example.test/{PROJECT_PATH}/-/merge_requests/"
                f"{merge_request.iid}"
            ),
            "remove_source_branch": merge_request.remove_source_branch,
            "should_remove_source_branch": merge_request.remove_source_branch,
            "force_remove_source_branch": False,
            "squash": merge_request.squash,
            "squash_on_merge": merge_request.squash,
            "merge_when_pipeline_succeeds": False,
            "merge_commit_sha": None,
            "squash_commit_sha": None,
            "task_completion_status": {"count": 2, "completed_count": 1},
            "user_notes_count": 2,
        }

    def list_merge_requests(
        self, query: Mapping[str, Sequence[str]]
    ) -> tuple[list[dict[str, Any]], int, int, int]:
        page = _query_integer(query, "page", default=1, minimum=1, maximum=MAX_PAGE)
        per_page = _query_integer(
            query, "per_page", default=20, minimum=1, maximum=MAX_PER_PAGE
        )
        offset = (page - 1) * per_page
        if offset > MAX_OFFSET:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "pagination offset is too large")
        allowed = {
            "page",
            "per_page",
            "state",
            "draft",
            "order_by",
            "sort",
            "search",
            "source_branch",
            "target_branch",
            "scope",
            "with_merge_status_recheck",
        }
        if set(query) - allowed:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "unsupported list filter")
        state_filter = _query_choice(
            query, "state", default="all", choices=("all", "opened", "closed", "merged", "locked")
        )
        draft_filter = _query_boolean(query, "draft")
        order_by = _query_choice(
            query, "order_by", default="created_at", choices=("created_at", "updated_at", "title")
        )
        sort = _query_choice(query, "sort", default="desc", choices=("asc", "desc"))
        search = _query_text(query, "search", maximum=255)
        source_branch = _query_text(query, "source_branch", maximum=255)
        target_branch = _query_text(query, "target_branch", maximum=255)
        scope = _query_choice(query, "scope", default="all", choices=("all",))
        del scope
        if "with_merge_status_recheck" in query:
            _query_boolean(query, "with_merge_status_recheck")

        with self._lock:
            values = list(self._merge_requests.values())
            if state_filter != "all":
                values = [item for item in values if item.state == state_filter]
            if draft_filter is not None:
                values = [item for item in values if item.draft is draft_filter]
            if search is not None:
                needle = search.casefold()
                values = [
                    item
                    for item in values
                    if needle in item.title.casefold()
                    or needle in item.description.casefold()
                ]
            if source_branch is not None:
                values = [item for item in values if item.source_branch == source_branch]
            if target_branch is not None:
                values = [item for item in values if item.target_branch == target_branch]
            if order_by == "title":
                values.sort(key=lambda item: (item.title.casefold(), item.iid))
            else:
                values.sort(key=lambda item: (getattr(item, order_by), item.iid))
            if sort == "desc":
                values.reverse()
            total = len(values)
            page_values = values[offset : offset + per_page]
            rendered = [self._render(item, advance=False) for item in page_values]
            return rendered, page, per_page, total

    def get_merge_request(self, iid: int) -> dict[str, Any]:
        with self._lock:
            merge_request = self._merge_requests.get(iid)
            if merge_request is None:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "404 Not found")
            return self._render(merge_request, advance=True)

    def create_merge_request(self, request: Mapping[str, Any]) -> dict[str, Any]:
        allowed = {
            "source_branch",
            "target_branch",
            "title",
            "description",
            "reviewer_ids",
            "assignee_ids",
            "remove_source_branch",
            "squash",
        }
        _reject_unknown_fields(request, allowed)
        source_branch = _request_branch(request, "source_branch")
        target_branch = _request_branch(request, "target_branch")
        title = _request_text(request, "title", required=True, maximum=255)
        description = _request_text(
            request, "description", required=False, maximum=32_768, default=""
        )
        reviewer_ids = _request_user_ids(request, "reviewer_ids")
        assignee_ids = _request_user_ids(request, "assignee_ids")
        remove_source_branch = _request_boolean(
            request, "remove_source_branch", default=False
        )
        squash = _request_boolean(request, "squash", default=False)
        with self._lock:
            iid = self._next_iid
            self._next_iid += 1
            merge_request = MergeRequest(
                iid=iid,
                title=title,
                description=description,
                state="opened",
                source_branch=source_branch,
                target_branch=target_branch,
                sha=_head_sha(iid),
                author_id=CURRENT_USER_ID,
                reviewer_ids=reviewer_ids,
                assignee_ids=assignee_ids,
                remove_source_branch=remove_source_branch,
                squash=squash,
            )
            self._merge_requests[iid] = merge_request
            self._approvals[iid] = set()
            self._readiness_remaining[iid] = 2
            self.audit_log.record(
                "mutation",
                operation="create",
                iid=iid,
                draft=merge_request.draft,
                reviewerIds=list(reviewer_ids),
                assigneeIds=list(assignee_ids),
            )
            return self._render(merge_request, advance=False)

    def update_merge_request(
        self, iid: int, request: Mapping[str, Any]
    ) -> dict[str, Any]:
        allowed = {
            "title",
            "description",
            "reviewer_ids",
            "assignee_ids",
            "state_event",
            "remove_source_branch",
            "squash",
        }
        _reject_unknown_fields(request, allowed)
        if not request:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "update body is empty")
        with self._lock:
            existing = self._merge_requests.get(iid)
            if existing is None:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "404 Not found")
            values = {
                "iid": existing.iid,
                "title": existing.title,
                "description": existing.description,
                "state": existing.state,
                "source_branch": existing.source_branch,
                "target_branch": existing.target_branch,
                "sha": existing.sha,
                "author_id": existing.author_id,
                "reviewer_ids": existing.reviewer_ids,
                "assignee_ids": existing.assignee_ids,
                "created_at": existing.created_at,
                "updated_at": FIXED_TIME,
                "remove_source_branch": existing.remove_source_branch,
                "squash": existing.squash,
            }
            if "title" in request:
                values["title"] = _request_text(
                    request, "title", required=True, maximum=255
                )
            if "description" in request:
                values["description"] = _request_text(
                    request, "description", required=False, maximum=32_768
                )
            if "reviewer_ids" in request:
                values["reviewer_ids"] = _request_user_ids(request, "reviewer_ids")
                self._readiness_remaining[iid] = 1
            if "assignee_ids" in request:
                values["assignee_ids"] = _request_user_ids(request, "assignee_ids")
            if "remove_source_branch" in request:
                values["remove_source_branch"] = _request_boolean(
                    request, "remove_source_branch", default=False
                )
            if "squash" in request:
                values["squash"] = _request_boolean(
                    request, "squash", default=False
                )
            if "state_event" in request:
                event = _request_choice(request, "state_event", ("close", "reopen"))
                if event == "close":
                    values["state"] = "closed"
                else:
                    values["state"] = "opened"
            updated = MergeRequest(**values)
            self._merge_requests[iid] = updated
            self.audit_log.record(
                "mutation",
                operation="update",
                iid=iid,
                changedFields=sorted(request),
                draft=updated.draft,
                reviewerIds=list(updated.reviewer_ids),
                assigneeIds=list(updated.assignee_ids),
                state=updated.state,
            )
            return self._render(updated, advance=False)

    def approval_state(self, iid: int) -> dict[str, Any]:
        with self._lock:
            if iid not in self._merge_requests:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "404 Not found")
            approved_by = [
                {"user": _user_payload(user_id)}
                for user_id in sorted(self._approvals[iid])
            ]
            approved = bool(approved_by)
            return {
                "approval_rules_overwritten": False,
                "rules": [
                    {
                        "id": 7001,
                        "name": "Desktop Material reviewers",
                        "rule_type": "regular",
                        "eligible_approvers": [
                            _user_payload(101),
                            _user_payload(103),
                        ],
                        "approvals_required": 1,
                        "users": [_user_payload(101), _user_payload(103)],
                        "groups": [],
                        "contains_hidden_groups": False,
                        "approved_by": approved_by,
                        "approved": approved,
                        "source_rule": None,
                    }
                ],
            }

    def approvals(self, iid: int) -> dict[str, Any]:
        with self._lock:
            if iid not in self._merge_requests:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "404 Not found")
            return self._approval_summary(iid)

    def approve(self, iid: int, request: Mapping[str, Any]) -> dict[str, Any]:
        _reject_unknown_fields(request, {"sha"})
        with self._lock:
            merge_request = self._merge_requests.get(iid)
            if merge_request is None:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "404 Not found")
            if merge_request.state != "opened":
                raise FixtureAPIError(
                    HTTPStatus.METHOD_NOT_ALLOWED,
                    "405 Method Not Allowed",
                )
            supplied_sha = request.get("sha")
            if supplied_sha is not None:
                if not isinstance(supplied_sha, str) or SHA_PATTERN.fullmatch(supplied_sha) is None:
                    raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "sha is invalid")
                if supplied_sha != merge_request.sha:
                    raise FixtureAPIError(
                        HTTPStatus.CONFLICT,
                        "SHA does not match HEAD of source branch",
                    )
            changed = CURRENT_USER_ID not in self._approvals[iid]
            self._approvals[iid].add(CURRENT_USER_ID)
            self._readiness_remaining[iid] = 0
            self.audit_log.record(
                "mutation", operation="approve", iid=iid, changed=changed
            )
            return self._approval_summary(iid)

    def unapprove(self, iid: int) -> dict[str, Any]:
        with self._lock:
            if iid not in self._merge_requests:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "404 Not found")
            changed = CURRENT_USER_ID in self._approvals[iid]
            self._approvals[iid].discard(CURRENT_USER_ID)
            self.audit_log.record(
                "mutation", operation="unapprove", iid=iid, changed=changed
            )
            return self._approval_summary(iid)

    def _approval_summary(self, iid: int) -> dict[str, Any]:
        merge_request = self._merge_requests[iid]
        approved_by = [
            {
                "user": _user_payload(user_id),
                "approved_at": FIXED_TIME,
            }
            for user_id in sorted(self._approvals[iid])
        ]
        return {
            "id": 9000 + iid,
            "iid": iid,
            "project_id": PROJECT_ID,
            "title": merge_request.title,
            "description": merge_request.description,
            "state": merge_request.state,
            "created_at": merge_request.created_at,
            "updated_at": merge_request.updated_at,
            "merge_status": "can_be_merged" if approved_by else "checking",
            "detailed_merge_status": self._derived_status(merge_request),
            "approvals_required": 1,
            "approvals_left": 0 if approved_by else 1,
            "approved": bool(approved_by),
            "approved_by": approved_by,
        }


def _reject_unknown_fields(request: Mapping[str, Any], allowed: set[str]) -> None:
    if set(request) - allowed:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "unsupported request field")


def _request_text(
    request: Mapping[str, Any],
    key: str,
    *,
    required: bool,
    maximum: int,
    default: str = "",
) -> str:
    if key not in request:
        if required:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is required")
        return default
    value = request[key]
    if not isinstance(value, str):
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} must be a string")
    value = value.strip() if key != "description" else value
    if required and not value:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} must not be empty")
    if len(value) > maximum or "\x00" in value:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is invalid")
    return value


def _request_branch(request: Mapping[str, Any], key: str) -> str:
    value = _request_text(request, key, required=True, maximum=255)
    if BRANCH_PATTERN.fullmatch(value) is None or ".." in value.split("/"):
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is invalid")
    return value


def _request_user_ids(request: Mapping[str, Any], key: str) -> tuple[int, ...]:
    value = request.get(key, [])
    if not isinstance(value, list) or len(value) > 20:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} must be an integer array")
    if value == [0]:
        return ()
    if any(isinstance(user_id, bool) or not isinstance(user_id, int) for user_id in value):
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} must be an integer array")
    if any(user_id not in USERS for user_id in value):
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} contains an unknown member")
    if len(set(value)) != len(value):
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} contains duplicates")
    return tuple(value)


def _request_boolean(
    request: Mapping[str, Any], key: str, *, default: bool
) -> bool:
    value = request.get(key, default)
    if not isinstance(value, bool):
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} must be a boolean")
    return value


def _request_choice(
    request: Mapping[str, Any], key: str, choices: Sequence[str]
) -> str:
    value = request.get(key)
    if not isinstance(value, str) or value not in choices:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is invalid")
    return value


def _one_query_value(
    query: Mapping[str, Sequence[str]], key: str
) -> str | None:
    values = query.get(key)
    if values is None:
        return None
    if len(values) != 1:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} must occur once")
    return values[0]


def _query_integer(
    query: Mapping[str, Sequence[str]],
    key: str,
    *,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw = _one_query_value(query, key)
    if raw is None:
        return default
    if not re.fullmatch(r"[0-9]+", raw):
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is invalid")
    value = int(raw)
    if value < minimum or value > maximum:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is out of range")
    return value


def _query_choice(
    query: Mapping[str, Sequence[str]],
    key: str,
    *,
    default: str,
    choices: Sequence[str],
) -> str:
    raw = _one_query_value(query, key)
    if raw is None:
        return default
    if raw not in choices:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is invalid")
    return raw


def _query_boolean(
    query: Mapping[str, Sequence[str]], key: str
) -> bool | None:
    raw = _one_query_value(query, key)
    if raw is None:
        return None
    if raw not in ("true", "false"):
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is invalid")
    return raw == "true"


def _query_text(
    query: Mapping[str, Sequence[str]], key: str, *, maximum: int
) -> str | None:
    raw = _one_query_value(query, key)
    if raw is None:
        return None
    if not raw or len(raw) > maximum or "\x00" in raw:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is invalid")
    return raw


def json_response(
    value: Any,
    status: int = HTTPStatus.OK,
    headers: Mapping[str, str] | None = None,
) -> FixtureResponse:
    body = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    response_headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": str(len(body)),
        "Cache-Control": "no-store",
    }
    if headers:
        response_headers.update(headers)
    return FixtureResponse(int(status), response_headers, body)


def error_response(error: FixtureAPIError) -> FixtureResponse:
    return json_response({"message": error.message}, error.status)


def malformed_json_response() -> FixtureResponse:
    body = b'{"iid":41,"title":'
    return FixtureResponse(
        HTTPStatus.OK,
        {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": str(len(body)),
            "Cache-Control": "no-store",
        },
        body,
    )


def _pagination_headers(
    *,
    endpoint: str,
    route_path: str,
    query: Mapping[str, Sequence[str]],
    page: int,
    per_page: int,
    total: int,
) -> dict[str, str]:
    total_pages = max(1, (total + per_page - 1) // per_page)
    previous_page = page - 1 if page > 1 and page <= total_pages + 1 else None
    next_page = page + 1 if page < total_pages else None
    headers = {
        "X-Next-Page": str(next_page or ""),
        "X-Page": str(page),
        "X-Per-Page": str(per_page),
        "X-Prev-Page": str(previous_page or ""),
        "X-Total": str(total),
        "X-Total-Pages": str(total_pages),
    }

    def page_url(target: int) -> str:
        pairs: list[tuple[str, str]] = []
        for key in sorted(query):
            if key == "page":
                continue
            for value in query[key]:
                pairs.append((key, value))
        pairs.append(("page", str(target)))
        return f"{endpoint}{route_path}?{urlencode(pairs)}"

    links: list[str] = []
    if total_pages > 1 or previous_page is not None or next_page is not None:
        links.append(f'<{page_url(1)}>; rel="first"')
        if previous_page is not None:
            links.append(f'<{page_url(previous_page)}>; rel="prev"')
        if next_page is not None:
            links.append(f'<{page_url(next_page)}>; rel="next"')
        links.append(f'<{page_url(total_pages)}>; rel="last"')
    if links:
        headers["Link"] = ", ".join(links)
    return headers


class GitLabMRFixtureHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        state: GitLabMRFixtureState,
        *,
        response_delay_ms: int = DEFAULT_RESPONSE_DELAY_MS,
    ) -> None:
        super().__init__(server_address, GitLabMRFixtureHandler)
        self.state = state
        self.response_delay_seconds = response_delay_ms / 1000
        self.endpoint = ""

    def handle_error(self, request: Any, client_address: Any) -> None:
        # Client disconnects are an expected cancellation path in this fixture.
        return


class GitLabMRFixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server: GitLabMRFixtureHTTPServer

    def log_message(self, format: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self._handle("PUT")

    def do_DELETE(self) -> None:  # noqa: N802
        self._handle("DELETE")

    def do_PATCH(self) -> None:  # noqa: N802
        self._handle("PATCH")

    def _handle(self, method: str) -> None:
        route = "unknown"
        response: FixtureResponse | None = None
        try:
            response, route = self._route(method)
        except FixtureAPIError as error:
            response = error_response(error)
            route = getattr(error, "route", route)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            self.server.state.record_request(method, route, "cancelled", None)
            self.close_connection = True
            return

        if response is None:
            self.server.state.record_request(method, route, "cancelled", None)
            self.close_connection = True
            return
        if self._client_disconnected():
            self.server.state.record_request(method, route, "cancelled", None)
            self.close_connection = True
            return
        if self._write_response(response):
            self.server.state.record_request(
                method, route, "completed", int(response.status)
            )
        else:
            self.server.state.record_request(method, route, "cancelled", None)
            self.close_connection = True

    def _route(self, method: str) -> tuple[FixtureResponse | None, str]:
        try:
            split = urlsplit(self.path)
            query = parse_qs(
                split.query,
                keep_blank_values=True,
                strict_parsing=False,
                max_num_fields=32,
            )
        except (ValueError, UnicodeError) as error:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "invalid request target") from error
        path = split.path

        if path == "/__fixture__/health":
            if method != "GET":
                return self._method_not_allowed("GET"), "fixture-health"
            return json_response(
                {
                    "fixture": FIXTURE_ID,
                    "protocolVersion": FIXTURE_PROTOCOL_VERSION,
                    "status": "ok",
                    "tokenRequired": True,
                    "projectPath": PROJECT_PATH,
                    "encodedProjectPath": ENCODED_PROJECT_PATH,
                    "faultMode": self.server.state.fault_mode,
                }
            ), "fixture-health"
        if path == "/__fixture__/state":
            if method != "GET":
                return self._method_not_allowed("GET"), "fixture-state"
            return json_response(self.server.state.snapshot()), "fixture-state"
        if path == "/__fixture__/fault":
            if method != "POST":
                return self._method_not_allowed("POST"), "fixture-fault"
            request = self._read_json_object(required=True)
            if set(request) != {"mode"}:
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "fault body is invalid")
            mode = request["mode"]
            if not isinstance(mode, str):
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "fault mode is invalid")
            return json_response(self.server.state.set_fault_mode(mode)), "fixture-fault"
        if path == "/__fixture__/reset":
            if method != "POST":
                return self._method_not_allowed("POST"), "fixture-reset"
            request = self._read_json_object(required=False)
            if request:
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "reset body must be empty")
            return json_response(self.server.state.reset()), "fixture-reset"

        if not path.startswith(f"{API_PREFIX}/"):
            return error_response(
                FixtureAPIError(HTTPStatus.NOT_FOUND, "404 Not found")
            ), "not-found"
        self._require_private_token()

        if self.server.state.fault_mode == "unavailable":
            return error_response(
                FixtureAPIError(HTTPStatus.SERVICE_UNAVAILABLE, "GitLab fixture unavailable")
            ), "api-unavailable"
        if self.server.state.fault_mode == "error":
            return error_response(
                FixtureAPIError(HTTPStatus.INTERNAL_SERVER_ERROR, "synthetic GitLab error")
            ), "api-error"
        if self.server.state.fault_mode == "delayed":
            self.server.state.begin_delayed_request()
            try:
                time.sleep(self.server.response_delay_seconds)
                if self._client_disconnected():
                    return None, "api-delayed"
            finally:
                self.server.state.end_delayed_request()
        if self.server.state.fault_mode == "malformed" and method == "GET":
            return malformed_json_response(), "api-malformed"

        if path == f"{API_PREFIX}/user":
            if method != "GET":
                return self._method_not_allowed("GET"), "current-user"
            return json_response(self.server.state.current_user()), "current-user"

        project_suffix = self._project_suffix(path)
        if project_suffix is None:
            return error_response(
                FixtureAPIError(HTTPStatus.NOT_FOUND, "404 Not found")
            ), "project-not-found"
        if project_suffix == "":
            if method != "GET":
                return self._method_not_allowed("GET"), "project"
            return json_response(self.server.state.project()), "project"
        if project_suffix == "members/all":
            if method != "GET":
                return self._method_not_allowed("GET"), "members-all"
            if self.server.state.fault_mode == "partial":
                return error_response(
                    FixtureAPIError(
                        HTTPStatus.SERVICE_UNAVAILABLE,
                        "project members are temporarily unavailable",
                    )
                ), "members-all"
            page = _query_integer(query, "page", default=1, minimum=1, maximum=MAX_PAGE)
            per_page = _query_integer(
                query, "per_page", default=20, minimum=1, maximum=MAX_PER_PAGE
            )
            if set(query) - {"page", "per_page"}:
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "unsupported members filter")
            members = self.server.state.members()
            offset = (page - 1) * per_page
            if offset > MAX_OFFSET:
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "pagination offset is too large")
            headers = _pagination_headers(
                endpoint=self.server.endpoint,
                route_path=f"{API_PREFIX}/projects/{ENCODED_PROJECT_PATH}/members/all",
                query=query,
                page=page,
                per_page=per_page,
                total=len(members),
            )
            return json_response(
                members[offset : offset + per_page], headers=headers
            ), "members-all"
        if project_suffix == "merge_requests":
            if method == "GET":
                values, page, per_page, total = self.server.state.list_merge_requests(query)
                headers = _pagination_headers(
                    endpoint=self.server.endpoint,
                    route_path=(
                        f"{API_PREFIX}/projects/{ENCODED_PROJECT_PATH}/merge_requests"
                    ),
                    query=query,
                    page=page,
                    per_page=per_page,
                    total=total,
                )
                return json_response(values, headers=headers), "merge-request-list"
            if method == "POST":
                request = self._read_json_object(required=True)
                return json_response(
                    self.server.state.create_merge_request(request),
                    HTTPStatus.CREATED,
                ), "merge-request-create"
            return self._method_not_allowed("GET, POST"), "merge-request-list"

        match = re.fullmatch(
            r"merge_requests/([1-9][0-9]*)(?:/(approvals|approval_state|approve|unapprove))?",
            project_suffix,
        )
        if match is None:
            return error_response(
                FixtureAPIError(HTTPStatus.NOT_FOUND, "404 Not found")
            ), "project-not-found"
        iid = int(match.group(1))
        operation = match.group(2)
        if operation == "approvals":
            if method != "GET":
                return self._method_not_allowed("GET"), "approvals"
            if self.server.state.fault_mode == "partial":
                return error_response(
                    FixtureAPIError(
                        HTTPStatus.SERVICE_UNAVAILABLE,
                        "approvals are temporarily unavailable",
                    )
                ), "approvals"
            return json_response(self.server.state.approvals(iid)), "approvals"
        if operation == "approval_state":
            if method != "GET":
                return self._method_not_allowed("GET"), "approval-state"
            if self.server.state.fault_mode == "partial":
                return error_response(
                    FixtureAPIError(
                        HTTPStatus.SERVICE_UNAVAILABLE,
                        "approval state is temporarily unavailable",
                    )
                ), "approval-state"
            return json_response(self.server.state.approval_state(iid)), "approval-state"
        if operation == "approve":
            if method != "POST":
                return self._method_not_allowed("POST"), "approve"
            request = self._read_json_object(required=False)
            return json_response(
                self.server.state.approve(iid, request), HTTPStatus.CREATED
            ), "approve"
        if operation == "unapprove":
            if method != "POST":
                return self._method_not_allowed("POST"), "unapprove"
            request = self._read_json_object(required=False)
            if request:
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "unapprove body must be empty")
            return json_response(self.server.state.unapprove(iid)), "unapprove"
        if method == "GET":
            if set(query) - {"with_merge_status_recheck"}:
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "unsupported merge request query")
            if "with_merge_status_recheck" in query:
                _query_boolean(query, "with_merge_status_recheck")
            return json_response(self.server.state.get_merge_request(iid)), "merge-request-single"
        if method == "PUT":
            if query:
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "update query is invalid")
            request = self._read_json_object(required=True)
            return json_response(
                self.server.state.update_merge_request(iid, request)
            ), "merge-request-update"
        return self._method_not_allowed("GET, PUT"), "merge-request-single"

    def _project_suffix(self, path: str) -> str | None:
        prefix = f"{API_PREFIX}/projects/"
        if not path.startswith(prefix):
            return None
        remainder = path[len(prefix) :]
        project_segment, separator, suffix = remainder.partition("/")
        if project_segment not in (str(PROJECT_ID), ENCODED_PROJECT_PATH):
            return None
        return suffix if separator else ""

    def _require_private_token(self) -> None:
        values = self.headers.get_all("PRIVATE-TOKEN") or []
        if len(values) != 1 or values[0] != PRIVATE_TOKEN:
            raise FixtureAPIError(HTTPStatus.UNAUTHORIZED, "401 Unauthorized")

    def _read_json_object(self, *, required: bool) -> dict[str, Any]:
        transfer_encoding = self.headers.get("Transfer-Encoding")
        if transfer_encoding is not None:
            raise FixtureAPIError(
                HTTPStatus.BAD_REQUEST, "transfer encoding is not supported"
            )
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            if required:
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "request body is required")
            return {}
        try:
            content_length = int(raw_length, 10)
        except ValueError as error:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "invalid content length") from error
        if content_length < 0:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "invalid content length")
        if content_length > MAX_REQUEST_BODY_BYTES:
            raise FixtureAPIError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request body is too large")
        if content_length == 0:
            if required:
                raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "request body is required")
            return {}
        content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise FixtureAPIError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "content type must be application/json")
        body = self.rfile.read(content_length)
        if len(body) != content_length:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "request body was truncated")
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "invalid JSON request body") from error
        if not isinstance(value, dict):
            raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "request body must be a JSON object")
        return value

    def _method_not_allowed(self, allow: str) -> FixtureResponse:
        response = error_response(
            FixtureAPIError(HTTPStatus.METHOD_NOT_ALLOWED, "405 Method Not Allowed")
        )
        return FixtureResponse(
            response.status,
            {**response.headers, "Allow": allow},
            response.body,
        )

    def _client_disconnected(self) -> bool:
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            if not readable:
                return False
            return self.connection.recv(1, socket.MSG_PEEK) == b""
        except (BlockingIOError, InterruptedError):
            return False
        except (ConnectionAbortedError, ConnectionResetError, OSError):
            return True

    def _write_response(self, response: FixtureResponse) -> bool:
        try:
            self.send_response(int(response.status))
            for key, value in response.headers.items():
                self.send_header(key, value)
            self.end_headers()
            if response.body:
                self.wfile.write(response.body)
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            return False


def _write_ready_file(path: Path, payload: Mapping[str, Any]) -> None:
    serialized = json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n"
    if PRIVATE_TOKEN in serialized:
        raise AssertionError("ready receipt contains the private token")
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    if hasattr(os, "O_BINARY"):
        flags |= os.O_BINARY
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(serialized)
            stream.flush()
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise


def _parse_arguments(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default=LOOPBACK_ADDRESS)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--ready-file", type=Path, required=True)
    parser.add_argument("--mutation-log", type=Path, required=True)
    parser.add_argument("--fault-mode", choices=FAULT_MODES, default="none")
    parser.add_argument(
        "--response-delay-ms",
        type=int,
        default=DEFAULT_RESPONSE_DELAY_MS,
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parse_arguments(sys.argv[1:] if argv is None else argv)
    if arguments.bind != LOOPBACK_ADDRESS:
        raise ValueError("the GitLab MR fixture may bind only to 127.0.0.1")
    if arguments.port < 0 or arguments.port > 65_535:
        raise ValueError("port is outside the valid range")
    if (
        arguments.response_delay_ms < 50
        or arguments.response_delay_ms > MAX_RESPONSE_DELAY_MS
    ):
        raise ValueError("response delay is outside the bounded range")

    paths = resolve_owned_paths(
        arguments.run_root, arguments.ready_file, arguments.mutation_log
    )
    audit_log = FixtureAuditLog(paths.mutation_log)
    state = GitLabMRFixtureState(audit_log)
    state.set_fault_mode(arguments.fault_mode)
    server = GitLabMRFixtureHTTPServer(
        (LOOPBACK_ADDRESS, arguments.port),
        state,
        response_delay_ms=arguments.response_delay_ms,
    )
    port = int(server.server_address[1])
    server.endpoint = f"http://{LOOPBACK_ADDRESS}:{port}"
    ready = {
        "fixture": FIXTURE_ID,
        "protocolVersion": FIXTURE_PROTOCOL_VERSION,
        "pid": os.getpid(),
        "bind": LOOPBACK_ADDRESS,
        "port": port,
        "endpoint": server.endpoint,
        "apiEndpoint": f"{server.endpoint}{API_PREFIX}",
        "projectId": PROJECT_ID,
        "projectPath": PROJECT_PATH,
        "encodedProjectPath": ENCODED_PROJECT_PATH,
        "tokenRequired": True,
        "runId": paths.run_id,
        "runRootName": paths.run_root.name,
        "mutationLog": f"{OWNED_DIRECTORY_NAME}/{MUTATION_LOG_FILE_NAME}",
        "faultMode": arguments.fault_mode,
        "responseDelayMs": arguments.response_delay_ms,
    }
    try:
        _write_ready_file(paths.ready_file, ready)
        print(
            json.dumps(
                {
                    "fixture": FIXTURE_ID,
                    "endpoint": server.endpoint,
                    "projectPath": PROJECT_PATH,
                    "tokenRequired": True,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
            flush=True,
        )
        server.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        audit_log.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
