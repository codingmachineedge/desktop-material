from __future__ import annotations

import ast
import importlib.util
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("fake_ollama_server.py")
SPEC = importlib.util.spec_from_file_location("fake_ollama_server", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
fixture = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = fixture
SPEC.loader.exec_module(fixture)


class OllamaFixtureStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = fixture.OllamaFixtureState()

    def test_seed_inventory_is_identity_safe_and_official_shaped(self) -> None:
        tags = self.state.tags()["models"]
        self.assertEqual(
            [model["name"] for model in tags],
            [
                "material-chat:7b",
                "material-embed:latest",
                "material-vision:3b",
            ],
        )
        for model in tags:
            self.assertEqual(model["name"], model["model"])
            self.assertRegex(model["digest"], r"^[0-9a-f]{64}$")
            self.assertEqual(model["details"]["format"], "gguf")
            self.assertTrue(model["details"]["family"].startswith("material"))
            self.assertTrue(model["details"]["parameter_size"])
            self.assertTrue(model["details"]["quantization_level"])
        self.assertNotIn(str(Path.home()).lower(), json.dumps(tags).lower())

        running = self.state.running_models()["models"]
        self.assertEqual([model["name"] for model in running], ["material-chat:7b"])
        self.assertEqual(running[0]["expires_at"], fixture.FIXED_EXPIRY)
        self.assertGreater(running[0]["size_vram"], 0)
        self.assertGreater(running[0]["context_length"], 0)

    def test_show_exposes_details_model_info_and_capabilities(self) -> None:
        for name, expected_capability in (
            ("material-chat:7b", "tools"),
            ("material-embed", "embedding"),
            ("material-vision:3b", "vision"),
        ):
            shown = self.state.show_model({"model": name})
            self.assertIn(expected_capability, shown["capabilities"])
            self.assertIn("general.architecture", shown["model_info"])
            self.assertGreater(shown["model_info"]["general.parameter_count"], 0)
            self.assertIn("num_ctx", shown["parameters"])
            self.assertIn("Synthetic fixture", shown["license"])

    def test_pull_has_bounded_monotonic_progress_and_commits_atomically(self) -> None:
        plan = self.state.begin_pull({"model": "material-code:1.5b"})
        progress = [frame for frame in plan.frames if "completed" in frame]
        self.assertGreaterEqual(len(plan.frames), 6)
        self.assertEqual(plan.frames[0], {"status": "pulling manifest"})
        self.assertEqual(plan.frames[-1], {"status": "success"})
        self.assertEqual(
            [frame["completed"] for frame in progress],
            sorted(frame["completed"] for frame in progress),
        )
        self.assertEqual(progress[0]["completed"], 0)
        self.assertEqual(progress[-1]["completed"], progress[-1]["total"])
        self.assertEqual(
            self.state.snapshot()["activePulls"], ["material-code:1.5b"]
        )
        self.state.complete_pull(plan)
        self.assertIn(
            "material-code:1.5b",
            [model["name"] for model in self.state.tags()["models"]],
        )
        self.assertEqual(self.state.snapshot()["activePulls"], [])

    def test_abandoned_pull_releases_reservation_without_installing(self) -> None:
        plan = self.state.begin_pull({"model": "material-code:1.5b"})
        self.state.abandon_pull(plan)
        self.assertEqual(self.state.snapshot()["activePulls"], [])
        self.assertNotIn(
            "material-code:1.5b",
            [model["name"] for model in self.state.tags()["models"]],
        )

    def test_copy_load_unload_and_delete_lifecycle(self) -> None:
        self.state.copy_model(
            {
                "source": "material-vision:3b",
                "destination": "material-vision-copy:3b",
            }
        )
        copied = self.state.show_model({"model": "material-vision-copy:3b"})
        self.assertIn("vision", copied["capabilities"])

        loaded = self.state.generate(
            {"model": "material-vision-copy:3b", "keep_alive": -1}
        )
        self.assertEqual(loaded["done_reason"], "load")
        self.assertIn(
            "material-vision-copy:3b", self.state.snapshot()["runningModels"]
        )

        unloaded = self.state.generate(
            {"model": "material-vision-copy:3b", "keep_alive": "0s"}
        )
        self.assertEqual(unloaded["done_reason"], "unload")
        self.assertNotIn(
            "material-vision-copy:3b", self.state.snapshot()["runningModels"]
        )
        self.state.delete_model({"model": "material-vision-copy:3b"})
        self.assertNotIn(
            "material-vision-copy:3b", self.state.snapshot()["installedModels"]
        )

    def test_not_found_conflict_and_malformed_state_operations(self) -> None:
        cases = (
            (lambda: self.state.show_model({"model": "missing:latest"}), 404),
            (
                lambda: self.state.copy_model(
                    {"source": "missing:latest", "destination": "copy:latest"}
                ),
                404,
            ),
            (
                lambda: self.state.copy_model(
                    {
                        "source": "material-vision:3b",
                        "destination": "material-chat:7b",
                    }
                ),
                409,
            ),
            (lambda: self.state.delete_model({"model": "material-chat:7b"}), 409),
            (lambda: self.state.begin_pull({"model": "material-chat:7b"}), 409),
            (lambda: self.state.begin_pull({"model": "missing:latest"}), 404),
            (lambda: self.state.generate({"model": "missing:latest"}), 404),
            (lambda: self.state.show_model({}), 400),
            (
                lambda: self.state.generate(
                    {"model": "material-chat:7b", "keep_alive": {}}
                ),
                400,
            ),
        )
        for operation, expected_status in cases:
            with self.subTest(expected_status=expected_status):
                with self.assertRaises(fixture.FixtureAPIError) as failure:
                    operation()
                self.assertEqual(failure.exception.status, expected_status)

    def test_copy_conflict_is_thread_safe(self) -> None:
        request = {
            "source": "material-vision:3b",
            "destination": "thread-race-copy:3b",
        }

        def attempt_copy() -> int:
            try:
                self.state.copy_model(request)
                return 200
            except fixture.FixtureAPIError as error:
                return error.status

        with ThreadPoolExecutor(max_workers=8) as executor:
            statuses = list(executor.map(lambda _index: attempt_copy(), range(8)))
        self.assertEqual(statuses.count(200), 1)
        self.assertEqual(statuses.count(409), 7)

    def test_reset_restores_exact_seed_state(self) -> None:
        self.state.copy_model(
            {
                "source": "material-vision:3b",
                "destination": "temporary-copy:latest",
            }
        )
        self.state.generate({"model": "material-vision:3b", "keep_alive": -1})
        self.state.reset()
        self.assertEqual(
            self.state.snapshot(),
            {
                "fixture": fixture.FIXTURE_ID,
                "installedModels": [
                    "material-chat:7b",
                    "material-embed:latest",
                    "material-vision:3b",
                ],
                "runningModels": ["material-chat:7b"],
                "activePulls": [],
                "pullableModels": ["material-code:1.5b"],
            },
        )


class OllamaFixtureHTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = fixture.OllamaFixtureState()
        self.server = fixture.OllamaFixtureHTTPServer(
            (fixture.LOOPBACK_ADDRESS, 0), self.state, pull_frame_delay_ms=1
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = int(self.server.server_address[1])

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.assertFalse(self.thread.is_alive())

    def request(
        self,
        method: str,
        path: str,
        payload: object | None = None,
        *,
        raw_body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, Mapping[str, str], bytes]:
        if raw_body is not None and payload is not None:
            raise AssertionError("provide payload or raw_body, not both")
        body = raw_body
        request_headers = dict(headers or {})
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        connection = HTTPConnection(fixture.LOOPBACK_ADDRESS, self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def json_request(
        self, method: str, path: str, payload: object | None = None
    ) -> tuple[int, Mapping[str, str], object | None]:
        status, headers, body = self.request(method, path, payload)
        return status, headers, json.loads(body) if body else None

    def test_health_version_inventory_show_and_preflight(self) -> None:
        status, _, health = self.json_request("GET", "/__fixture__/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["status"], "ok")

        status, _, version = self.json_request("GET", "/api/version")
        self.assertEqual(status, 200)
        self.assertEqual(version, {"version": fixture.OLLAMA_VERSION})

        status, _, tags = self.json_request("GET", "/api/tags")
        self.assertEqual(status, 200)
        self.assertEqual(len(tags["models"]), 3)

        status, _, running = self.json_request("GET", "/api/ps")
        self.assertEqual(status, 200)
        self.assertEqual(running["models"][0]["model"], "material-chat:7b")

        status, _, shown = self.json_request(
            "POST", "/api/show", {"model": "material-vision:3b"}
        )
        self.assertEqual(status, 200)
        self.assertIn("vision", shown["capabilities"])

        status, headers, body = self.request(
            "OPTIONS",
            "/api/tags",
            headers={
                "Origin": "file://",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        self.assertEqual(status, 204)
        self.assertEqual(body, b"")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")

    def test_streaming_pull_emits_multiple_ndjson_progress_frames(self) -> None:
        status, headers, body = self.request(
            "POST",
            "/api/pull",
            {"model": "material-code:1.5b", "stream": True},
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/x-ndjson")
        frames = [json.loads(line) for line in body.splitlines()]
        self.assertGreaterEqual(len(frames), 6)
        self.assertEqual(frames[0]["status"], "pulling manifest")
        self.assertEqual(frames[-1], {"status": "success"})
        progress = [frame for frame in frames if "completed" in frame]
        self.assertEqual(progress[0]["completed"], 0)
        self.assertEqual(progress[-1]["completed"], progress[-1]["total"])

        status, _, shown = self.json_request(
            "POST", "/api/show", {"model": "material-code:1.5b"}
        )
        self.assertEqual(status, 200)
        self.assertIn("tools", shown["capabilities"])

    def test_non_streaming_pull_returns_single_json_object(self) -> None:
        status, headers, result = self.json_request(
            "POST",
            "/api/pull",
            {"model": "material-code:1.5b", "stream": False},
        )
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("application/json"))
        self.assertEqual(result, {"status": "success"})

    def test_copy_generate_load_unload_and_delete_over_http(self) -> None:
        status, _, body = self.request(
            "POST",
            "/api/copy",
            payload={
                "source": "material-vision:3b",
                "destination": "manager-copy:3b",
            },
        )
        self.assertEqual((status, body), (200, b""))

        status, _, loaded = self.json_request(
            "POST",
            "/api/generate",
            {
                "model": "manager-copy:3b",
                "prompt": "",
                "keep_alive": -1,
                "stream": False,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(loaded["done_reason"], "load")
        status, _, running = self.json_request("GET", "/api/ps")
        self.assertIn(
            "manager-copy:3b", [model["name"] for model in running["models"]]
        )

        status, _, unloaded = self.json_request(
            "POST",
            "/api/generate",
            {
                "model": "manager-copy:3b",
                "prompt": "",
                "keep_alive": 0,
                "stream": False,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(unloaded["done_reason"], "unload")
        status, _, body = self.request(
            "DELETE", "/api/delete", payload={"model": "manager-copy:3b"}
        )
        self.assertEqual((status, body), (200, b""))

    def test_not_found_and_conflict_errors_are_ollama_shaped(self) -> None:
        cases = (
            ("POST", "/api/show", {"model": "missing:latest"}, 404),
            (
                "POST",
                "/api/copy",
                {"source": "missing:latest", "destination": "copy:latest"},
                404,
            ),
            (
                "POST",
                "/api/copy",
                {"source": "material-vision:3b", "destination": "material-chat:7b"},
                409,
            ),
            ("DELETE", "/api/delete", {"model": "material-chat:7b"}, 409),
            ("POST", "/api/pull", {"model": "material-chat:7b"}, 409),
            ("POST", "/api/pull", {"model": "missing:latest"}, 404),
            ("POST", "/api/generate", {"model": "missing:latest"}, 404),
        )
        for method, path, payload, expected_status in cases:
            with self.subTest(method=method, path=path, expected=expected_status):
                status, _, result = self.json_request(method, path, payload)
                self.assertEqual(status, expected_status)
                self.assertEqual(set(result), {"error"})
                self.assertIsInstance(result["error"], str)

    def test_malformed_requests_are_bounded_and_do_not_mutate_state(self) -> None:
        initial = self.state.snapshot()
        cases = (
            (b"{", 400),
            (b"[]", 400),
            (b"{}", 400),
            (json.dumps({"model": "../unsafe"}).encode(), 400),
            (
                json.dumps(
                    {"model": "material-chat:7b", "stream": "true"}
                ).encode(),
                400,
            ),
        )
        for body, expected_status in cases:
            with self.subTest(body=body):
                status, _, response_body = self.request(
                    "POST", "/api/show" if body != cases[-1][0] else "/api/pull", raw_body=body
                )
                self.assertEqual(status, expected_status)
                self.assertEqual(set(json.loads(response_body)), {"error"})
        self.assertEqual(self.state.snapshot(), initial)

        for header, expected_status in (
            (("Content-Length", "invalid"), 400),
            (("Content-Length", str(fixture.MAX_REQUEST_BODY_BYTES + 1)), 413),
            (("Transfer-Encoding", "chunked"), 400),
        ):
            connection = HTTPConnection(fixture.LOOPBACK_ADDRESS, self.port, timeout=5)
            connection.putrequest("POST", "/api/show")
            connection.putheader(*header)
            connection.endheaders()
            if header[0] == "Transfer-Encoding":
                connection.send(b"0\r\n\r\n")
            response = connection.getresponse()
            self.assertEqual(response.status, expected_status)
            self.assertEqual(set(json.loads(response.read())), {"error"})
            connection.close()
        self.assertEqual(self.state.snapshot(), initial)

    def test_disconnect_during_pull_is_safe_and_bounded(self) -> None:
        self.server.pull_frame_delay_seconds = 0.025
        body = json.dumps(
            {"model": "material-code:1.5b", "stream": True}
        ).encode("utf-8")
        connection = HTTPConnection(fixture.LOOPBACK_ADDRESS, self.port, timeout=5)
        connection.request(
            "POST",
            "/api/pull",
            body=body,
            headers={"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        first_line = response.readline()
        self.assertEqual(json.loads(first_line)["status"], "pulling manifest")
        connection.close()

        deadline = time.monotonic() + 2
        while self.state.snapshot()["activePulls"] and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertEqual(self.state.snapshot()["activePulls"], [])
        status, _, health = self.json_request("GET", "/__fixture__/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["status"], "ok")

    def test_fixture_state_and_reset_endpoints_restore_repeatability(self) -> None:
        self.state.copy_model(
            {"source": "material-vision:3b", "destination": "temporary:latest"}
        )
        status, _, changed = self.json_request("GET", "/__fixture__/state")
        self.assertEqual(status, 200)
        self.assertIn("temporary:latest", changed["installedModels"])

        status, _, reset = self.json_request("POST", "/__fixture__/reset", {})
        self.assertEqual(status, 200)
        self.assertNotIn("temporary:latest", reset["installedModels"])
        self.assertEqual(reset["runningModels"], ["material-chat:7b"])

        status, _, malformed = self.json_request(
            "POST", "/__fixture__/reset", {"unexpected": True}
        )
        self.assertEqual(status, 400)
        self.assertEqual(set(malformed), {"error"})

    def test_unknown_routes_and_wrong_methods_are_json_errors(self) -> None:
        status, _, missing = self.json_request("GET", "/api/missing")
        self.assertEqual(status, 404)
        self.assertEqual(set(missing), {"error"})
        status, _, wrong_method = self.json_request("POST", "/api/tags", {})
        self.assertEqual(status, 405)
        self.assertEqual(set(wrong_method), {"error"})


class OllamaFixtureStartupTests(unittest.TestCase):
    def test_standard_library_only_and_non_loopback_binds_are_rejected(self) -> None:
        tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
        imported_roots = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".")[0])
        self.assertTrue(imported_roots <= sys.stdlib_module_names | {"__future__"})
        self.assertNotIn("socket", imported_roots)
        self.assertNotIn("subprocess", imported_roots)
        with self.assertRaisesRegex(ValueError, "only to 127.0.0.1"):
            fixture.OllamaFixtureHTTPServer(("0.0.0.0", 0))
        with self.assertRaisesRegex(ValueError, "only to 127.0.0.1"):
            fixture.OllamaFixtureHTTPServer(("::1", 0))

    def test_server_supports_ephemeral_and_explicit_loopback_ports(self) -> None:
        ephemeral = fixture.OllamaFixtureHTTPServer((fixture.LOOPBACK_ADDRESS, 0))
        try:
            self.assertGreater(ephemeral.server_address[1], 0)
        finally:
            ephemeral.server_close()

        reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        reservation.bind((fixture.LOOPBACK_ADDRESS, 0))
        explicit_port = reservation.getsockname()[1]
        reservation.close()
        explicit = fixture.OllamaFixtureHTTPServer(
            (fixture.LOOPBACK_ADDRESS, explicit_port)
        )
        try:
            self.assertEqual(explicit.server_address[1], explicit_port)
        finally:
            explicit.server_close()

    def test_ready_receipt_and_stdout_metadata_exclude_personal_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            ready_file = Path(temporary) / "ready.json"
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(MODULE_PATH),
                    "--port",
                    "0",
                    "--pull-frame-delay-ms",
                    "0",
                    "--ready-file",
                    str(ready_file),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                deadline = time.monotonic() + 5
                while not ready_file.exists() and time.monotonic() < deadline:
                    if process.poll() is not None:
                        stderr = process.stderr.read() if process.stderr else ""
                        self.fail(f"fixture exited before readiness: {stderr}")
                    time.sleep(0.02)
                self.assertTrue(ready_file.exists(), "fixture ready receipt was not written")
                receipt = json.loads(ready_file.read_text(encoding="utf-8"))
                stdout_receipt = json.loads(process.stdout.readline())
                self.assertEqual(receipt, stdout_receipt)
                self.assertEqual(
                    set(receipt),
                    {
                        "fixture",
                        "protocolVersion",
                        "pid",
                        "bind",
                        "port",
                        "endpoint",
                        "version",
                        "seedModels",
                        "runningModels",
                        "pullableModels",
                    },
                )
                serialized = json.dumps(receipt).lower()
                self.assertNotIn(str(Path.home()).lower(), serialized)
                self.assertNotIn(str(Path(temporary)).lower(), serialized)
                self.assertNotIn("\\", serialized)
                self.assertEqual(receipt["bind"], fixture.LOOPBACK_ADDRESS)
                self.assertEqual(
                    receipt["endpoint"],
                    f"http://{fixture.LOOPBACK_ADDRESS}:{receipt['port']}",
                )

                connection = HTTPConnection(
                    fixture.LOOPBACK_ADDRESS, receipt["port"], timeout=5
                )
                connection.request("GET", "/__fixture__/health")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())["status"], "ok")
                connection.close()
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                if process.stdout is not None:
                    process.stdout.close()
                if process.stderr is not None:
                    process.stderr.close()


if __name__ == "__main__":
    unittest.main()
