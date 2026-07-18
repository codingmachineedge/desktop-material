# Direct public release creation verification manifest

- Mode: `publish`
- Milestone: replace draft-only release creation with reviewed direct public
  creation while retaining an explicit draft opt-out.
- Expected UI: **New release** opens with **Publish immediately** enabled; the
  review states **Publish immediately** and the primary action says **Publish
  release**. Turning the option off changes review/action to the draft path.
- Interactions: exercise the deterministic Release Manager component fixture;
  do not mutate a public repository or create a real release during proof.
- Fixture: existing synthetic `material-proof/guided-proof` release models and
  locally mocked provider API.
- Screenshot target: existing
  `docs/assets/screenshots/material-github-releases.png`; promote a replacement
  only after a complete provider-bound hidden-desktop fixture is available and
  visually accepted.
- Documentation allowlist: this manifest, `README.md`,
  `docs/wiki/User-Guide.md`, and `HANDOFF.md`.
- Tests: release API/store/view suites, repository lint, `git diff --check`,
  exact MCP production build, clean/pushed `main`, exact-SHA workflows.
- Remote/branch: `origin`, `main`.
- Initial baseline: clean `main` at
  `efd2969e50eec601e4c68c98e0bf332e617b4858`; preserve all unrelated state.
