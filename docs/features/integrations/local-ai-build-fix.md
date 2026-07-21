# Local AI build repair with Codex or OpenCode

Desktop Material can hand a failed Build & Run stage, or a free-form repository
request, to either the Codex CLI or OpenCode. The provider choice is stored with
that repository and remains editable in both launch dialogs. Merely showing the
offer never starts an agent, installs software, or changes a file.

## User workflow

1. Run a detected Build & Run profile.
2. After a failure, choose **Fix with Codex/OpenCode**, or choose **Send to
   Codex/OpenCode** for a free-form task.
3. Select the provider. Desktop Material persists this provider for this
   repository only.
4. If the CLI is missing, review the exact npm command and explicitly approve
   installation. If authentication is missing, use a terminal to run `codex
   login` or `opencode auth login`, then re-check. The app never asks for an API
   key, password, access token, or pasted login output.
5. Review the repository, working directory, failed stage, and per-run
   auto-approve control before launch.
6. Follow bounded output in the Build & Run panel. **Stop** cancels the complete
   owned process tree and prevents the verification rerun from starting.
7. Unless the operation was cancelled, Desktop Material runs the selected Build
   & Run profile again. Only that rerun can establish that the repair succeeded;
   an agent exit code is never accepted as proof.

The same provider selector is available under **Repository settings → Build &
Run**. Auto-approve is separately stored and defaults off. The legacy
`opencodeAutoApprove` preference remains readable while the provider-neutral
setting is rolled out.

## Codex CLI contract

The Codex integration was checked against the installed `codex-cli 0.144.0`
help on July 21, 2026. Detection uses shell-free child processes for:

```text
codex --version
codex login status
```

Repairs use the documented stdin form, with the repository supplied as the
child working directory instead of an argv value:

```text
codex --ask-for-approval <on-request|never> exec --sandbox workspace-write \
  --disable hooks --ephemeral --ignore-user-config --ignore-rules \
  --color never -
```

The approval option precedes `exec` because it is a root option in Codex CLI
0.144; placing it after `exec` is rejected. The final `-` reads the instruction
from stdin. The prompt, build log, user request, repository path, credentials,
and environment secrets are never placed in argv. `--ignore-user-config`
skips the user's base configuration while preserving saved authentication;
`--disable hooks` disables the Codex lifecycle-hook feature, and
`--ignore-rules` skips user and project execution-policy rules. Desktop
Material never uses `--dangerously-bypass-approvals-and-sandbox`.

Codex CLI 0.144 has no verified blanket switch for disabling every MCP server.
A trusted repository's `.codex/config.toml` can therefore still contribute MCP
servers; assigning an empty `mcp_servers` table does not clear those entries.
Treat project Codex configuration as part of the repository trust boundary. The
explicit workspace-write sandbox and approval policy still apply, but Desktop
Material does not claim MCP isolation.

The safe automatic install plan is:

```text
npm install --global @openai/codex
```

It is spawned with an argv array and no shell or downloaded install script.

## Context and output bounds

- Failed-build context includes the stage, exit code, selected working
  directory, and at most the last 4,000 characters of captured output.
- A free-form request is trimmed and capped at 8,000 characters.
- A selected nested profile directory is accepted only when it resolves inside
  the repository, capped at 1,024 characters, and included in stdin context.
  The repository root remains the actual child working directory and sandbox
  root; the selected directory never enters argv.
- Prompts go to stdin and close immediately after writing.
- Detection retains at most 8,000 trailing output characters.
- Each streamed stdout/stderr line is capped at 16,000 characters. Dialogs keep
  at most 400 lines and the Build & Run panel keeps its existing 5,000-line
  ring buffer.

These are content bounds, not success criteria. Unless the user cancels the
operation, the post-agent build rerun is mandatory even when the CLI exits zero.

## Consent, scoping, and cancellation

With auto-approve off, Codex uses `--ask-for-approval on-request`; a detached
run may stop when an action needs approval because Desktop Material does not
pretend to provide an interactive terminal approval surface. With it on, Codex
uses `--ask-for-approval never`, but still retains `workspace-write` rather than
danger-full-access. OpenCode keeps its existing repository permission block and
`--auto` mapping.

Both providers use `spawn(..., { shell: false, windowsHide: true })`. Windows
batch shims pass through the existing metacharacter allow-list. Every operation
belongs to the exact renderer `WebContents` that launched it: duplicate IDs are
rejected, another renderer cannot cancel it, and owner navigation or destruction
aborts and awaits the process tree. Panel cancellation also aborts the owning
renderer operation, so **Stop** cannot accidentally launch verification after
the agent exits. Window shutdown and app shutdown retain the application-owned
barrier. Submodule temporary viewers reject automated code execution.

## Failure and recovery

- **CLI missing:** review and approve the displayed npm command, or install it
  independently and choose **Re-check**.
- **Not authenticated:** run the displayed login command in a terminal. Do not
  paste a credential into Desktop Material.
- **Approval required:** leave auto-approve off for safety and review the log;
  opt in only when the repository and requested work are trusted.
- **Spawn or batch-shim refusal:** no shell fallback occurs. Correct the PATH or
  unsafe path condition and retry.
- **Agent exits non-zero or claims success incorrectly:** the Build & Run rerun
  still executes and reports the real repository state.
- **Cancellation:** the verification rerun is suppressed, but partial repository
  changes can remain. Review Changes before retrying or discarding anything.

## Verification

Focused coverage includes pure argv/prompt/install planning, shell-free
detection, stdin discipline, bounded streaming, pre-spawn cancellation,
renderer ownership/navigation/destruction, foreign cancellation rejection,
provider selection in both dialogs, per-repository settings persistence and
identity, panel labels/state, and the typed IPC channel inventory. The root
TypeScript no-emit check also covers the cross-process request and response
types. Exact command and test receipts are recorded in `HANDOFF.md`.
