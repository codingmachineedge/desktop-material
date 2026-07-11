# Agent API

Desktop Material ships a built-in **agent control surface** so an AI agent can drive the app
programmatically. It is exposed as an **MCP server** with a **local HTTP + CLI fallback** for
environments where an MCP transport isn't convenient.

> **Status: on the roadmap / in active development.** The surface below describes the intended
> capability set. Treat names and shapes as provisional until the feature lands.

## What it exposes

The agent surface maps onto the same operations the UI uses, routed through the Dispatcher and
`AppStore` (see the [Developer Guide](Developer-Guide)) so agent-initiated actions obey the same
state flow and safety checks as human ones:

- **List repositories** — enumerate the repositories available to the active account.
- **List accounts** — enumerate signed-in identities (metadata only; **no tokens**).
- **Clone** — clone a repository by URL.
- **Commit** — stage and commit changes in a repository.
- **Push** — push the current branch to its remote.
- **Pull** — pull the current branch from its upstream.
- **Branches** — list, create, and switch branches.
- **Trigger workflow** — dispatch a GitHub Actions workflow (`workflow_dispatch`).

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
- **Never exposes account tokens.** GitHub / GitHub Enterprise / GitLab / Bitbucket credentials stay
  in your platform credential store. The agent API can *act* using them (clone, push, dispatch) but
  can never *read them back out* — account tokens are not part of any response payload.

## Transports

- **MCP server** — the primary transport, for MCP-aware agents and tools.
- **Local HTTP fallback** — the same operations over a loopback HTTP endpoint, token-gated,
  `127.0.0.1` only.
- **CLI fallback** — a local command-line entry point for scripts and one-off automation.

All three share the same token gate, the same loopback binding, and the same rule that account
tokens are never disclosed.

---

**See also:** [Developer Guide](Developer-Guide) · [Automation](Automation)
