from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


MODULE_PATH = Path(__file__).with_name("p0_fake_github_provider.py")
PREPARE_FIXTURE_PATH = Path(__file__).with_name("prepare_p0_fixture.ps1")
SPEC = importlib.util.spec_from_file_location("p0_fake_github_provider", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
provider = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = provider
SPEC.loader.exec_module(provider)


class ProviderStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.artifact = self.root / "artifact.zip"
        provider.make_deterministic_artifact(self.artifact)
        self.state = provider.ProviderState(self.artifact)
        self.headers = {"Authorization": f"Bearer {provider.FIXTURE_TOKEN}"}
        self.repo_path = (
            f"/api/v3/repos/{provider.OWNER}/{provider.REPOSITORY}"
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def json(self, response):
        return json.loads(response.body.decode("utf-8"))

    def test_requires_exact_dummy_token(self) -> None:
        response = self.state.dispatch("GET", self.repo_path, {})
        self.assertEqual(response.status, 401)
        self.assertEqual(self.json(response)["message"], "Bad credentials")

    def test_preflight_does_not_require_authorization(self) -> None:
        response = self.state.dispatch("OPTIONS", self.repo_path, {})
        self.assertEqual(response.status, 204)

    def test_copilot_capability_is_opt_in_and_identity_safe(self) -> None:
        default_response = self.state.dispatch(
            "POST", "/api/v3/graphql", self.headers
        )
        default_viewer = self.json(default_response)["data"]["viewer"]
        self.assertFalse(default_viewer["isCopilotDesktopEnabled"])
        self.assertEqual(default_viewer["copilotLicenseType"], "none")

        enabled_state = provider.ProviderState(
            self.artifact, copilot_enabled=True
        )
        enabled_response = enabled_state.dispatch(
            "POST", "/api/v3/graphql", self.headers
        )
        enabled_viewer = self.json(enabled_response)["data"]["viewer"]
        self.assertTrue(enabled_viewer["isCopilotDesktopEnabled"])
        self.assertEqual(
            enabled_viewer["copilotLicenseType"], "COPILOT_INDIVIDUAL"
        )
        self.assertEqual(enabled_viewer["copilotEndpoints"], {"api": ""})
        default_features = self.state.dispatch(
            "GET", "/api/v3/desktop_internal/features", self.headers
        )
        enabled_features = enabled_state.dispatch(
            "GET", "/api/v3/desktop_internal/features", self.headers
        )
        self.assertEqual(self.json(default_features), {"features": []})
        self.assertEqual(
            self.json(enabled_features),
            {
                "features": [
                    "desktop_enable_copilot_sdk_commit_message_generation"
                ]
            },
        )

    def test_repository_and_branch_rules_are_purpose_built(self) -> None:
        repository = self.state.dispatch("GET", self.repo_path, self.headers)
        self.assertEqual(repository.status, 200)
        self.assertEqual(self.json(repository)["default_branch"], "main")

        rules = self.state.dispatch(
            "GET",
            self.repo_path
            + "/rules/branches/feature%2Fmaterial-verification?per_page=100",
            self.headers,
        )
        values = self.json(rules)
        self.assertEqual(rules.status, 200)
        self.assertGreaterEqual(len(values), 8)
        self.assertEqual(
            {value["ruleset_id"] for value in values}, set(provider.RULESET_IDS)
        )

    def test_github_api_explorer_custom_patterns_are_synthetic_and_bounded(self) -> None:
        response = self.state.dispatch(
            "GET",
            self.repo_path + "/secret-scanning/custom-patterns",
            self.headers,
        )
        self.assertEqual(response.status, 200)
        patterns = self.json(response)
        self.assertEqual([value["id"] for value in patterns], [101, 102])
        self.assertTrue(patterns[0]["push_protection_enabled"])
        self.assertIn("responsive Explorer", patterns[1]["name"])

        rejected_query = self.state.dispatch(
            "GET",
            self.repo_path + "/secret-scanning/custom-patterns?page=2",
            self.headers,
        )
        self.assertEqual(rejected_query.status, 404)

    def test_releases_dashboard_fixture_has_stable_preview_and_draft_states(self) -> None:
        response = self.state.dispatch(
            "GET",
            self.repo_path + "/releases?per_page=30&page=1",
            self.headers,
        )
        self.assertEqual(response.status, 200)
        releases = self.json(response)
        self.assertEqual(
            [(value["draft"], value["prerelease"]) for value in releases],
            [(False, False), (False, True), (True, False)],
        )
        self.assertEqual(
            [value["id"] for value in releases],
            list(provider.RELEASE_IDS),
        )

        assets = self.state.dispatch(
            "GET",
            self.repo_path
            + f"/releases/{provider.RELEASE_IDS[0]}/assets?per_page=100&page=1",
            self.headers,
        )
        self.assertEqual(assets.status, 200)
        asset_values = self.json(assets)
        self.assertEqual(
            [value["id"] for value in asset_values],
            list(provider.RELEASE_ASSET_IDS[:2]),
        )
        self.assertTrue(
            all(value["digest"].startswith("sha256:") for value in asset_values)
        )

    def test_artifact_metadata_matches_exact_archive(self) -> None:
        metadata = self.state.dispatch(
            "GET",
            self.repo_path
            + f"/actions/runs/{provider.WORKFLOW_RUN_ID}/artifacts?per_page=30&page=2",
            self.headers,
        )
        artifact = self.json(metadata)["artifacts"][0]
        archive = self.state.dispatch(
            "GET",
            self.repo_path
            + f"/actions/artifacts/{provider.ARTIFACT_SENTINEL_ID}/zip",
            self.headers,
        )
        self.assertEqual(archive.status, 200)
        self.assertEqual(artifact["id"], provider.ARTIFACT_SENTINEL_ID)
        self.assertEqual(artifact["size_in_bytes"], len(archive.body))
        self.assertEqual(
            artifact["digest"],
            "sha256:" + hashlib.sha256(archive.body).hexdigest(),
        )
        attestation = self.state.dispatch(
            "GET",
            self.repo_path
            + "/attestations/"
            + artifact["digest"].replace(":", "%3A")
            + "?per_page=1",
            self.headers,
        )
        self.assertEqual(attestation.status, 200)
        self.assertEqual(len(self.json(attestation)["attestations"]), 1)

    def test_actions_cache_inventory_usage_and_deletion_are_bounded(self) -> None:
        inventory = self.state.dispatch(
            "GET",
            self.repo_path + "/actions/caches?per_page=30&page=1",
            self.headers,
        )
        usage = self.state.dispatch(
            "GET",
            self.repo_path + "/actions/cache/usage",
            self.headers,
        )
        self.assertEqual(inventory.status, 200)
        self.assertEqual(usage.status, 200)
        self.assertEqual(
            len(self.json(inventory)["actions_caches"]),
            len(provider.CACHE_IDS),
        )
        self.assertEqual(
            self.json(usage)["active_caches_count"],
            len(provider.CACHE_IDS),
        )

        deleted = self.state.dispatch(
            "DELETE",
            self.repo_path + f"/actions/caches/{provider.CACHE_IDS[1]}",
            self.headers,
        )
        self.assertEqual(deleted.status, 204)
        refreshed = self.state.dispatch(
            "GET",
            self.repo_path + "/actions/caches?per_page=30&page=1",
            self.headers,
        )
        self.assertEqual(
            [value["id"] for value in self.json(refreshed)["actions_caches"]],
            [provider.CACHE_IDS[0], provider.CACHE_IDS[2]],
        )

    def test_actions_pages_filters_and_sentinels_are_exact(self) -> None:
        first = self.state.dispatch(
            "GET",
            self.repo_path + "/actions/runs?per_page=50&page=1",
            self.headers,
        )
        second = self.state.dispatch(
            "GET",
            self.repo_path + "/actions/runs?per_page=50&page=2",
            self.headers,
        )
        first_body = self.json(first)
        second_body = self.json(second)
        self.assertEqual(first_body["total_count"], provider.WORKFLOW_RUN_COUNT)
        self.assertEqual(len(first_body["workflow_runs"]), 50)
        self.assertEqual(len(second_body["workflow_runs"]), 3)

        success_first = self.state.dispatch(
            "GET",
            self.repo_path
            + f"/actions/workflows/{provider.WORKFLOW_ID}/runs?per_page=50&page=1&status=success",
            self.headers,
        )
        success_second = self.state.dispatch(
            "GET",
            self.repo_path
            + f"/actions/workflows/{provider.WORKFLOW_ID}/runs?per_page=50&page=2&status=success",
            self.headers,
        )
        success_first_body = self.json(success_first)
        success_second_body = self.json(success_second)
        self.assertEqual(
            success_first_body["total_count"],
            provider.SUCCESS_WORKFLOW_RUN_COUNT,
        )
        self.assertEqual(len(success_first_body["workflow_runs"]), 50)
        self.assertEqual(len(success_second_body["workflow_runs"]), 1)
        self.assertEqual(
            success_second_body["workflow_runs"][0]["id"],
            provider.WORKFLOW_RUN_SENTINEL_ID,
        )

        artifacts_first = self.state.dispatch(
            "GET",
            self.repo_path
            + f"/actions/runs/{provider.WORKFLOW_RUN_ID}/artifacts?per_page=30&page=1",
            self.headers,
        )
        artifacts_second = self.state.dispatch(
            "GET",
            self.repo_path
            + f"/actions/runs/{provider.WORKFLOW_RUN_ID}/artifacts?per_page=30&page=2",
            self.headers,
        )
        artifacts_first_body = self.json(artifacts_first)
        artifacts_second_body = self.json(artifacts_second)
        self.assertEqual(artifacts_first_body["total_count"], provider.ARTIFACT_COUNT)
        self.assertEqual(len(artifacts_first_body["artifacts"]), 30)
        self.assertEqual(len(artifacts_second_body["artifacts"]), 1)
        self.assertEqual(
            artifacts_second_body["artifacts"][0]["id"],
            provider.ARTIFACT_SENTINEL_ID,
        )

        for target in (
            self.repo_path + "/actions/runs?per_page=50&page=0",
            self.repo_path + "/actions/runs?per_page=49&page=1",
            self.repo_path
            + f"/actions/runs/{provider.WORKFLOW_RUN_ID}/artifacts?per_page=30&page=bad",
        ):
            response = self.state.dispatch("GET", target, self.headers)
            self.assertEqual(response.status, 422)

    def test_actions_run_inspector_pages_attempts_and_one_shot_retry_are_exact(
        self,
    ) -> None:
        inspector = self.state.workflow_run_for(provider.WORKFLOW_RUN_COUNT - 1)
        self.assertEqual(inspector["id"], provider.INSPECTOR_WORKFLOW_RUN_ID)
        self.assertEqual(inspector["run_attempt"], provider.INSPECTOR_LATEST_ATTEMPT)
        self.assertEqual(inspector["conclusion"], "action_required")

        latest_root = (
            self.repo_path
            + f"/actions/runs/{provider.INSPECTOR_WORKFLOW_RUN_ID}/jobs"
        )
        latest_first = self.state.dispatch(
            "GET",
            latest_root + "?filter=latest&per_page=50&page=1",
            self.headers,
        )
        latest_failure = self.state.dispatch(
            "GET",
            latest_root + "?filter=latest&per_page=50&page=2",
            self.headers,
        )
        latest_second = self.state.dispatch(
            "GET",
            latest_root + "?filter=latest&per_page=50&page=2",
            self.headers,
        )
        first_body = self.json(latest_first)
        second_body = self.json(latest_second)
        self.assertEqual(latest_first.status, 200)
        self.assertEqual(latest_failure.status, 503)
        self.assertEqual(latest_second.status, 200)
        self.assertEqual(first_body["total_count"], provider.INSPECTOR_JOB_COUNT)
        self.assertEqual(len(first_body["jobs"]), 50)
        self.assertEqual(len(second_body["jobs"]), 1)
        self.assertEqual(
            second_body["jobs"][0]["id"],
            provider.INSPECTOR_CURRENT_JOB_SENTINEL_ID,
        )
        self.assertEqual(
            second_body["jobs"][0]["run_id"],
            provider.INSPECTOR_WORKFLOW_RUN_ID,
        )

        historical_root = (
            self.repo_path
            + f"/actions/runs/{provider.INSPECTOR_WORKFLOW_RUN_ID}"
            + "/attempts/1/jobs"
        )
        historical_first = self.state.dispatch(
            "GET",
            historical_root + "?per_page=50&page=1",
            self.headers,
        )
        historical_second = self.state.dispatch(
            "GET",
            historical_root + "?per_page=50&page=2",
            self.headers,
        )
        self.assertEqual(len(self.json(historical_first)["jobs"]), 50)
        self.assertEqual(
            self.json(historical_second)["jobs"][0]["id"],
            provider.INSPECTOR_HISTORICAL_JOB_SENTINEL_ID,
        )

        for target in (
            latest_root + "?per_page=50&page=1",
            latest_root + "?filter=all&per_page=50&page=1",
            historical_root + "?filter=latest&per_page=50&page=1",
            historical_root + "?per_page=49&page=1",
        ):
            response = self.state.dispatch("GET", target, self.headers)
            self.assertEqual(response.status, 422)

    def test_pending_deployment_review_and_fork_approval_are_stateful(self) -> None:
        run_root = (
            self.repo_path
            + f"/actions/runs/{provider.INSPECTOR_WORKFLOW_RUN_ID}"
        )
        pending = self.state.dispatch(
            "GET", run_root + "/pending_deployments", self.headers
        )
        pending_body = self.json(pending)
        self.assertEqual(
            [value["environment"]["id"] for value in pending_body],
            list(provider.PENDING_ENVIRONMENT_IDS),
        )
        self.assertEqual(
            [value["current_user_can_approve"] for value in pending_body],
            [True, False],
        )
        history = self.state.dispatch(
            "GET", run_root + "/approvals", self.headers
        )
        self.assertEqual(len(self.json(history)), 1)

        request = {
            "environment_ids": [provider.PENDING_ENVIRONMENT_IDS[0]],
            "state": "approved",
            "comment": "Approved after inspecting the exact page-two job log.",
        }
        reviewed = self.state.dispatch(
            "POST",
            run_root + "/pending_deployments",
            self.headers,
            json.dumps(request).encode("utf-8"),
        )
        self.assertEqual(reviewed.status, 204)
        self.assertEqual(self.state.review_requests, [request])
        pending_after = self.json(
            self.state.dispatch(
                "GET", run_root + "/pending_deployments", self.headers
            )
        )
        self.assertEqual(
            [value["environment"]["id"] for value in pending_after],
            [provider.PENDING_ENVIRONMENT_IDS[1]],
        )
        history_after = self.json(
            self.state.dispatch("GET", run_root + "/approvals", self.headers)
        )
        self.assertEqual(len(history_after), 2)
        self.assertEqual(history_after[-1]["comment"], request["comment"])
        stale = self.state.dispatch(
            "POST",
            run_root + "/pending_deployments",
            self.headers,
            json.dumps(request).encode("utf-8"),
        )
        self.assertEqual(stale.status, 409)

        approved = self.state.dispatch(
            "POST", run_root + "/approve", self.headers
        )
        self.assertEqual(approved.status, 204)
        self.assertTrue(self.state.fork_approved)
        self.assertEqual(
            self.state.workflow_run_for(provider.WORKFLOW_RUN_COUNT - 1)[
                "conclusion"
            ],
            "neutral",
        )
        duplicate = self.state.dispatch(
            "POST", run_root + "/approve", self.headers
        )
        self.assertEqual(duplicate.status, 409)

        rejected_state = provider.ProviderState(self.artifact)
        rejected_request = {
            "environment_ids": [provider.PENDING_ENVIRONMENT_IDS[0]],
            "state": "rejected",
            "comment": "Keep pending until\tthe responsive evidence is complete.",
        }
        rejected = rejected_state.dispatch(
            "POST",
            run_root + "/pending_deployments",
            self.headers,
            json.dumps(rejected_request).encode("utf-8"),
        )
        self.assertEqual(rejected.status, 204)
        self.assertEqual(rejected_state.review_requests, [rejected_request])
        for invalid_comment in (
            "   ",
            " leading text",
            "trailing text ",
            "contains\x7fdelete",
        ):
            invalid_state = provider.ProviderState(self.artifact)
            invalid_request = dict(rejected_request, comment=invalid_comment)
            invalid = invalid_state.dispatch(
                "POST",
                run_root + "/pending_deployments",
                self.headers,
                json.dumps(invalid_request).encode("utf-8"),
            )
            self.assertEqual(invalid.status, 422)

    def test_generic_runs_have_empty_deployment_review_surfaces(self) -> None:
        run_root = self.repo_path + f"/actions/runs/{provider.WORKFLOW_RUN_ID}"

        for suffix in ("/pending_deployments", "/approvals"):
            response = self.state.dispatch("GET", run_root + suffix, self.headers)
            self.assertEqual(response.status, 200)
            self.assertEqual(self.json(response), [])

        mutation = self.state.dispatch(
            "POST",
            run_root + "/pending_deployments",
            self.headers,
            json.dumps(
                {
                    "environment_ids": [provider.PENDING_ENVIRONMENT_IDS[0]],
                    "state": "approved",
                    "comment": "Generic runs stay read-only.",
                }
            ).encode("utf-8"),
        )
        self.assertEqual(mutation.status, 405)

    def test_job_log_redirect_content_and_exact_rerun_are_bounded(self) -> None:
        job_id = provider.INSPECTOR_CURRENT_JOB_SENTINEL_ID
        api_root = self.repo_path + f"/actions/jobs/{job_id}"
        redirect = self.state.dispatch("GET", api_root + "/logs", self.headers)
        self.assertEqual(redirect.status, 302)
        self.assertEqual(
            redirect.headers["Location"],
            f"/downloads/actions/jobs/{job_id}/logs",
        )
        content = self.state.dispatch(
            "GET", redirect.headers["Location"], {}
        )
        self.assertEqual(content.status, 200)
        self.assertIn(f"Exact workflow job {job_id}", content.body.decode())

        rerun = self.state.dispatch("POST", api_root + "/rerun", self.headers)
        self.assertEqual(rerun.status, 201)
        self.assertEqual(self.state.rerun_job_ids, {job_id})
        duplicate = self.state.dispatch("POST", api_root + "/rerun", self.headers)
        self.assertEqual(duplicate.status, 409)
        self.assertEqual(self.state.rerun_job_ids, {job_id})
        with_body = self.state.dispatch(
            "POST", api_root + "/rerun", self.headers, b"{}"
        )
        self.assertEqual(with_body.status, 422)
        wrong = self.state.dispatch(
            "POST",
            self.repo_path + "/actions/jobs/1/rerun",
            self.headers,
        )
        self.assertEqual(wrong.status, 404)

    def test_pull_request_is_in_memory_and_echoes_reviewed_fields(self) -> None:
        request = {
            "title": "Verify production P0 workflows",
            "body": "Synthetic loopback request.",
            "head": provider.FEATURE_BRANCH,
            "base": provider.DEFAULT_BRANCH,
            "draft": True,
        }
        response = self.state.dispatch(
            "POST",
            self.repo_path + "/pulls",
            self.headers,
            json.dumps(request).encode("utf-8"),
        )
        created = self.json(response)
        self.assertEqual(response.status, 201)
        self.assertEqual(created["title"], request["title"])
        self.assertEqual(created["head"]["ref"], request["head"])
        self.assertEqual(
            created["head"]["label"],
            f"{provider.OWNER}:{provider.FEATURE_BRANCH}",
        )
        self.assertEqual(
            created["head"]["repo"]["full_name"],
            f"{provider.OWNER}/{provider.REPOSITORY}",
        )
        self.assertEqual(len(self.state.pull_requests), 1)

        repeated = self.state.dispatch(
            "POST",
            self.repo_path + "/pulls",
            self.headers,
            json.dumps(request).encode("utf-8"),
        )
        repeated_created = self.json(repeated)
        self.assertEqual(repeated.status, 201)
        self.assertEqual(created["number"], 73)
        self.assertEqual(repeated_created["number"], 74)
        self.assertEqual(len(self.state.pull_requests), 2)

        wrong_ref = dict(request, base="release")
        rejected = self.state.dispatch(
            "POST",
            self.repo_path + "/pulls",
            self.headers,
            json.dumps(wrong_ref).encode("utf-8"),
        )
        self.assertEqual(rejected.status, 422)
        self.assertEqual(len(self.state.pull_requests), 2)

    def test_issue_and_triage_fixtures_are_complete_and_nonempty(self) -> None:
        issues = self.json(
            self.state.dispatch(
                "GET",
                self.repo_path + "/issues?state=open&per_page=30&page=1",
                self.headers,
            )
        )
        self.assertEqual(len(issues), 1)
        issue = issues[0]
        self.assertEqual(issue["number"], provider.ISSUE_NUMBER)
        self.assertEqual(issue["labels"], [self.state.issue_label])
        self.assertEqual(issue["assignees"][0]["login"], provider.ACCOUNT_LOGIN)
        self.assertEqual(issue["milestone"], self.state.issue_milestone)
        self.assertEqual(issue["comments"], 1)

        detail = self.json(
            self.state.dispatch(
                "GET",
                self.repo_path + f"/issues/{provider.ISSUE_NUMBER}",
                self.headers,
            )
        )
        self.assertEqual(detail, issue)
        comments = self.json(
            self.state.dispatch(
                "GET",
                self.repo_path
                + f"/issues/{provider.ISSUE_NUMBER}/comments?per_page=30&page=1",
                self.headers,
            )
        )
        self.assertEqual(len(comments), 1)
        self.assertIn("synthetic", comments[0]["body"].lower())
        self.assertEqual(
            self.json(
                self.state.dispatch(
                    "GET", self.repo_path + "/labels", self.headers
                )
            ),
            [self.state.issue_label],
        )
        self.assertEqual(
            self.json(
                self.state.dispatch(
                    "GET", self.repo_path + "/assignees", self.headers
                )
            )[0]["login"],
            provider.ACCOUNT_LOGIN,
        )
        self.assertEqual(
            self.json(
                self.state.dispatch(
                    "GET", self.repo_path + "/milestones", self.headers
                )
            ),
            [self.state.issue_milestone],
        )

        pull_requests = self.json(
            self.state.dispatch(
                "GET",
                self.repo_path + "/pulls?state=open&per_page=50&page=1",
                self.headers,
            )
        )
        self.assertEqual(len(pull_requests), 1)
        pull_request = pull_requests[0]
        self.assertEqual(
            pull_request["number"], provider.TRIAGE_PULL_REQUEST_NUMBER
        )
        self.assertEqual(pull_request["head"]["sha"], provider.HEAD_SHA)
        self.assertEqual(
            pull_request["requested_reviewers"][0]["login"],
            provider.ACCOUNT_LOGIN,
        )
        self.assertEqual(
            pull_request["head"]["ref"], provider.TRIAGE_PULL_REQUEST_BRANCH
        )
        self.assertNotEqual(pull_request["head"]["ref"], provider.FEATURE_BRANCH)
        self.assertEqual(self.state.pull_requests, [])

    def test_rejects_every_other_mutation(self) -> None:
        response = self.state.dispatch(
            "POST",
            self.repo_path + "/actions/runs/1/rerun",
            self.headers,
        )
        self.assertEqual(response.status, 405)

        oversized_identifier = "9" * 5_000
        for method, path in (
            (
                "GET",
                self.repo_path + f"/actions/jobs/{oversized_identifier}/logs",
            ),
            (
                "POST",
                self.repo_path + f"/actions/jobs/{oversized_identifier}/rerun",
            ),
        ):
            rejected = self.state.dispatch(method, path, self.headers)
            self.assertEqual(rejected.status, 404)
        self.assertEqual(self.state.rerun_job_ids, set())


class FixtureContractTests(unittest.TestCase):
    def test_prepared_bare_repository_matches_api_default_branch(self) -> None:
        if sys.platform != "win32":
            self.skipTest("The P0 fixture generator is Windows-only")

        git = shutil.which("git")
        powershell = shutil.which("pwsh") or shutil.which("powershell")
        if git is None:
            self.skipTest("git is unavailable")
        if powershell is None:
            self.skipTest("PowerShell is unavailable")

        with tempfile.TemporaryDirectory(
            prefix="desktop-material-p0-ui-contract-parent-"
        ) as temporary:
            run_root = Path(temporary) / "desktop-material-p0-ui-fixture-contract"
            prepared = subprocess.run(
                [
                    powershell,
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(PREPARE_FIXTURE_PATH),
                    "-RunRoot",
                    str(run_root),
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=60,
            )
            receipt_lines = [
                line
                for line in prepared.stdout.splitlines()
                if line.strip().startswith("{")
            ]
            self.assertTrue(receipt_lines, prepared.stdout)
            receipt = json.loads(receipt_lines[-1])
            source = Path(receipt["source"])
            bare = Path(receipt["bare"])

            def run(*arguments: str, cwd: Path) -> str:
                result = subprocess.run(
                    [git, *arguments],
                    cwd=cwd,
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=30,
                )
                return result.stdout.strip()

            expected_default_ref = f"refs/heads/{provider.DEFAULT_BRANCH}"
            self.assertEqual(run("symbolic-ref", "HEAD", cwd=bare), expected_default_ref)
            self.assertTrue(
                run("show-ref", "--verify", expected_default_ref, cwd=bare).endswith(
                    expected_default_ref
                )
            )
            self.assertEqual(
                run("branch", "--show-current", cwd=source), provider.FEATURE_BRANCH
            )
            provider.validate_bare_repository(git, bare)

            run(
                "symbolic-ref",
                "HEAD",
                f"refs/heads/{provider.FEATURE_BRANCH}",
                cwd=bare,
            )
            with self.assertRaisesRegex(
                SystemExit, r"HEAD must match the API default branch \(refs/heads/main\)"
            ):
                provider.validate_bare_repository(git, bare)


class ProviderHTTPIntegrationTests(unittest.TestCase):
    def test_cors_proxy_clone_deepen_and_receive_pack_gate(self) -> None:
        git = shutil.which("git")
        if git is None:
            self.skipTest("git is unavailable")

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            git_root = root / "git-http"
            bare = git_root / provider.OWNER / f"{provider.REPOSITORY}.git"
            clone = root / "clone"
            artifact = root / "artifact.zip"
            request_log = root / "requests.jsonl"

            def run(*arguments: str, cwd: Path | None = None) -> str:
                result = subprocess.run(
                    [git, *arguments],
                    cwd=cwd,
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=30,
                )
                return result.stdout.strip()

            run("init", "-b", provider.DEFAULT_BRANCH, str(source))
            run("config", "user.name", "Material Fixture", cwd=source)
            run(
                "config",
                "user.email",
                "material-fixture@example.invalid",
                cwd=source,
            )
            for index in range(48):
                run(
                    "commit",
                    "--allow-empty",
                    "-m",
                    f"Main fixture commit {index + 1}",
                    cwd=source,
                )
            run("checkout", "-b", provider.FEATURE_BRANCH, cwd=source)
            for index in range(4):
                run(
                    "commit",
                    "--allow-empty",
                    "-m",
                    f"Feature fixture commit {index + 1}",
                    cwd=source,
                )
            bare.parent.mkdir(parents=True)
            run("clone", "--bare", str(source), str(bare))
            run(
                "symbolic-ref",
                "HEAD",
                f"refs/heads/{provider.DEFAULT_BRANCH}",
                cwd=bare,
            )
            run("config", "http.receivepack", "false", cwd=bare)
            provider.validate_bare_repository(git, bare)

            provider.make_deterministic_artifact(artifact)
            state = provider.ProviderState(artifact)
            server = provider.FixtureHTTPServer(
                ("127.0.0.1", 0), state, git_root, request_log, git
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            port = int(server.server_address[1])
            api_repo = (
                f"http://127.0.0.1:{port}/api/v3/repos/"
                f"{provider.OWNER}/{provider.REPOSITORY}"
            )
            try:
                preflight = Request(
                    api_repo,
                    method="OPTIONS",
                    headers={
                        "Origin": "file://",
                        "Access-Control-Request-Method": "GET",
                        "Access-Control-Request-Headers": "authorization,content-type,x-github-api-version",
                    },
                )
                with urlopen(preflight, timeout=10) as response:
                    self.assertEqual(response.status, 204)
                    self.assertEqual(
                        response.headers["Access-Control-Allow-Origin"], "*"
                    )

                repository_request = Request(
                    api_repo,
                    headers={"Authorization": f"Bearer {provider.FIXTURE_TOKEN}"},
                )
                with urlopen(repository_request, timeout=10) as response:
                    repository = json.loads(response.read())
                self.assertEqual(
                    repository["clone_url"], state.repository_clone_url
                )
                self.assertEqual(
                    repository["default_branch"], provider.DEFAULT_BRANCH
                )

                mutation_path = (
                    f"/api/v3/repos/{provider.OWNER}/{provider.REPOSITORY}"
                    f"/actions/jobs/{provider.INSPECTOR_CURRENT_JOB_SENTINEL_ID}/rerun"
                )
                for header, value, expected in (
                    ("Content-Length", "invalid", 400),
                    ("Content-Length", str(16 * 1024 * 1024 + 1), 413),
                    ("Content-Length", "9" * 5_000, 413),
                    ("Transfer-Encoding", "chunked", 400),
                ):
                    connection = HTTPConnection("127.0.0.1", port, timeout=10)
                    connection.putrequest("POST", mutation_path)
                    connection.putheader(
                        "Authorization", f"Bearer {provider.FIXTURE_TOKEN}"
                    )
                    connection.putheader(header, value)
                    connection.endheaders()
                    invalid_response = connection.getresponse()
                    self.assertEqual(invalid_response.status, expected)
                    self.assertEqual(invalid_response.getheader("Connection"), "close")
                    invalid_response.read()
                    connection.close()
                self.assertEqual(state.rerun_job_ids, set())

                proxy = f"http://127.0.0.1:{port}"
                advertised_head = run(
                    "-c",
                    f"http.proxy={proxy}",
                    "ls-remote",
                    "--symref",
                    state.repository_clone_url,
                    "HEAD",
                ).splitlines()
                self.assertEqual(
                    advertised_head[0],
                    f"ref: refs/heads/{provider.DEFAULT_BRANCH}\tHEAD",
                )
                self.assertEqual(
                    advertised_head[1],
                    f"{run('rev-parse', provider.DEFAULT_BRANCH, cwd=bare)}\tHEAD",
                )
                run(
                    "-c",
                    f"http.proxy={proxy}",
                    "clone",
                    "--depth",
                    "32",
                    "--no-single-branch",
                    "--branch",
                    provider.FEATURE_BRANCH,
                    state.repository_clone_url,
                    str(clone),
                )
                run("config", "http.proxy", proxy, cwd=clone)
                remote_output = run("remote", "-v", cwd=clone)
                self.assertIn(provider.FIXTURE_HTML_URL, remote_output)
                self.assertNotIn("127.0.0.1", remote_output)
                self.assertEqual(
                    run("rev-parse", "--is-shallow-repository", cwd=clone),
                    "true",
                )
                before = int(run("rev-list", "--count", "HEAD", cwd=clone))
                run("fetch", "--deepen=2", "origin", cwd=clone)
                after = int(run("rev-list", "--count", "HEAD", cwd=clone))
                self.assertGreater(after, before)
                run("fetch", "--unshallow", "origin", cwd=clone)
                self.assertEqual(
                    run("rev-parse", "--is-shallow-repository", cwd=clone),
                    "false",
                )

                loopback_identity = (
                    f"http://localhost/{provider.OWNER}/"
                    f"{provider.REPOSITORY}.git"
                )
                run("remote", "set-url", "origin", loopback_identity, cwd=clone)
                run("fetch", "--dry-run", "origin", cwd=clone)

                receive_pack_url = (
                    f"http://127.0.0.1:{port}/{provider.OWNER}/"
                    f"{provider.REPOSITORY}.git/info/refs?service=git-receive-pack"
                )
                with self.assertRaises(HTTPError) as failure:
                    urlopen(receive_pack_url, timeout=10)
                self.assertEqual(failure.exception.code, 403)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=10)

            logged = [
                json.loads(line)
                for line in request_log.read_text(encoding="utf-8").splitlines()
            ]
            self.assertTrue(
                any(
                    entry["kind"] == "git"
                    and entry["path"].startswith(
                        f"{provider.FIXTURE_HTML_URL}/{provider.OWNER}/"
                    )
                    for entry in logged
                )
            )
            self.assertTrue(
                any(
                    entry["kind"] == "git"
                    and entry["method"] == "POST"
                    and entry.get("content_encoding") == "gzip"
                    and entry["returncode"] == 0
                    for entry in logged
                ),
                "The unshallow integration did not exercise a successful gzip upload-pack request.",
            )
            self.assertTrue(
                any(
                    entry["kind"] == "git"
                    and entry["path"].startswith(
                        f"http://localhost/{provider.OWNER}/"
                    )
                    for entry in logged
                )
            )


if __name__ == "__main__":
    unittest.main()
