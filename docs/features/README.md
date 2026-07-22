# Desktop Material feature documentation

Feature documents are grouped by the part of the product that owns the
behavior. Each document covers the user workflow, persistence boundary,
failure modes, security considerations, and the checks expected before the
feature is described as accepted.

The [30-item GitHub Desktop demand backlog
ledger](github-desktop-demand-backlog.md) maps the supplied research brief to
the implemented feature contracts.

## Categories

- [Agent API](agent-api/README.md) — opt-in REST and MCP automation,
  authentication, transport boundaries, and executable Postman requests.
- [Repository management](repository-management/README.md) — opening,
  organizing, and safely navigating repositories and nested repositories.
- [Integrations](integrations/README.md) — user-level Git, editor, shell, and
  operating-system connections.
- [Identity and workspace](identity-and-workspace/README.md) — multiple
  accounts plus fast repository and branch navigation at workspace scale.
- [Collaboration](collaboration/README.md) — pull-request review, creation,
  activity, and other provider-backed teamwork.
- [Review and diff](review-and-diff/README.md) — changed-file navigation and
  safe text, structured-data, and image inspection.
- [Quality and reliability](quality-and-reliability/README.md) — cross-cutting
  responsiveness, lifecycle cleanup, failure recovery, and regression gates.
- [Design system](design-system/README.md) — Material presentation controls,
  including command-palette row appearance and responsive visual behavior.
