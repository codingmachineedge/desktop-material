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
import select
import socket
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
DEFAULT_PULL_FRAME_DELAY_MS = 300
MAX_PULL_FRAME_DELAY_MS = 2_000
PULL_PROGRESS_INTERVALS = 10
OWNED_DIRECTORY_NAME = "ollama"
READY_FILE_NAME = "ready.json"
MUTATION_LOG_FILE_NAME = "mutations.jsonl"
RUN_ROOT_PATTERN = re.compile(
    r"desktop-material-ollama-[a-z0-9][a-z0-9._-]{5,120}\Z", re.IGNORECASE
)
FAULT_MODES = (
    "none",
    "unavailable",
    "partial",
    "malformed",
    "error",
    "stream-failure",
)
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
class OwnedFixturePaths:
    run_root: Path
    owned_directory: Path
    ready_file: Path
    mutation_log: Path
    run_id: str


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
            self._events.append(event)
            if self._stream is not None:
                self._stream.write(
                    json.dumps(event, separators=(",", ":"), sort_keys=True) + "\n"
                )
                self._stream.flush()
            return dict(event)

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(event) for event in self._events]

    def close(self) -> None:
        with self._lock:
            if self._stream is not None:
                self._stream.close()
                self._stream = None


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


def _same_path(left: Path, right: Path) -> bool:
    """Compare filesystem paths after expanding Windows 8.3 aliases."""

    return os.path.normcase(str(left.resolve(strict=False))) == os.path.normcase(
        str(right.resolve(strict=False))
    )


def _path_has_link_or_junction(path: Path) -> bool:
    """Reject link traversal without mistaking a DOS short-name alias for one."""

    absolute = Path(os.path.abspath(path))
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        if current.is_symlink() or (
            hasattr(current, "is_junction") and current.is_junction()
        ):
            return True
        if not current.exists():
            break
    return False


def resolve_owned_paths(
    run_root: Path, ready_file: Path, mutation_log: Path
) -> OwnedFixturePaths:
    """Resolve exact owned paths while rejecting symlink/junction escapes."""

    temp_value = os.environ.get("TEMP")
    if not temp_value:
        raise ValueError("TEMP must identify the owned fixture parent directory")
    temp_requested = Path(os.path.abspath(temp_value))
    temp_root = temp_requested.resolve(strict=True)
    if (
        not temp_root.is_dir()
        or _path_has_link_or_junction(temp_requested)
        or not _same_path(temp_requested, temp_root)
    ):
        raise ValueError("TEMP must be a real directory, not a symlink or junction")

    requested_root = Path(os.path.abspath(run_root))
    resolved_root = requested_root.resolve(strict=True)
    if (
        not resolved_root.is_dir()
        or _path_has_link_or_junction(requested_root)
        or not _same_path(requested_root, resolved_root)
        or resolved_root.parent != temp_root
        or RUN_ROOT_PATTERN.fullmatch(resolved_root.name) is None
    ):
        raise ValueError(
            "run root must be a real, directly owned TEMP child named "
            "desktop-material-ollama-*"
        )

    owned_directory = resolved_root / OWNED_DIRECTORY_NAME
    if owned_directory.exists():
        resolved_owned_directory = owned_directory.resolve(strict=True)
        if (
            not resolved_owned_directory.is_dir()
            or _path_has_link_or_junction(owned_directory)
            or not _same_path(owned_directory, resolved_owned_directory)
        ):
            raise ValueError("the owned Ollama directory may not be a link")
    else:
        owned_directory.mkdir(mode=0o700)
        resolved_owned_directory = owned_directory.resolve(strict=True)
    if resolved_owned_directory.parent != resolved_root:
        raise ValueError("the owned Ollama directory escaped the run root")

    expected_ready = resolved_owned_directory / READY_FILE_NAME
    expected_mutation_log = resolved_owned_directory / MUTATION_LOG_FILE_NAME
    requested_ready = Path(os.path.abspath(ready_file))
    requested_mutation_log = Path(os.path.abspath(mutation_log))
    if not _same_path(requested_ready, expected_ready):
        raise ValueError("ready file must be the exact owned Ollama ready path")
    if not _same_path(requested_mutation_log, expected_mutation_log):
        raise ValueError("mutation log must be the exact owned Ollama audit path")
    for candidate, label in (
        (expected_ready, "ready file"),
        (expected_mutation_log, "mutation log"),
    ):
        if candidate.exists():
            raise FileExistsError(f"{label} already exists: {candidate.name}")
        if not _same_path(candidate.parent.resolve(strict=True), resolved_owned_directory):
            raise ValueError(f"{label} parent escaped the owned Ollama directory")

    return OwnedFixturePaths(
        run_root=resolved_root,
        owned_directory=resolved_owned_directory,
        ready_file=expected_ready,
        mutation_log=expected_mutation_log,
        run_id=resolved_root.name.removeprefix("desktop-material-ollama-"),
    )


def _parameter_count(parameter_size: str) -> int:
    suffix = parameter_size[-1]
    multiplier = {"B": 1_000_000_000, "M": 1_000_000}[suffix]
    return int(float(parameter_size[:-1]) * multiplier)


def _digest(name: str) -> str:
    value = hashlib.sha256(
        f"{FIXTURE_ID}:model:{name}".encode("utf-8")
    ).hexdigest()
    return f"sha256:{value}"


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


def malformed_json_response() -> FixtureResponse:
    body = b'{"models":[{"name":42}'
    return FixtureResponse(
        HTTPStatus.OK,
        {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": str(len(body)),
        },
        body,
    )


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

    def __init__(
        self,
        audit_log: FixtureAuditLog | None = None,
        *,
        fault_mode: str = "none",
    ) -> None:
        self._lock = threading.RLock()
        self.audit_log = audit_log or FixtureAuditLog()
        self._pullable = {model.name: model for model in PULLABLE_MODELS}
        self._fault_mode = self._validated_fault_mode(fault_mode)
        self.reset(record=False, reset_fault=False)

    @staticmethod
    def _validated_fault_mode(mode: str) -> str:
        if mode not in FAULT_MODES:
            raise FixtureAPIError(
                HTTPStatus.BAD_REQUEST,
                f"fault mode must be one of {', '.join(FAULT_MODES)}",
            )
        return mode

    def reset(self, *, record: bool = True, reset_fault: bool = True) -> None:
        with self._lock:
            self._installed = {model.name: model for model in SEED_MODELS}
            self._running = {name: FIXED_EXPIRY for name in INITIAL_RUNNING_MODELS}
            self._active_pulls: set[str] = set()
            if reset_fault:
                self._fault_mode = "none"
            if record:
                self.audit_log.record(
                    "mutation", operation="reset", faultMode=self._fault_mode
                )

    @property
    def fault_mode(self) -> str:
        with self._lock:
            return self._fault_mode

    def set_fault_mode(self, mode: str) -> dict[str, Any]:
        validated = self._validated_fault_mode(mode)
        with self._lock:
            previous = self._fault_mode
            self._fault_mode = validated
            self.audit_log.record(
                "mutation",
                operation="set-fault",
                previousFaultMode=previous,
                faultMode=validated,
            )
            return self.snapshot()

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
            completed = tuple(
                model.size * index // PULL_PROGRESS_INTERVALS
                for index in range(PULL_PROGRESS_INTERVALS + 1)
            )
            frames: list[Mapping[str, Any]] = [{"status": "pulling manifest"}]
            frames.extend(
                {
                    "status": f"pulling {model.digest.removeprefix('sha256:')[:12]}",
                    "digest": model.digest,
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
            plan = PullPlan(model=model, frames=tuple(frames))
            self.audit_log.record(
                "mutation", operation="pull-start", model=model.name
            )
            return plan

    def complete_pull(self, plan: PullPlan) -> None:
        with self._lock:
            if plan.model.name in self._active_pulls:
                self._installed[plan.model.name] = plan.model
                self._active_pulls.remove(plan.model.name)
                self.audit_log.record(
                    "mutation", operation="pull-complete", model=plan.model.name
                )

    def abandon_pull(self, plan: PullPlan, *, reason: str = "cancelled") -> None:
        with self._lock:
            if plan.model.name in self._active_pulls:
                self._active_pulls.remove(plan.model.name)
                self.audit_log.record(
                    "mutation",
                    operation=(
                        "pull-failed" if reason == "stream-failure" else "pull-cancelled"
                    ),
                    model=plan.model.name,
                    reason=reason,
                )

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
            self.audit_log.record(
                "mutation",
                operation="copy",
                source=source,
                destination=destination,
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
            self.audit_log.record("mutation", operation="delete", model=name)

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
            self.audit_log.record("mutation", operation=action, model=name)
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
                "faultMode": self._fault_mode,
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
        run_id: str = "unit-test",
        run_root_name: str = "desktop-material-ollama-unit-test",
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
        self.audit_log = self.state.audit_log
        self.pull_frame_delay_seconds = pull_frame_delay_ms / 1_000
        self.pull_frame_delay_ms = pull_frame_delay_ms
        self.run_id = run_id
        self.run_root_name = run_root_name
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
            "runId": self.run_id,
            "runRootName": self.run_root_name,
            "mutationLog": f"{OWNED_DIRECTORY_NAME}/{MUTATION_LOG_FILE_NAME}",
            "faultMode": self.state.fault_mode,
            "faultModes": list(FAULT_MODES),
            "pullFrameDelayMs": self.pull_frame_delay_ms,
            "pullFrameCount": PULL_PROGRESS_INTERVALS + 5,
            "minimumPullDurationMs": (
                (PULL_PROGRESS_INTERVALS + 4) * self.pull_frame_delay_ms
            ),
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
            response = FixtureResponse(
                body_error.status,
                {**body_error.headers, "Connection": "close"},
                body_error.body,
            )
            self._record_request("<invalid>", response.status, "rejected")
            self._send(response)
            return

        parsed = urlsplit(self.path)
        path = parsed.path
        if parsed.query or parsed.fragment:
            response = error_response(
                FixtureAPIError(HTTPStatus.NOT_FOUND, "not found")
            )
            self._record_request(path, response.status, "rejected")
            self._send(response)
            return

        if self.command == "OPTIONS":
            response = empty_response(HTTPStatus.NO_CONTENT)
            self._record_request(path, response.status, "preflight")
            self._send(response)
            return

        try:
            fault_response = self._fault_response(path)
            if fault_response is not None:
                response = fault_response
                outcome = f"fault-{self.server.state.fault_mode}"
            elif self.command == "GET" and path == "/api/version":
                response = json_response(self.server.state.version())
                outcome = "success"
            elif self.command == "GET" and path == "/api/tags":
                response = json_response(self.server.state.tags())
                outcome = "success"
            elif self.command == "GET" and path == "/api/ps":
                response = json_response(self.server.state.running_models())
                outcome = "success"
            elif self.command == "GET" and path == "/__fixture__/health":
                response = json_response(
                    {
                        "fixture": FIXTURE_ID,
                        "status": "ok",
                        "version": OLLAMA_VERSION,
                    }
                )
                outcome = "success"
            elif self.command == "GET" and path == "/__fixture__/state":
                response = json_response(self.server.state.snapshot())
                outcome = "success"
            elif self.command == "GET" and path == "/__fixture__/audit":
                response = json_response(
                    {"events": self.server.audit_log.snapshot()}
                )
                outcome = "success"
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
                outcome = "success"
            elif self.command == "POST" and path == "/__fixture__/fault":
                request = _request_object(body)
                mode = request.get("mode")
                if not isinstance(mode, str) or set(request) != {"mode"}:
                    raise FixtureAPIError(
                        HTTPStatus.BAD_REQUEST,
                        "fixture fault body must contain only a string mode",
                    )
                response = json_response(self.server.state.set_fault_mode(mode))
                outcome = "success"
            elif self.command == "POST" and path == "/api/show":
                response = json_response(
                    self.server.state.show_model(_request_object(body))
                )
                outcome = "success"
            elif self.command == "POST" and path == "/api/copy":
                self.server.state.copy_model(_request_object(body))
                response = empty_response()
                outcome = "success"
            elif self.command == "DELETE" and path == "/api/delete":
                self.server.state.delete_model(_request_object(body))
                response = empty_response()
                outcome = "success"
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
                outcome = "success"
            elif self.command == "POST" and path == "/api/pull":
                self._serve_pull(
                    _request_object(body),
                    stream_failure=self.server.state.fault_mode == "stream-failure",
                )
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
                "/__fixture__/audit",
                "/__fixture__/reset",
                "/__fixture__/fault",
            }:
                response = error_response(
                    FixtureAPIError(HTTPStatus.METHOD_NOT_ALLOWED, "method not allowed")
                )
                outcome = "rejected"
            else:
                response = error_response(
                    FixtureAPIError(HTTPStatus.NOT_FOUND, "not found")
                )
                outcome = "rejected"
        except FixtureAPIError as error:
            response = error_response(error)
            outcome = "rejected"
        self._record_request(path, response.status, outcome)
        self._send(response, include_body=self.command != "HEAD")

    def _fault_response(self, path: str) -> FixtureResponse | None:
        mode = self.server.state.fault_mode
        if not path.startswith("/api/") or mode == "none":
            return None
        if mode == "unavailable":
            return error_response(
                FixtureAPIError(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    "synthetic Ollama service unavailable",
                )
            )
        if mode == "partial" and path == "/api/ps":
            return error_response(
                FixtureAPIError(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    "synthetic running-model inventory unavailable",
                )
            )
        if mode == "malformed" and path == "/api/tags":
            return malformed_json_response()
        if mode == "error" and path in {
            "/api/pull",
            "/api/copy",
            "/api/delete",
            "/api/generate",
        }:
            return error_response(
                FixtureAPIError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "synthetic Ollama operation failure",
                )
            )
        return None

    def _serve_pull(
        self, request: Mapping[str, Any], *, stream_failure: bool = False
    ) -> None:
        try:
            stream = _stream_setting(request)
            plan = self.server.state.begin_pull(request)
        except FixtureAPIError as error:
            response = error_response(error)
            self._record_request("/api/pull", response.status, "rejected")
            self._send(response)
            return

        if not stream:
            if stream_failure:
                self.server.state.abandon_pull(plan, reason="stream-failure")
                response = error_response(
                    FixtureAPIError(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        "synthetic Ollama pull failure",
                    )
                )
                self._record_request(
                    "/api/pull", response.status, "fault-stream-failure"
                )
                self._send(response)
                return
            self.server.state.complete_pull(plan)
            response = json_response({"status": "success"})
            self._record_request("/api/pull", response.status, "success")
            self._send(response)
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Connection", "close")
        self._send_common_headers()
        self.end_headers()
        self.close_connection = True
        finished = False
        outcome = "cancelled"
        try:
            frames: tuple[Mapping[str, Any], ...]
            if stream_failure:
                frames = (
                    *plan.frames[:3],
                    {"error": "synthetic Ollama streamed pull failure"},
                )
            else:
                frames = plan.frames
            for frame in frames:
                encoded = json.dumps(
                    frame, separators=(",", ":"), sort_keys=True
                ).encode("utf-8") + b"\n"
                chunk = f"{len(encoded):X}\r\n".encode("ascii") + encoded + b"\r\n"
                self.wfile.write(chunk)
                self.wfile.flush()
                if (
                    frame.get("status") != "success"
                    and self.server.pull_frame_delay_seconds
                ):
                    time.sleep(self.server.pull_frame_delay_seconds)
                if self._client_disconnected():
                    raise ConnectionResetError("pull client disconnected")
            if stream_failure:
                self.server.state.abandon_pull(plan, reason="stream-failure")
                outcome = "fault-stream-failure"
            else:
                self.server.state.complete_pull(plan)
                outcome = "success"
            finished = True
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return
        finally:
            if not finished:
                self.server.state.abandon_pull(plan, reason="client-disconnected")
            self._record_request(
                "/api/pull",
                HTTPStatus.OK if finished else 499,
                outcome,
            )

    def _client_disconnected(self) -> bool:
        """Observe a peer FIN/RST even when tiny loopback writes stay buffered."""

        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            if not readable:
                return False
            return self.connection.recv(1, socket.MSG_PEEK) == b""
        except (ConnectionResetError, OSError):
            return True

    def _record_request(self, path: str, status: int, outcome: str) -> None:
        self.server.audit_log.record(
            "request",
            method=self.command,
            path=path[:256],
            status=int(status),
            outcome=outcome,
        )

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
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--ready-file", type=Path, required=True)
    parser.add_argument("--mutation-log", type=Path, required=True)
    parser.add_argument("--fault-mode", choices=FAULT_MODES, default="none")
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

    path = path.resolve(strict=False)
    if path.exists():
        raise FileExistsError(f"ready file already exists: {path.name}")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
        if hasattr(os, "O_BINARY"):
            flags |= os.O_BINARY
        descriptor = os.open(temporary, flags, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
            stream.flush()
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    validate_args(args)
    try:
        paths = resolve_owned_paths(
            args.run_root, args.ready_file, args.mutation_log
        )
    except (FileNotFoundError, FileExistsError, OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    audit_log = FixtureAuditLog(paths.mutation_log)
    state = OllamaFixtureState(audit_log, fault_mode=args.fault_mode)
    audit_log.record(
        "lifecycle",
        operation="start",
        runId=paths.run_id,
        runRootName=paths.run_root.name,
        faultMode=args.fault_mode,
    )
    server = OllamaFixtureHTTPServer(
        (args.bind, args.port),
        state,
        pull_frame_delay_ms=args.pull_frame_delay_ms,
        run_id=paths.run_id,
        run_root_name=paths.run_root.name,
    )
    metadata = server.startup_metadata()
    try:
        write_startup_metadata(paths.ready_file, metadata)
        print(json.dumps(metadata, separators=(",", ":"), sort_keys=True), flush=True)
        server.serve_forever(poll_interval=0.05)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        audit_log.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
