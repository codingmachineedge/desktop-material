#!/usr/bin/env python3
"""Contract tests for the deterministic GitLab merge-request fixture."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from pathlib import Path
from typing import Any, Mapping


MODULE_PATH = Path(__file__).with_name("fake_gitlab_mr_server.py")
SPEC = importlib.util.spec_from_file_location("fake_gitlab_mr_server", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load fixture module: {MODULE_PATH}")
fixture = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = fixture
SPEC.loader.exec_module(fixture)


class GitLabMRFixtureStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = fixture.GitLabMRFixtureState()

    def test_contract_constants_are_exact_and_credential_safe(self) -> None:
        self.assertEqual(fixture.API_PREFIX, "/api/v4")
        self.assertEqual(fixture.PROJECT_PATH, "material-labs/platform/desktop-material")
        self.assertEqual(
            fixture.ENCODED_PROJECT_PATH,
            "material-labs%2Fplatform%2Fdesktop-material",
        )
        snapshot = self.state.snapshot()
        self.assertTrue(snapshot["tokenRequired"])
        self.assertNotIn(fixture.PRIVATE_TOKEN, json.dumps(snapshot, sort_keys=True))

    def test_seed_inventory_and_transient_merge_readiness_are_deterministic(self) -> None:
        values, page, per_page, total = self.state.list_merge_requests(
            {"state": ["opened"], "page": ["1"], "per_page": ["100"]}
        )
        self.assertEqual((page, per_page, total), (1, 100, 3))
        self.assertEqual([value["iid"] for value in values], [41, 40, 38])
        self.assertEqual(values[0]["detailed_merge_status"], "checking")
        self.assertEqual(values[1]["detailed_merge_status"], "draft_status")
        self.assertEqual(values[2]["detailed_merge_status"], "mergeable")

        statuses = [
            self.state.get_merge_request(41)["detailed_merge_status"]
            for _index in range(4)
        ]
        self.assertEqual(
            statuses,
            ["checking", "approvals_syncing", "not_approved", "not_approved"],
        )

    def test_create_and_update_cover_draft_reviewers_assignees_and_lifecycle(self) -> None:
        created = self.state.create_merge_request(
            {
                "source_branch": "feature/provider-neutral-mr",
                "target_branch": "main",
                "title": "[Draft] Add native GitLab review",
                "description": "Review workflow",
                "reviewer_ids": [101, 103],
                "assignee_ids": [104],
                "remove_source_branch": True,
                "squash": True,
            }
        )
        self.assertEqual(created["iid"], 42)
        self.assertTrue(created["draft"])
        self.assertEqual(
            [user["id"] for user in created["reviewers"]], [101, 103]
        )
        self.assertEqual([user["id"] for user in created["assignees"]], [104])
        self.assertTrue(created["remove_source_branch"])
        self.assertTrue(created["squash"])

        updated = self.state.update_merge_request(
            42,
            {
                "title": "Add native GitLab review",
                "reviewer_ids": [103],
                "assignee_ids": [0],
                "state_event": "close",
            },
        )
        self.assertFalse(updated["draft"])
        self.assertEqual([user["id"] for user in updated["reviewers"]], [103])
        self.assertEqual(updated["assignees"], [])
        self.assertEqual(updated["state"], "closed")
        reopened = self.state.update_merge_request(42, {"state_event": "reopen"})
        self.assertEqual(reopened["state"], "opened")

        operations = [
            event.get("operation") for event in self.state.audit_log.snapshot()
        ]
        self.assertEqual(operations, ["create", "update", "update"])

    def test_sha_guarded_approve_and_unapprove_preserve_state_on_mismatch(self) -> None:
        head_sha = self.state.get_merge_request(41)["sha"]
        with self.assertRaises(fixture.FixtureAPIError) as mismatch:
            self.state.approve(41, {"sha": "f" * 40})
        self.assertEqual(mismatch.exception.status, 409)
        self.assertEqual(
            self.state.approval_state(41)["rules"][0]["approved_by"], []
        )
        self.assertEqual(self.state.audit_log.snapshot(), [])

        approved = self.state.approve(41, {"sha": head_sha})
        self.assertEqual(approved["approvals_left"], 0)
        self.assertEqual(approved["approved_by"][0]["user"]["id"], 101)
        self.assertEqual(approved["detailed_merge_status"], "mergeable")
        state = self.state.approval_state(41)
        self.assertTrue(state["rules"][0]["approved"])

        unapproved = self.state.unapprove(41)
        self.assertEqual(unapproved["approvals_left"], 1)
        self.assertEqual(unapproved["approved_by"], [])

    def test_validation_rejects_unknown_users_fields_and_unbounded_pagination(self) -> None:
        invalid_requests = (
            lambda: self.state.create_merge_request(
                {
                    "source_branch": "feature/x",
                    "target_branch": "main",
                    "title": "Title",
                    "reviewer_ids": [999],
                }
            ),
            lambda: self.state.update_merge_request(41, {"unknown": True}),
            lambda: self.state.list_merge_requests({"per_page": ["101"]}),
            lambda: self.state.list_merge_requests(
                {"page": ["1000"], "per_page": ["100"]}
            ),
            lambda: self.state.list_merge_requests({"page": ["1", "2"]}),
        )
        for operation in invalid_requests:
            with self.subTest(operation=operation):
                with self.assertRaises(fixture.FixtureAPIError) as failure:
                    operation()
                self.assertEqual(failure.exception.status, 400)

    def test_concurrent_creates_have_unique_iids_and_contiguous_audit_sequences(self) -> None:
        def create(index: int) -> int:
            return self.state.create_merge_request(
                {
                    "source_branch": f"feature/concurrent-{index}",
                    "target_branch": "main",
                    "title": f"Concurrent MR {index}",
                }
            )["iid"]

        with ThreadPoolExecutor(max_workers=8) as executor:
            iids = list(executor.map(create, range(24)))
        self.assertEqual(sorted(iids), list(range(42, 66)))
        events = self.state.audit_log.snapshot()
        self.assertEqual(
            [event["sequence"] for event in events], list(range(1, len(events) + 1))
        )
        serialized = "\n".join(json.dumps(event) for event in events)
        self.assertNotIn(fixture.PRIVATE_TOKEN, serialized)


class GitLabMRFixtureHTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = fixture.GitLabMRFixtureState()
        self.server = fixture.GitLabMRFixtureHTTPServer(
            (fixture.LOOPBACK_ADDRESS, 0), self.state, response_delay_ms=150
        )
        self.port = int(self.server.server_address[1])
        self.server.endpoint = f"http://{fixture.LOOPBACK_ADDRESS}:{self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.assertFalse(self.thread.is_alive())

    @property
    def project_api(self) -> str:
        return (
            f"{fixture.API_PREFIX}/projects/{fixture.ENCODED_PROJECT_PATH}"
        )

    def request(
        self,
        method: str,
        path: str,
        payload: object | None = None,
        *,
        raw_body: bytes | None = None,
        headers: Mapping[str, str] | None = None,
        authenticate: bool = True,
    ) -> tuple[int, dict[str, str], bytes]:
        if payload is not None and raw_body is not None:
            raise AssertionError("provide payload or raw_body, not both")
        request_headers = dict(headers or {})
        if authenticate:
            request_headers.setdefault("PRIVATE-TOKEN", fixture.PRIVATE_TOKEN)
        body = raw_body
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        connection = HTTPConnection(fixture.LOOPBACK_ADDRESS, self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            response_headers = {key: value for key, value in response.getheaders()}
            return response.status, response_headers, response.read()
        finally:
            connection.close()

    def json_request(
        self,
        method: str,
        path: str,
        payload: object | None = None,
        **kwargs: Any,
    ) -> tuple[int, dict[str, str], Any]:
        status, headers, body = self.request(method, path, payload, **kwargs)
        return status, headers, json.loads(body) if body else None

    def set_fault(self, mode: str) -> None:
        status, _, result = self.json_request(
            "POST",
            "/__fixture__/fault",
            {"mode": mode},
            authenticate=False,
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["faultMode"], mode)

    def test_health_and_state_are_credential_free(self) -> None:
        status, _, health = self.json_request(
            "GET", "/__fixture__/health", authenticate=False
        )
        self.assertEqual(status, 200)
        self.assertEqual(health["status"], "ok")
        self.assertTrue(health["tokenRequired"])
        status, _, state = self.json_request(
            "GET", "/__fixture__/state", authenticate=False
        )
        self.assertEqual(status, 200)
        self.assertNotIn(
            fixture.PRIVATE_TOKEN,
            json.dumps({"health": health, "state": state}, sort_keys=True),
        )

    def test_private_token_header_is_exact_and_alternatives_are_rejected(self) -> None:
        path = f"{self.project_api}/merge_requests"
        cases = (
            ({}, False),
            ({"PRIVATE-TOKEN": "wrong"}, False),
            ({"Authorization": f"Bearer {fixture.PRIVATE_TOKEN}"}, False),
        )
        for headers, authenticate in cases:
            with self.subTest(headers=headers):
                status, _, body = self.json_request(
                    "GET",
                    path,
                    headers=headers,
                    authenticate=authenticate,
                )
                self.assertEqual(status, 401)
                self.assertEqual(body, {"message": "401 Unauthorized"})

        status, _, values = self.json_request("GET", path)
        self.assertEqual(status, 200)
        self.assertGreater(len(values), 0)
        status, _, _ = self.json_request(
            "GET",
            f"{path}?private_token={fixture.PRIVATE_TOKEN}",
            authenticate=False,
        )
        self.assertEqual(status, 401)

    def test_duplicate_private_token_headers_are_rejected(self) -> None:
        path = f"{self.project_api}/merge_requests"
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {fixture.LOOPBACK_ADDRESS}:{self.port}\r\n"
            f"PRIVATE-TOKEN: {fixture.PRIVATE_TOKEN}\r\n"
            f"PRIVATE-TOKEN: {fixture.PRIVATE_TOKEN}\r\n"
            "Connection: close\r\n\r\n"
        ).encode("ascii")
        with socket.create_connection(
            (fixture.LOOPBACK_ADDRESS, self.port), timeout=5
        ) as client:
            client.sendall(request)
            response = client.recv(4096)
        self.assertIn(b" 401 ", response.split(b"\r\n", 1)[0])

    def test_nested_project_path_must_be_one_url_encoded_segment(self) -> None:
        status, _, project = self.json_request("GET", self.project_api)
        self.assertEqual(status, 200)
        self.assertEqual(project["path_with_namespace"], fixture.PROJECT_PATH)
        status, _, numeric = self.json_request(
            "GET", f"{fixture.API_PREFIX}/projects/{fixture.PROJECT_ID}"
        )
        self.assertEqual(status, 200)
        self.assertEqual(numeric["id"], fixture.PROJECT_ID)

        raw_path = f"{fixture.API_PREFIX}/projects/{fixture.PROJECT_PATH}/merge_requests"
        status, _, body = self.json_request("GET", raw_path)
        self.assertEqual(status, 404)
        self.assertEqual(body, {"message": "404 Not found"})
        double_encoded = fixture.ENCODED_PROJECT_PATH.replace("%", "%25")
        status, _, _ = self.json_request(
            "GET",
            f"{fixture.API_PREFIX}/projects/{double_encoded}/merge_requests",
        )
        self.assertEqual(status, 404)

    def test_offset_pagination_emits_link_and_complete_x_header_family(self) -> None:
        path = f"{self.project_api}/merge_requests?state=all&per_page=2&page=2"
        status, headers, values = self.json_request("GET", path)
        self.assertEqual(status, 200)
        self.assertEqual([value["iid"] for value in values], [39, 38])
        expected = {
            "X-Next-Page": "3",
            "X-Page": "2",
            "X-Per-Page": "2",
            "X-Prev-Page": "1",
            "X-Total": "5",
            "X-Total-Pages": "3",
        }
        for key, value in expected.items():
            self.assertEqual(headers[key], value)
        self.assertIn('rel="first"', headers["Link"])
        self.assertIn('rel="prev"', headers["Link"])
        self.assertIn('rel="next"', headers["Link"])
        self.assertIn('rel="last"', headers["Link"])
        self.assertIn(f"http://127.0.0.1:{self.port}", headers["Link"])
        self.assertIn(f"projects/{fixture.ENCODED_PROJECT_PATH}", headers["Link"])

        for query in ("per_page=101", "page=1000&per_page=100", "page=0"):
            status, _, body = self.json_request(
                "GET", f"{self.project_api}/merge_requests?{query}"
            )
            self.assertEqual(status, 400)
            self.assertEqual(set(body), {"message"})

    def test_single_status_create_update_members_and_approval_lifecycle(self) -> None:
        single = f"{self.project_api}/merge_requests/41"
        statuses = []
        for _index in range(3):
            status, _, body = self.json_request(
                "GET", f"{single}?with_merge_status_recheck=true"
            )
            self.assertEqual(status, 200)
            statuses.append(body["detailed_merge_status"])
        self.assertEqual(statuses, ["checking", "approvals_syncing", "not_approved"])
        head_sha = body["sha"]

        status, _, created = self.json_request(
            "POST",
            f"{self.project_api}/merge_requests",
            {
                "source_branch": "feature/native-review",
                "target_branch": "main",
                "title": "(Draft) Native GitLab review",
                "description": "Synthetic acceptance MR",
                "reviewer_ids": [101, 103],
                "assignee_ids": [104],
            },
        )
        self.assertEqual(status, 201)
        self.assertTrue(created["draft"])
        iid = created["iid"]

        status, _, updated = self.json_request(
            "PUT",
            f"{self.project_api}/merge_requests/{iid}",
            {
                "title": "Native GitLab review",
                "reviewer_ids": [103],
                "assignee_ids": [101, 104],
            },
        )
        self.assertEqual(status, 200)
        self.assertFalse(updated["draft"])
        self.assertEqual([user["id"] for user in updated["reviewers"]], [103])
        self.assertEqual(
            [user["id"] for user in updated["assignees"]], [101, 104]
        )

        status, headers, members = self.json_request(
            "GET", f"{self.project_api}/members/all?per_page=2&page=1"
        )
        self.assertEqual(status, 200)
        self.assertEqual([member["id"] for member in members], [101, 102])
        self.assertEqual(headers["X-Next-Page"], "2")

        status, _, mismatch = self.json_request(
            "POST", f"{single}/approve", {"sha": "f" * 40}
        )
        self.assertEqual(status, 409)
        self.assertIn("SHA", mismatch["message"])
        status, _, approved = self.json_request(
            "POST", f"{single}/approve", {"sha": head_sha}
        )
        self.assertEqual(status, 201)
        self.assertEqual(approved["approvals_left"], 0)
        status, _, approval_state = self.json_request(
            "GET", f"{single}/approval_state"
        )
        self.assertEqual(status, 200)
        self.assertTrue(approval_state["rules"][0]["approved"])
        status, _, unapproved = self.json_request(
            "POST", f"{single}/unapprove", {}
        )
        self.assertEqual(status, 200)
        self.assertEqual(unapproved["approvals_left"], 1)

    def test_fault_profiles_are_deterministic_and_resettable(self) -> None:
        list_path = f"{self.project_api}/merge_requests"
        self.set_fault("unavailable")
        status, _, body = self.json_request("GET", list_path)
        self.assertEqual(status, 503)
        self.assertEqual(set(body), {"message"})

        self.set_fault("error")
        status, _, body = self.json_request("GET", list_path)
        self.assertEqual(status, 500)
        self.assertEqual(set(body), {"message"})

        self.set_fault("malformed")
        status, headers, body = self.request("GET", list_path)
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("application/json"))
        with self.assertRaises(json.JSONDecodeError):
            json.loads(body)

        self.set_fault("partial")
        status, _, values = self.json_request("GET", list_path)
        self.assertEqual(status, 200)
        self.assertGreater(len(values), 0)
        status, _, _ = self.json_request(
            "GET", f"{self.project_api}/members/all"
        )
        self.assertEqual(status, 503)
        status, _, _ = self.json_request(
            "GET", f"{self.project_api}/merge_requests/41/approval_state"
        )
        self.assertEqual(status, 503)

        status, _, reset = self.json_request(
            "POST", "/__fixture__/reset", {}, authenticate=False
        )
        self.assertEqual(status, 200)
        self.assertEqual(reset["faultMode"], "none")

    def test_malformed_and_oversized_bodies_are_bounded_without_mutation(self) -> None:
        path = f"{self.project_api}/merge_requests"
        initial = self.state.snapshot()
        cases = (
            (b"{", "application/json", 400),
            (b"[]", "application/json", 400),
            (b"{}", "application/json", 400),
            (b"x=1", "application/x-www-form-urlencoded", 415),
        )
        for body, content_type, expected in cases:
            with self.subTest(body=body):
                status, _, result = self.json_request(
                    "POST",
                    path,
                    raw_body=body,
                    headers={"Content-Type": content_type},
                )
                self.assertEqual(status, expected)
                self.assertEqual(set(result), {"message"})
        self.assertEqual(self.state.snapshot(), initial)

        connection = HTTPConnection(fixture.LOOPBACK_ADDRESS, self.port, timeout=5)
        connection.putrequest("POST", path)
        connection.putheader("PRIVATE-TOKEN", fixture.PRIVATE_TOKEN)
        connection.putheader("Content-Type", "application/json")
        connection.putheader(
            "Content-Length", str(fixture.MAX_REQUEST_BODY_BYTES + 1)
        )
        connection.endheaders()
        response = connection.getresponse()
        self.assertEqual(response.status, 413)
        self.assertEqual(set(json.loads(response.read())), {"message"})
        connection.close()
        self.assertEqual(self.state.snapshot(), initial)

    def test_delayed_disconnect_is_logged_as_cancelled_without_stderr_noise(self) -> None:
        self.set_fault("delayed")
        path = f"{self.project_api}/merge_requests/41"
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {fixture.LOOPBACK_ADDRESS}:{self.port}\r\n"
            f"PRIVATE-TOKEN: {fixture.PRIVATE_TOKEN}\r\n"
            "Connection: close\r\n\r\n"
        ).encode("ascii")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            client = socket.create_connection(
                (fixture.LOOPBACK_ADDRESS, self.port), timeout=5
            )
            linger = struct.pack("hh", 1, 0)
            client.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, linger)
            client.sendall(request)
            active_deadline = time.monotonic() + 2
            while (
                self.state.snapshot()["activeDelayedRequests"] == 0
                and time.monotonic() < active_deadline
            ):
                time.sleep(0.01)
            self.assertEqual(self.state.snapshot()["activeDelayedRequests"], 1)
            client.close()
            deadline = time.monotonic() + 3
            cancelled: list[dict[str, Any]] = []
            while time.monotonic() < deadline:
                cancelled = [
                    event
                    for event in self.state.audit_log.snapshot()
                    if event.get("kind") == "request"
                    and event.get("outcome") == "cancelled"
                ]
                if cancelled:
                    break
                time.sleep(0.02)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(len(cancelled), 1)
        self.assertIn(cancelled[0]["route"], ("api-delayed", "merge-request-single"))
        self.assertNotIn("status", cancelled[0])


class GitLabMROwnershipTests(unittest.TestCase):
    def test_owned_receipt_and_audit_files_never_contain_private_token(self) -> None:
        temp_root = Path(os.environ["TEMP"]).resolve(strict=True)
        run_root = Path(
            tempfile.mkdtemp(
                prefix="desktop-material-gitlab-mr-unit-", dir=temp_root
            )
        )
        owned = run_root / fixture.OWNED_DIRECTORY_NAME
        ready = owned / fixture.READY_FILE_NAME
        mutation_log = owned / fixture.MUTATION_LOG_FILE_NAME
        try:
            paths = fixture.resolve_owned_paths(run_root, ready, mutation_log)
            audit = fixture.FixtureAuditLog(paths.mutation_log)
            state = fixture.GitLabMRFixtureState(audit)
            state.create_merge_request(
                {
                    "source_branch": "feature/receipt-test",
                    "target_branch": "main",
                    "title": "Receipt test",
                }
            )
            audit.close()
            receipt = {
                "fixture": fixture.FIXTURE_ID,
                "tokenRequired": True,
                "endpoint": "http://127.0.0.1:12345",
            }
            fixture._write_ready_file(paths.ready_file, receipt)
            self.assertNotIn(fixture.PRIVATE_TOKEN, ready.read_text(encoding="utf-8"))
            self.assertNotIn(
                fixture.PRIVATE_TOKEN, mutation_log.read_text(encoding="utf-8")
            )
        finally:
            if run_root.exists():
                for child in sorted(run_root.rglob("*"), reverse=True):
                    if child.is_file():
                        child.unlink()
                    elif child.is_dir():
                        child.rmdir()
                run_root.rmdir()

    def test_resolve_owned_paths_rejects_non_owned_names(self) -> None:
        temp_root = Path(os.environ["TEMP"]).resolve(strict=True)
        run_root = Path(tempfile.mkdtemp(prefix="gitlab-unowned-", dir=temp_root))
        try:
            with self.assertRaises(ValueError):
                fixture.resolve_owned_paths(
                    run_root,
                    run_root / fixture.OWNED_DIRECTORY_NAME / fixture.READY_FILE_NAME,
                    run_root
                    / fixture.OWNED_DIRECTORY_NAME
                    / fixture.MUTATION_LOG_FILE_NAME,
                )
        finally:
            run_root.rmdir()


if __name__ == "__main__":
    unittest.main(verbosity=2)
