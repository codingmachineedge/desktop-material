# Agent API

Desktop Material ships a built-in **agent control surface** so an AI agent can drive the app
programmatically. It is exposed as an **MCP server** with a **local HTTP + CLI fallback** for
environments where an MCP transport isn't convenient.

> **Status: shipped.** The versioned command contract below is implemented on `main` and shared by
> MCP, REST, the stdio proxy, and the command-line client.

## Enable and connect

1. Open **Settings → Agent access**.
2. Turn on **Enable local agent server**. The status changes to **Listening** and the panel displays
   the random loopback address and bearer token.
3. Connect an HTTP-capable MCP client to the displayed `/mcp` URL and send
   `Authorization: Bearer <token>`.
4. For a stdio-only client, run `node script/agent/mcp-stdio-proxy.js` from the checkout. For direct
   scripting, start with `node script/agent/desktop-agent.js info` or list tools with
   `node script/agent/desktop-agent.js tools`.

The proxy and CLI read the restricted local connection file written by the running app. Use
**Regenerate token** in Settings to invalidate existing clients immediately.

![Agent access connection and token controls](https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/material-agent-access.png)

## What it exposes

The agent surface maps onto the same operations the UI uses, routed through the Dispatcher and
`AppStore` (see the [Developer Guide](Developer-Guide)) so agent-initiated actions obey the same
state flow and safety checks as human ones:

- **Discovery and selection** — `list-accounts`, `list-repositories`, `list-tabs`, `get-status`,
  `open-repository`, `select-repository`, `select-tab`, and `close-tab`.
- **Clone** — `clone` one URL into an explicit path, or `clone-batch` up to 50 repositories in
  parallel or sequential mode.
- **Git** — `commit`, `fetch`, `pull`, `push`, `list-branches`, `create-branch`, and `merge-branch`.
  Commands accept a repository ID or path so an agent does not have to depend on UI selection.
- **Automation** — `get-automation-status` reads effective settings and operation phases;
  `run-automation` starts commit-and-push, merge-branches, or merge-worktrees through the same
  safety guards as the UI.
- **GitHub Actions** — `trigger-workflow` dispatches a workflow with a numeric workflow ID, ref, and
  optional declared inputs.

Where the app already gates an action (for example the [Automation](Automation) preconditions), the
agent path is subject to the **same gates** — it cannot force an operation the UI would refuse.

## Security model

The agent server is designed to be safe-by-default:

- **Binds `127.0.0.1` only.** It listens on loopback and is not reachable from the network. There is
  no remote-binding option.
- **Token-gated.** Every request must present a local access token. Requests without a valid token
  are rejected.
- **Opt-in.** The server is **off unless you enable it**. Installing Desktop Material does not open
  any port.
- **Browser-resistant.** Requests with a browser `Origin` header or an invalid `Host` are rejected,
  bodies are capped at 64 KiB, and active/queued commands are bounded.
- **Never exposes account tokens.** GitHub / GitHub Enterprise / GitLab / Bitbucket credentials stay
  in your platform credential store. The agent API can *act* using them (clone, push, dispatch) but
  can never *read them back out* — account tokens are not part of any response payload.
- **Redacts output.** Credential-shaped keys and bearer-like values are removed before responses
  leave the app; credential-shaped command arguments are rejected before execution.

## Transports

- **MCP over HTTP** — JSON-RPC at `/mcp`, including `tools/list` and `tools/call`.
- **REST compatibility API** — `GET /api/v1/info` and
  `POST /api/v1/command/<command-name>` on the same token-gated loopback server.
- **Stdio proxy** — `script/agent/mcp-stdio-proxy.js` translates newline-delimited MCP JSON-RPC to
  the local HTTP endpoint and reloads the connection file for token rotation.
- **CLI fallback** — `script/agent/desktop-agent.js` provides `info`, `tools`, and direct command
  calls with JSON arguments for scripts and one-off automation.

All transports share the same token gate, the same loopback binding, and the same rule that account
tokens are never disclosed.

---

**See also:** [Developer Guide](Developer-Guide) · [Automation](Automation)
