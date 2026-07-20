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
