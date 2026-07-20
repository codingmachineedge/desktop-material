# Ollama model manager

Desktop Material can manage an Ollama provider from **Settings → Copilot →
Providers** without exposing the native API as a free-form request editor. Add
the **Ollama (local)** provider preset, save it, and choose **Manage models** on
that provider to open the lifecycle workspace.

The provider's configured URL serves two related purposes. Copilot requests use
Ollama's OpenAI-compatible endpoint, while the manager derives its fixed native
routes from the same trusted origin. The saved provider URL must be an exact
loopback `/v1` base; remote hosts, arbitrary path prefixes, and a saved `/api`
base are rejected. The manager derives the loopback origin and appends only its
fixed native `/api/*` routes. The default preset is
`http://127.0.0.1:11434/v1`; no API key is required.

## Inventory and inspection

The manager reports endpoint health and version, then loads installed and
currently running models independently. A partial response keeps usable data
visible and identifies the unavailable scope instead of clearing the whole
workspace.

- Search the installed inventory or filter it to running models.
- Select a model to inspect its size, digest, modification time, format,
  family, parameter and quantization metadata, capabilities, bounded license
  text, and current runtime allocation when Ollama reports those fields.
- Refresh health, installed inventory, running state, and selected-model
  details without reopening Preferences.

Ollama may omit metadata or report it differently across model families. The
manager labels missing values rather than manufacturing them, bounds displayed
text, and treats installed and running inventories as separate sources of
truth.

## Model lifecycle

- **Pull** accepts an Ollama model name, streams bounded progress, and can be
  cancelled without blocking the rest of Preferences.
- **Copy** creates another local model name. **Rename** is a guarded copy then
  delete; if the copy succeeds but removal fails, both models remain visible
  and the manager reports the partial result.
- **Load** starts a model with Ollama's generate/keep-alive lifecycle, while
  **Unload** requests an immediate stop.
- **Delete** names the exact model and requires inline confirmation. The
  destructive request is never inferred from selection alone.

After a successful inventory-changing operation, the installed Ollama
inventory is synchronized back to that provider's selectable Copilot model
list. The refreshed inventory is authoritative: stale configured entries are
removed, new installed names are added, and existing per-model reasoning
settings are retained where identifiers still match. If Ollama succeeds but
provider persistence fails, the manager reports that split outcome instead of
claiming a complete operation.

## Endpoint, privacy, and recovery boundaries

Only HTTP or HTTPS loopback URLs such as `localhost`, `127.0.0.1`, and `[::1]`
are accepted. The saved path must be exactly `/v1`; every remote host,
arbitrary prefix, embedded credential, query string, fragment, or saved `/api`
base is rejected. The manager derives only that loopback origin and appends
fixed native `/api/*` routes, and operation errors are bounded before display.
Provider tokens are not required for Ollama and are never added to management
URLs, process arguments, logs, or repository files.

Loading, empty, unavailable, partial, cancellation, validation, and operation
failure states remain distinct. Refreshing or changing providers aborts stale
requests, pull cancellation owns only the active pull, and one model operation
cannot silently target another model.

All visible labels, status announcements, validation messages, confirmations,
and accessible names follow the app's **English**, playful **Hong Kong
Cantonese**, or **English / 香港粵語** language mode. The workspace is keyboard
reachable, announces changing progress and results, and reflows at compact
window sizes.

## Ollama API references

The manager uses Ollama's documented native API contracts for
[installed models](https://docs.ollama.com/api/tags),
[running models](https://docs.ollama.com/api/ps),
[model details](https://docs.ollama.com/api-reference/show-model-details),
[pull](https://docs.ollama.com/api/pull),
[copy](https://docs.ollama.com/api/copy),
[delete](https://docs.ollama.com/api/delete), and
[version](https://docs.ollama.com/api-reference/get-version). Pull progress uses
Ollama's [streaming NDJSON](https://docs.ollama.com/api/streaming) response
format. Loading and unloading use the documented
[generate](https://docs.ollama.com/api/generate) keep-alive behavior; model
creation and registry publishing are outside this manager's scope.

## Verification

Acceptance covers endpoint validation and normalization, bounded response
parsing, health/version and partial inventory behavior, streamed pull progress
and cancellation, copy/rename partial results, load/unload, confirmed deletion,
provider-model synchronization, stale-request suppression, language modes,
keyboard/accessibility semantics, responsive styling, and a deterministic
loopback Ollama fixture.

Exact source `27ffc1af7dd1223809c69ea0f72ddab369869f31` completed the
required low-level-MCP production build in 213.16 seconds. The deterministic
lifecycle exercise covered health, inventory, search, running state, pull
cancellation with rollback, completed pull, copy, rename, load, unload,
confirmed delete, and provider synchronization. Its accepted synthetic-only
capture is 1452×1001, 128,903 bytes, and SHA-256
`f1735c664248cd1b10a64e672dbbab24c95dabab99a62deeaf93557145a36509`.
The manager, Preferences shell, and controls remain contained above the footer
with zero overlaps and no horizontal overflow; privacy inspection passed and
owned runtime cleanup completed. Final exact-`main` Windows CI, Pages, and wiki
publication checks are intentionally recorded later in `HANDOFF.md`.
