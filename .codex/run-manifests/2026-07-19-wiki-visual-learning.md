# Wiki visual-learning publication

- Mode: `publish`
- Milestone: add practical guidance diagrams and conceptual illustrations across every canonical wiki page
- Expected UI state: unchanged product UI; documentation-only visual acceptance
- Ordered background interactions: MCP preflight; reproducible build; inspect local SVG/PNG assets; validate Markdown references; publish repository and canonical GitHub Wiki
- Disposable fixture: unique owned temporary Git repository and isolated Electron user-data directory if a GUI smoke capture is required
- Screenshot target: existing tracked product screenshots remain unchanged; new assets live in `docs/assets/diagrams/` and `docs/assets/concepts/`
- Theme and dimensions: labeled diagrams use a light accessible 1536×512 canvas; conceptual art uses a dark Material-style 16:9 canvas
- Documentation allowlist: eight files under `docs/wiki/`, `README.md`, `HANDOFF.md`, this manifest, the diagram generator, and the new diagram/concept assets
- Tests: regenerate diagrams; XML-parse every SVG; decode and dimension-check every PNG; verify all wiki image targets; markdownlint changed Markdown; `git diff --check`; reproducible production build through the low-level MCP server
- Remote: `origin` (`codingmachineedge/desktop-material`)
- Expected branch: `main`
- Publication: push `origin/main` without force, mirror canonical wiki pages to `desktop-material.wiki.git`, then verify remote SHAs, CI/release/Pages state, and public raw image URLs

## Local result

- MCP preflight passed: `startup_status.ok=true`; the scheduled task runs `uv`
  from `%USERPROFILE%\Documents\GitHub\lowlevel-computer-use-mcp` on
  `127.0.0.1:8765`, whose source was
  `beed66ca6ed2503e6170ee1e1158247f1c2f0140`.
- The required production build ran through that MCP server and refreshed the
  renderer/static outputs. The client transport recursively remained alive
  after the build process ended; after verifying their exact command lines,
  only the three owned client wrapper PIDs were terminated.
- All eight SVG assets XML-parse, all seven PNG assets decode at 1672×941, and
  every new raw-main wiki reference resolves to a tracked asset. A headless Edge
  rasterization of the automation SVG was visually inspected at 1536×512 and
  showed crisp, unclipped labels and arrows.
- `node --check script/generate-wiki-diagrams.js`, deterministic regeneration,
  wiki asset-reference validation, and `git diff --check` pass. Repository-wide
  Markdown lint still reports the existing historical line-length, heading,
  and unlabeled-fence backlog, so it is recorded rather than misreported as a
  clean gate.
