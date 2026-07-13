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
        self.assertEqual(len(second_body["workflow_runs"]), 2)

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
        self.assertEqual(len(self.state.pull_requests), 1)

        wrong_ref = dict(request, base="release")
        rejected = self.state.dispatch(
            "POST",
            self.repo_path + "/pulls",
            self.headers,
            json.dumps(wrong_ref).encode("utf-8"),
        )
        self.assertEqual(rejected.status, 422)
        self.assertEqual(len(self.state.pull_requests), 1)

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
            for index in range(6):
                run(
                    "commit",
                    "--allow-empty",
                    "-m",
                    f"Main fixture commit {index + 1}",
                    cwd=source,
                )
            run("checkout", "-b", provider.FEATURE_BRANCH, cwd=source)
            for index in range(2):
                run(
                    "commit",
                    "--allow-empty",
                    "-m",
                    f"Feature fixture commit {index + 1}",
                    cwd=source,
                )
            bare.parent.mkdir(parents=True)
            run("clone", "--bare", str(source), str(bare))
            run("config", "http.receivepack", "false", cwd=bare)

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
                run(
                    "-c",
                    f"http.proxy={proxy}",
                    "clone",
                    "--depth",
                    "1",
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
                    and entry["path"].startswith(
                        f"http://localhost/{provider.OWNER}/"
                    )
                    for entry in logged
                )
            )


if __name__ == "__main__":
    unittest.main()
