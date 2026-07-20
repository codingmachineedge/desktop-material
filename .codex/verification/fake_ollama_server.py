#!/usr/bin/env python3
"""Deterministic loopback-only Ollama API fixture for Desktop Material.

The fixture implements only the model-management operations used by the
headless acceptance flow. It has no third-party dependencies, never contacts an
upstream service, and keeps all model data in memory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import time
from dataclasses import dataclass, replace
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit


LOOPBACK_ADDRESS = "127.0.0.1"
FIXTURE_ID = "desktop-material-ollama"
FIXTURE_PROTOCOL_VERSION = 1
OLLAMA_VERSION = "0.12.6"
FIXED_TIME = "2026-07-20T14:30:00Z"
FIXED_EXPIRY = "2099-01-01T00:05:00Z"
MAX_REQUEST_BODY_BYTES = 64 * 1024
DEFAULT_PULL_FRAME_DELAY_MS = 75
MAX_PULL_FRAME_DELAY_MS = 1_000
MODEL_NAME_PATTERN = re.compile(
    r"[a-z0-9][a-z0-9._/-]*(?::[a-z0-9][a-z0-9._-]*)?\Z"
)
KEEP_ALIVE_PATTERN = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:ns|us|ms|s|m|h)?\Z")


class FixtureAPIError(Exception):
    """A deliberate Ollama-shaped API failure."""

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
class ModelDefinition:
    name: str
    family: str
    parameter_size: str
    quantization_level: str
    capabilities: tuple[str, ...]
    size: int
    size_vram: int
    context_length: int
    digest: str
    modified_at: str = FIXED_TIME

    @property
    def details(self) -> dict[str, Any]:
        return {
            "parent_model": "",
            "format": "gguf",
            "family": self.family,
            "families": [self.family],
            "parameter_size": self.parameter_size,
            "quantization_level": self.quantization_level,
        }

    def tags_payload(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "model": self.name,
            "modified_at": self.modified_at,
            "size": self.size,
            "digest": self.digest,
            "details": self.details,
        }

    def running_payload(self, expires_at: str) -> dict[str, Any]:
        return {
            **self.tags_payload(),
            "expires_at": expires_at,
            "size_vram": self.size_vram,
            "context_length": self.context_length,
        }

    def show_payload(self) -> dict[str, Any]:
        architecture = self.family.replace("-", "_")
        return {
            "modelfile": f"FROM {self.name}\n",
            "parameters": f"temperature 0.2\nnum_ctx {self.context_length}",
            "template": "{{ .Prompt }}",
            "system": "Synthetic Desktop Material verification model.",
            "license": "Synthetic fixture data; no model weights are distributed.",
            "modified_at": self.modified_at,
            "details": self.details,
            "model_info": {
                "general.architecture": architecture,
                "general.parameter_count": _parameter_count(self.parameter_size),
                f"{architecture}.context_length": self.context_length,
            },
            "capabilities": list(self.capabilities),
        }


@dataclass(frozen=True)
class PullPlan:
    model: ModelDefinition
    frames: tuple[Mapping[str, Any], ...]


def _parameter_count(parameter_size: str) -> int:
    suffix = parameter_size[-1]
    multiplier = {"B": 1_000_000_000, "M": 1_000_000}[suffix]
    return int(float(parameter_size[:-1]) * multiplier)


def _digest(name: str) -> str:
    return hashlib.sha256(
        f"{FIXTURE_ID}:model:{name}".encode("utf-8")
    ).hexdigest()


def _model(
    name: str,
    family: str,
    parameter_size: str,
    quantization_level: str,
    capabilities: tuple[str, ...],
    size: int,
    size_vram: int,
    context_length: int,
) -> ModelDefinition:
    return ModelDefinition(
        name=name,
        family=family,
        parameter_size=parameter_size,
        quantization_level=quantization_level,
        capabilities=capabilities,
        size=size,
        size_vram=size_vram,
        context_length=context_length,
        digest=_digest(name),
    )


SEED_MODELS = (
    _model(
        "material-chat:7b",
        "material",
        "7B",
        "Q4_K_M",
        ("completion", "tools"),
        4_112_345_678,
        3_456_789_012,
        8_192,
    ),
    _model(
        "material-embed:latest",
        "material-embed",
        "335M",
        "F16",
        ("embedding",),
        669_000_000,
        535_200_000,
        2_048,
    ),
    _model(
        "material-vision:3b",
        "material-vision",
        "3B",
        "Q8_0",
        ("completion", "vision"),
        3_221_234_567,
        2_899_111_110,
        16_384,
    ),
)

PULLABLE_MODELS = (
    _model(
        "material-code:1.5b",
        "material-code",
        "1.5B",
        "Q4_K_M",
        ("completion", "tools"),
        1_234_567_890,
        987_654_321,
        32_768,
    ),
)

INITIAL_RUNNING_MODELS = ("material-chat:7b",)


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


def empty_response(status: int = HTTPStatus.OK) -> FixtureResponse:
    return FixtureResponse(int(status), {"Content-Length": "0"}, b"")


def error_response(error: FixtureAPIError) -> FixtureResponse:
    return json_response({"error": error.message}, error.status)


def _request_object(body: bytes) -> dict[str, Any]:
    if not body:
        raise FixtureAPIError(
            HTTPStatus.BAD_REQUEST, "request body must be a JSON object"
        )
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FixtureAPIError(
            HTTPStatus.BAD_REQUEST, "invalid JSON request body"
        ) from error
    if not isinstance(value, dict):
        raise FixtureAPIError(
            HTTPStatus.BAD_REQUEST, "request body must be a JSON object"
        )
    return value


def _model_name(request: Mapping[str, Any], key: str = "model") -> str:
    value = request.get(key)
    if not isinstance(value, str) or not value.strip():
        raise FixtureAPIError(
            HTTPStatus.BAD_REQUEST, f"{key} must be a non-empty model name"
        )
    normalized = value.strip().lower()
    if len(normalized) > 160 or MODEL_NAME_PATTERN.fullmatch(normalized) is None:
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, f"{key} is not a valid model name")
    return normalized


def _stream_setting(request: Mapping[str, Any]) -> bool:
    value = request.get("stream", True)
    if not isinstance(value, bool):
        raise FixtureAPIError(HTTPStatus.BAD_REQUEST, "stream must be a boolean")
    return value


def _keep_alive_action(request: Mapping[str, Any]) -> str:
    value = request.get("keep_alive", "5m")
    if isinstance(value, bool):
        raise FixtureAPIError(
            HTTPStatus.BAD_REQUEST, "keep_alive must be a number or duration string"
        )
    if isinstance(value, (int, float)):
        return "unload" if value == 0 else "load"
    if isinstance(value, str) and KEEP_ALIVE_PATTERN.fullmatch(value.strip()):
        numeric = re.match(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", value.strip())
        assert numeric is not None
        return "unload" if float(numeric.group(0)) == 0 else "load"
    raise FixtureAPIError(
        HTTPStatus.BAD_REQUEST, "keep_alive must be a number or duration string"
    )


class OllamaFixtureState:
    """Thread-safe in-memory model inventory and running-model state."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._pullable = {model.name: model for model in PULLABLE_MODELS}
        self.reset()

    def reset(self) -> None:
        with self._lock:
            self._installed = {model.name: model for model in SEED_MODELS}
            self._running = {name: FIXED_EXPIRY for name in INITIAL_RUNNING_MODELS}
            self._active_pulls: set[str] = set()

    @staticmethod
    def _resolve(name: str, values: Mapping[str, Any]) -> str | None:
        if name in values:
            return name
        if ":" not in name and f"{name}:latest" in values:
            return f"{name}:latest"
        return None

    def version(self) -> dict[str, str]:
        return {"version": OLLAMA_VERSION}

    def tags(self) -> dict[str, list[dict[str, Any]]]:
        with self._lock:
            return {
                "models": [
                    self._installed[name].tags_payload()
                    for name in sorted(self._installed)
                ]
            }

    def running_models(self) -> dict[str, list[dict[str, Any]]]:
        with self._lock:
            return {
                "models": [
                    self._installed[name].running_payload(self._running[name])
                    for name in sorted(self._running)
                    if name in self._installed
                ]
            }

    def show_model(self, request: Mapping[str, Any]) -> dict[str, Any]:
        requested = _model_name(request)
        with self._lock:
            name = self._resolve(requested, self._installed)
            if name is None:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "model not found")
            return self._installed[name].show_payload()

    def begin_pull(self, request: Mapping[str, Any]) -> PullPlan:
        requested = _model_name(request)
        with self._lock:
            installed_name = self._resolve(requested, self._installed)
            if installed_name is not None:
                raise FixtureAPIError(
                    HTTPStatus.CONFLICT, "model is already installed"
                )
            name = self._resolve(requested, self._pullable)
            if name is None:
                raise FixtureAPIError(
                    HTTPStatus.NOT_FOUND,
                    "model is not available in the deterministic fixture",
                )
            if name in self._active_pulls:
                raise FixtureAPIError(
                    HTTPStatus.CONFLICT, "model pull is already in progress"
                )
            self._active_pulls.add(name)
            model = self._pullable[name]
            digest = f"sha256:{model.digest}"
            completed = (0, model.size // 4, model.size // 2, model.size * 3 // 4, model.size)
            frames: list[Mapping[str, Any]] = [{"status": "pulling manifest"}]
            frames.extend(
                {
                    "status": f"pulling {model.digest[:12]}",
                    "digest": digest,
                    "total": model.size,
                    "completed": value,
                }
                for value in completed
            )
            frames.extend(
                (
                    {"status": "verifying sha256 digest"},
                    {"status": "writing manifest"},
                    {"status": "success"},
                )
            )
            return PullPlan(model=model, frames=tuple(frames))

    def complete_pull(self, plan: PullPlan) -> None:
        with self._lock:
            if plan.model.name in self._active_pulls:
                self._installed[plan.model.name] = plan.model
                self._active_pulls.remove(plan.model.name)

    def abandon_pull(self, plan: PullPlan) -> None:
        with self._lock:
            self._active_pulls.discard(plan.model.name)

    def copy_model(self, request: Mapping[str, Any]) -> None:
        requested_source = _model_name(request, "source")
        destination = _model_name(request, "destination")
        with self._lock:
            source = self._resolve(requested_source, self._installed)
            if source is None:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "source model not found")
            if self._resolve(destination, self._installed) is not None:
                raise FixtureAPIError(
                    HTTPStatus.CONFLICT, "destination model already exists"
                )
            self._installed[destination] = replace(
                self._installed[source], name=destination, modified_at=FIXED_TIME
            )

    def delete_model(self, request: Mapping[str, Any]) -> None:
        requested = _model_name(request)
        with self._lock:
            name = self._resolve(requested, self._installed)
            if name is None:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "model not found")
            if name in self._running:
                raise FixtureAPIError(
                    HTTPStatus.CONFLICT, "model is currently running"
                )
            del self._installed[name]

    def generate(self, request: Mapping[str, Any]) -> dict[str, Any]:
        requested = _model_name(request)
        action = _keep_alive_action(request)
        with self._lock:
            name = self._resolve(requested, self._installed)
            if name is None:
                raise FixtureAPIError(HTTPStatus.NOT_FOUND, "model not found")
            if action == "unload":
                self._running.pop(name, None)
            else:
                self._running[name] = FIXED_EXPIRY
        return {
            "model": name,
            "created_at": FIXED_TIME,
            "response": "",
            "done": True,
            "done_reason": action,
            "total_duration": 1_000_000,
            "load_duration": 500_000 if action == "load" else 0,
            "prompt_eval_count": 0,
            "prompt_eval_duration": 0,
            "eval_count": 0,
            "eval_duration": 0,
        }

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "fixture": FIXTURE_ID,
                "installedModels": sorted(self._installed),
                "runningModels": sorted(self._running),
                "activePulls": sorted(self._active_pulls),
                "pullableModels": sorted(self._pullable),
            }


class OllamaFixtureHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        state: OllamaFixtureState | None = None,
        *,
        pull_frame_delay_ms: int = DEFAULT_PULL_FRAME_DELAY_MS,
    ) -> None:
        host, port = address
        if host != LOOPBACK_ADDRESS:
            raise ValueError("the Ollama fixture may bind only to 127.0.0.1")
        if not 0 <= port <= 65_535:
            raise ValueError("port must be between 0 and 65535")
        if not 0 <= pull_frame_delay_ms <= MAX_PULL_FRAME_DELAY_MS:
            raise ValueError(
                f"pull frame delay must be between 0 and {MAX_PULL_FRAME_DELAY_MS} ms"
            )
        self.state = state or OllamaFixtureState()
        self.pull_frame_delay_seconds = pull_frame_delay_ms / 1_000
        super().__init__(address, OllamaFixtureRequestHandler)

    def startup_metadata(self) -> dict[str, Any]:
        host, port = self.server_address[:2]
        return {
            "fixture": FIXTURE_ID,
            "protocolVersion": FIXTURE_PROTOCOL_VERSION,
            "pid": os.getpid(),
            "bind": host,
            "port": int(port),
            "endpoint": f"http://{host}:{port}",
            "version": OLLAMA_VERSION,
            "seedModels": sorted(model.name for model in SEED_MODELS),
            "runningModels": sorted(INITIAL_RUNNING_MODELS),
            "pullableModels": sorted(model.name for model in PULLABLE_MODELS),
        }


class OllamaFixtureRequestHandler(BaseHTTPRequestHandler):
    server: OllamaFixtureHTTPServer
    protocol_version = "HTTP/1.1"
    server_version = "DesktopMaterialOllamaFixture/1"
    sys_version = ""

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def date_time_string(self, _timestamp: float | None = None) -> str:
        return "Mon, 20 Jul 2026 14:30:00 GMT"

    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()

    def do_DELETE(self) -> None:  # noqa: N802
        self._handle()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._handle()

    def do_HEAD(self) -> None:  # noqa: N802
        self._handle()

    def do_PUT(self) -> None:  # noqa: N802
        self._handle()

    def do_PATCH(self) -> None:  # noqa: N802
        self._handle()

    def _read_body(self) -> tuple[bytes, FixtureResponse | None]:
        if self.headers.get("Transfer-Encoding") is not None:
            return b"", error_response(
                FixtureAPIError(
                    HTTPStatus.BAD_REQUEST,
                    "chunked request bodies are not supported",
                )
            )
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return b"", None
        if re.fullmatch(r"\d+", raw_length) is None:
            return b"", error_response(
                FixtureAPIError(HTTPStatus.BAD_REQUEST, "invalid Content-Length")
            )
        normalized = raw_length.lstrip("0") or "0"
        if len(normalized) > len(str(MAX_REQUEST_BODY_BYTES)):
            return b"", error_response(
                FixtureAPIError(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request body is too large"
                )
            )
        length = int(normalized)
        if length > MAX_REQUEST_BODY_BYTES:
            return b"", error_response(
                FixtureAPIError(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request body is too large"
                )
            )
        body = self.rfile.read(length)
        if len(body) != length:
            return b"", error_response(
                FixtureAPIError(HTTPStatus.BAD_REQUEST, "incomplete request body")
            )
        return body, None

    def _handle(self) -> None:
        body, body_error = self._read_body()
        if body_error is not None:
            self.close_connection = True
            self._send(
                FixtureResponse(
                    body_error.status,
                    {**body_error.headers, "Connection": "close"},
                    body_error.body,
                )
            )
            return

        parsed = urlsplit(self.path)
        path = parsed.path
        if parsed.query or parsed.fragment:
            self._send(error_response(FixtureAPIError(HTTPStatus.NOT_FOUND, "not found")))
            return

        if self.command == "OPTIONS":
            self._send(empty_response(HTTPStatus.NO_CONTENT))
            return

        try:
            if self.command == "GET" and path == "/api/version":
                response = json_response(self.server.state.version())
            elif self.command == "GET" and path == "/api/tags":
                response = json_response(self.server.state.tags())
            elif self.command == "GET" and path == "/api/ps":
                response = json_response(self.server.state.running_models())
            elif self.command == "GET" and path == "/__fixture__/health":
                response = json_response(
                    {
                        "fixture": FIXTURE_ID,
                        "status": "ok",
                        "version": OLLAMA_VERSION,
                    }
                )
            elif self.command == "GET" and path == "/__fixture__/state":
                response = json_response(self.server.state.snapshot())
            elif self.command == "POST" and path == "/__fixture__/reset":
                if body:
                    request = _request_object(body)
                    if request:
                        raise FixtureAPIError(
                            HTTPStatus.BAD_REQUEST,
                            "fixture reset body must be empty or an empty object",
                        )
                self.server.state.reset()
                response = json_response(self.server.state.snapshot())
            elif self.command == "POST" and path == "/api/show":
                response = json_response(
                    self.server.state.show_model(_request_object(body))
                )
            elif self.command == "POST" and path == "/api/copy":
                self.server.state.copy_model(_request_object(body))
                response = empty_response()
            elif self.command == "DELETE" and path == "/api/delete":
                self.server.state.delete_model(_request_object(body))
                response = empty_response()
            elif self.command == "POST" and path == "/api/generate":
                request = _request_object(body)
                stream = _stream_setting(request)
                result = self.server.state.generate(request)
                if stream:
                    response_body = json.dumps(
                        result, separators=(",", ":"), sort_keys=True
                    ).encode("utf-8") + b"\n"
                    response = FixtureResponse(
                        HTTPStatus.OK,
                        {
                            "Content-Type": "application/x-ndjson",
                            "Content-Length": str(len(response_body)),
                        },
                        response_body,
                    )
                else:
                    response = json_response(result)
            elif self.command == "POST" and path == "/api/pull":
                self._serve_pull(_request_object(body))
                return
            elif path in {
                "/api/version",
                "/api/tags",
                "/api/ps",
                "/api/show",
                "/api/pull",
                "/api/copy",
                "/api/delete",
                "/api/generate",
                "/__fixture__/health",
                "/__fixture__/state",
                "/__fixture__/reset",
            }:
                response = error_response(
                    FixtureAPIError(HTTPStatus.METHOD_NOT_ALLOWED, "method not allowed")
                )
            else:
                response = error_response(
                    FixtureAPIError(HTTPStatus.NOT_FOUND, "not found")
                )
        except FixtureAPIError as error:
            response = error_response(error)
        self._send(response, include_body=self.command != "HEAD")

    def _serve_pull(self, request: Mapping[str, Any]) -> None:
        try:
            stream = _stream_setting(request)
            plan = self.server.state.begin_pull(request)
        except FixtureAPIError as error:
            self._send(error_response(error))
            return

        if not stream:
            self.server.state.complete_pull(plan)
            self._send(json_response({"status": "success"}))
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Connection", "close")
        self._send_common_headers()
        self.end_headers()
        self.close_connection = True
        finished = False
        try:
            for frame in plan.frames:
                encoded = json.dumps(
                    frame, separators=(",", ":"), sort_keys=True
                ).encode("utf-8") + b"\n"
                chunk = f"{len(encoded):X}\r\n".encode("ascii") + encoded + b"\r\n"
                self.wfile.write(chunk)
                self.wfile.flush()
                if frame["status"] != "success" and self.server.pull_frame_delay_seconds:
                    time.sleep(self.server.pull_frame_delay_seconds)
            self.server.state.complete_pull(plan)
            finished = True
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return
        finally:
            if not finished:
                self.server.state.abandon_pull(plan)

    def _send(self, response: FixtureResponse, *, include_body: bool = True) -> None:
        self.send_response(int(response.status))
        for name, value in response.headers.items():
            self.send_header(name, value)
        self._send_common_headers()
        self.end_headers()
        if include_body and response.body:
            try:
                self.wfile.write(response.body)
            except (BrokenPipeError, ConnectionResetError, OSError):
                return

    def _send_common_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header(
            "Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST, DELETE"
        )
        self.send_header("Access-Control-Allow-Private-Network", "true")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the loopback-only Desktop Material Ollama fixture."
    )
    parser.add_argument("--bind", default=LOOPBACK_ADDRESS)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--ready-file", type=Path)
    parser.add_argument(
        "--pull-frame-delay-ms",
        type=int,
        default=DEFAULT_PULL_FRAME_DELAY_MS,
    )
    return parser.parse_args(argv)


def validate_args(args: argparse.Namespace) -> None:
    if args.bind != LOOPBACK_ADDRESS:
        raise SystemExit("The Ollama fixture may bind only to 127.0.0.1.")
    if not 0 <= args.port <= 65_535:
        raise SystemExit("The fixture port must be between 0 and 65535.")
    if not 0 <= args.pull_frame_delay_ms <= MAX_PULL_FRAME_DELAY_MS:
        raise SystemExit(
            "The pull frame delay must be between 0 and "
            f"{MAX_PULL_FRAME_DELAY_MS} milliseconds."
        )


def write_startup_metadata(path: Path, metadata: Mapping[str, Any]) -> None:
    """Atomically create a ready receipt whose payload contains no host paths."""

    path = path.resolve()
    if path.exists():
        raise FileExistsError(f"ready file already exists: {path.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    validate_args(args)
    server = OllamaFixtureHTTPServer(
        (args.bind, args.port),
        pull_frame_delay_ms=args.pull_frame_delay_ms,
    )
    metadata = server.startup_metadata()
    try:
        if args.ready_file is not None:
            write_startup_metadata(args.ready_file, metadata)
        print(json.dumps(metadata, separators=(",", ":"), sort_keys=True), flush=True)
        server.serve_forever(poll_interval=0.05)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
