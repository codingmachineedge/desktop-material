# Desktop Material design-reference inventory

Date: 2026-07-20

Scope: static audit of the supplied `Material Design UI Recreation (1).zip` extraction

Primary reference: `Desktop Material v2.dc.html`

Method: source inspection plus original-resolution inspection of every supplied raster; no application UI was launched

## How to use this inventory

This document is the traceable reference contract for the implementation audit. Requirement IDs are stable and should be cited by any finding or remediation. The dispositions mean:

| Disposition | Meaning for implementation audit |
| --- | --- |
| `MATCH` | Implementation-addressable visual or interaction requirement. Compare and remediate. |
| `STATE` | The visible state flow is implementation-addressable, but the prototype uses in-memory timers/data. Match the UX state, not the fake backend mechanism. |
| `AFFORDANCE` | The prototype draws an enabled-looking control but wires no behavior. Match its visual affordance only unless product requirements define the action elsewhere. |
| `AMBIGUOUS` | Sources contradict one another or the source does not establish one answer. Do not fail the implementation without resolving precedence. |
| `ABSENT` | The design package supplies no design for this topic. It is not evidence that the product should omit a separately required feature. |

Precedence for this audit is: current v2 source and logic, then current README/regex guide, then screenshots, then the older HTML and auxiliary images as historical evidence. A screenshot may establish a concrete pixel appearance, but it does not override a demonstrably newer v2 structure without an explicit decision.

## Source manifest and provenance

The extraction contains 14 files: 5 source/document files, 7 gallery screenshots, and 2 auxiliary rasters. SHA-256 values make this inventory auditable against the exact package.

The repository's formatted `design/Desktop Material v2.dc.html` is structurally
identical to the archive v2 source after both are normalized with the repository
Prettier configuration. Its only 28 paired content substitutions replace the
archive's person-like fixture names, initials, email, actor labels, and GitLab
host with public sample data. No layout, style, route, control, or state logic
differs. The archive remains the immutable audit input; the tracked copy is the
privacy-safe equivalent for published source and screenshot documentation.

| File | Bytes | SHA-256 | Role |
| --- | ---: | --- | --- |
| `Desktop Material v2.dc.html` | 324,133 | `c7000f1f2e7276f9f0bbdcd63225d432e445e257c49fae72591df3e455a0c9ae` | Authoritative current reactive prototype; template lines 9–1515 and logic lines 1521–3325. |
| `Desktop Material.dc.html` | 133,764 | `2b622e230fdc06c8e92c2b5e6fc4daf10fe8f3e815397c7c5d9467c9b2715e11` | Older baseline prototype. |
| `README.md` | 4,479 | `0eab8432b6235bcc2461531d19fc2313e7f7efd8d323b557d01251f4448c9b89` | Feature claims, token mapping, and six-image gallery. |
| `docs/regex-guide.md` | 4,382 | `93a20bc67e24adc945a31fe165a14f5a6371d8ee033872319b89b5815325cb95` | Search/regex behavior and educational copy. |
| `support.js` | 64,222 | `ae4f0ac8449655e17cca1e3b179effcb6817a3b0d8dc47f112a9c39c25c39fd7` | Generated design-canvas runtime (1,768 lines). |
| `screenshots/07-clone.png` | 31,708 | `9ba0b4030efc90cb3b0f05503bbe1acc93439846720d0e54bb8427705522f03a` | Historical repository-sheet clone treatment; 924×540. |
| `screenshots/regex-builder.png` | 25,594 | `9a1fa18c8c64e21d004b93e0cdda2c24e3c37e96410e2f67ee141299f7ac6140` | Regex builder, light; 924×540. |
| `screenshots/settings-accounts-dark.png` | 26,568 | `8dc197f225d15edda929d4dc75599015a0b156290de5c8e7bacc12d4729590cc` | Accounts settings, dark; 924×540. |
| `screenshots/settings-history-manager.png` | 30,924 | `b1cdc22f1f4b273da42d3c4ae2c2c3a698a4d558fbb7f55973d43460e0a74eed` | Settings-history side panel; 924×540. |
| `screenshots/tab-text-style.png` | 33,654 | `476d3de8deeae141a95df0b5c829147134ce08fe537c93fb5bc75f6f3a9d26a4` | Tab-format popover; 924×540. |
| `screenshots/workspace-changes-light.png` | 34,575 | `0ce1aa9e30d79f03438d8a38adb2aa9d09b4b80dcdcba4c5451ec32e2d4238c4` | Changes workspace, light; 924×540. |
| `screenshots/workspace-dark.png` | 36,051 | `01cfc8c587d01cf1defe7ded7a726a1de7834a20aa5b597e23ba6733e27fda79` | Changes workspace with filters open, dark; 924×540. |
| `uploads/draw-0e00eab9-8411-4bc0-a26d-baead00775aa.png` | 53,910 | `edaea99636dced1aae41e34877dc158b9c838ff89e4228a61485e8eef3724f73` | 1593×947 annotated historical repository-sheet capture; red circle calls out “Available to clone.” |
| `.thumbnail` | 44,550 | `a3958401e40a6d88310f344ac0b1223a96a40b0e9ac610c93bafd08e4722962d` | 390×640 Actions-view thumbnail. |

## Quantitative inventory

Counts below are source-template counts, not a claim that every conditional or loop instance is simultaneously rendered.

| Measure | v2 | Older HTML |
| --- | ---: | ---: |
| Named `data-screen-label` surfaces | 24 | 12 |
| `<button>` declarations | 134 | 48 |
| `<input>` declarations | 18 (15 text, 2 range, 1 password) | 8 text |
| `<textarea>` declarations | 2 | 1 |
| Native `<select>` / `<a>` declarations | 0 / 0 | 0 / 0 |
| `sc-for` repeated templates | 46 | 14 |
| `sc-if` conditional templates | 103 | 48 |
| `onClick` bindings | 125 | 35 |
| `onMouseDown` bindings | 129 | 47 |
| `onDoubleClick` / `onPointerDown` bindings | 1 / 4 | 0 / 1 |
| `role=button` / checkbox / switch / tab declarations | 10 / 4 / 5 / 1 | 5 / 2 / 1 / 0 |
| `title` attributes | 61 | 17 |

Default v2 fixture/model counts:

| Model | Count and initial state |
| --- | --- |
| Changed files | 8: 5 modified and 3 added; all included; first selected. |
| Commit history | 8 commits; two authors; one tag; no initial unpushed commits. |
| Branches | 8: 1 default, 3 recent, 4 other; `material-shell` current. |
| Accounts | 2 (`alexhart`, `alexhart-oss`). |
| Initial tabs | 2 for `alexhart`, 1 for `alexhart-oss`. |
| Local repositories | 4 for `alexhart`, 1 for `alexhart-oss`. |
| Clone candidates | 9 unique metadata records: 6 available to `alexhart` (4 personal + 2 org), 3 to `alexhart-oss`. |
| Settings-history snapshots | 3 for `alexhart`, 1 for `alexhart-oss`. |
| Notifications | 3, of which 2 unread; displayed repository-log counter starts at 4 commits. |
| Workflow runs | 5: 3 success, 1 failure, 1 running. |
| Installed workflows | 2, both enabled. |
| Workflow catalog templates | 8 across 5 categories. |
| Search contexts | 7 in source: Changes, History, Branches, Repositories, Clone, Actions, Catalog. |
| Context filter chips | 25 total: 5 + 3 + 1 + 1 + 5 + 5 + 5. |
| Regex builder | 6 categories, 35 insertion tokens, 6 flags, 9 guide sections. |
| Settings pages | 8: Accounts, Integrations, Git, Appearance, Notifications, Prompts, Advanced, Automation. |
| Motion keyframes | 16. |
| Unique top-level design custom properties | 42: 25 M3 colors, 3 elevations, 4 semantic colors, 6 diff colors, 4 motion/runtime properties. |

The README lists 17 feature bullets (4 core-workspace bullets and 13 feature-expansion bullets). Its gallery references 6 of the 7 files under `screenshots/`; `07-clone.png` is not in the gallery.

## Fixture-data ledger

This content is visible in lists, cards, diffs, logs, and screenshots and therefore matters for deterministic visual comparisons.

### Files and diff totals

| ID | Path | Status | Included initially | Diff totals |
| --- | --- | --- | --- | --- |
| `f1` | `app/styles/_material.scss` | Modified | Yes | +11/−0 |
| `f2` | `app/styles/_material-shell.scss` | Modified | Yes | +3/−1 |
| `f3` | `app/styles/_motion.scss` | Added | Yes | +17/−0 |
| `f4` | `app/src/ui/lib/ripple.tsx` | Added | Yes | +16/−0 |
| `f5` | `app/src/ui/toolbar/toolbar.tsx` | Modified | Yes | +1/−1 |
| `f6` | `app/src/ui/changes/changed-file.tsx` | Modified | Yes | +4/−4 |
| `f7` | `app/src/ui/history/commit-list-item.tsx` | Modified | Yes | +3/−3 |
| `f8` | `docs/material-motion.md` | Added | Yes | +10/−0 |

### Commit list

| Short SHA | Summary | Author/time | Special state |
| --- | --- | --- | --- |
| `4f2c9a1` | Map upstream semantic variables to M3 color roles | Alex Hartley · 2 hours ago | Selected; 2 files |
| `b81d3e7` | Restyle app shell surfaces and window controls | Alex Hartley · 5 hours ago | 2 files |
| `9c04f52` | Adopt pill treatment for repository tab bar | Nadia Rahim · yesterday | 1 file |
| `e37ab08` | Add Material elevation and state layer variables | Alex Hartley · yesterday | Tag `v0.1.0-material` |
| `71f60cd` | Align dialog chrome with Material dialogs | Nadia Rahim · 2 days ago | 2 files |
| `25e9b34` | Import Roboto and map shell type scale | Alex Hartley · 2 days ago | 1 file |
| `d10c876` | Merge pull request #18 from desktop-material/theme-modes | Alex Hartley · 3 days ago | 2 files |
| `3aa41f9` | Wire system theme detection into app shell | Nadia Rahim · 3 days ago | 1 file |

### Branch, repository, account, and tab fixtures

| Set | Values |
| --- | --- |
| Default branches | `development` |
| Recent branches | `material-shell` (current), `m3-motion-tokens`, `material-foundations` |
| Other branches | `repository-workspace`, `account-profiles`, `dialogs-and-flows`, `gh-pages` |
| `alexhart` local repos | `desktop-material`, `desktop-notifications`, `desktop-trampoline`, `windows-argv-parser` |
| `alexhart` personal clone candidates | `gemoji`, `dugite`, `printenvz`, `release-tooling` |
| `alexhart` org clone candidates | `desktop-material-site`, `desktop-material-wiki` |
| `alexhart-oss` local repos | `material-web-playground` |
| `alexhart-oss` clone candidates | `octicons-material`, `material-tokens`, `m3-catalog` |
| `alexhart` initial tabs | `material shell` → `desktop-material/material-shell`; `notifications` → `desktop-notifications/main` |
| `alexhart-oss` initial tab | `playground` → `material-web-playground/main` |

### Clone-card metadata

| Repository | Language | Visibility | Size | Stars/forks | Default / updated |
| --- | --- | --- | ---: | --- | --- |
| `gemoji` | Ruby | Public | 12.4 MB | 4.3k / 1.9k | main / last week |
| `dugite` | TypeScript | Public | 8.1 MB | 1.2k / 210 | main / 2 days ago |
| `printenvz` | Shell | Public | 0.2 MB | 14 / 3 | main / last month |
| `release-tooling` | TypeScript | Private | 2.6 MB | 8 / 1 | main / yesterday |
| `octicons-material` | TypeScript | Public | 3.4 MB | 96 / 12 | main / 3 days ago |
| `material-tokens` | TypeScript | Private | 0.9 MB | 41 / 6 | main / 5 days ago |
| `m3-catalog` | TypeScript | Public | 5.7 MB | 128 / 19 | gh-pages / today |
| `desktop-material-site` | TypeScript | Public | 4.2 MB | 23 / 4 | gh-pages / today |
| `desktop-material-wiki` | Markdown | Public | 1.1 MB | 9 / 2 | main / 2 days ago |

Every clone card also has a one-sentence description and a fixed language-dot color. Unknown metadata falls back to TypeScript/Public/main/recently with zero stars/forks and no size.

### Workflow and notification fixtures

| Run | Workflow | Title | Branch/event | Status/time |
| ---: | --- | --- | --- | --- |
| 128 | `ci.yml` | Map upstream semantic variables to M3 color roles | material-shell / push | success · 2 hours ago · 4m12s |
| 127 | `ci.yml` | Add motion token draft | m3-motion-tokens / push | failure · 5 hours ago · 3m41s |
| 126 | `pages.yml` | Publish project site | main / workflow_dispatch | running · 1m |
| 125 | `ci.yml` | Restyle app shell surfaces and window controls | material-shell / pull_request | success · yesterday · 4m55s |
| 124 | `ci.yml` | Wire system theme detection into app shell | theme-modes / push | success · 3 days ago · 3m58s |

Installed workflows are CI (`ci.yml`) and Deploy Pages (`pages.yml`). Catalog templates are Node.js CI, CodeQL analysis, Deploy static content to Pages, Publish Node.js package, Docker image, Close stale issues, Greetings, and Electron release.

Initial notifications are: unread “Pages deploy started,” unread “CI failed on m3-motion-tokens,” and read “Auto pull completed.” Initial settings history for `alexhart` is Initial settings snapshot → Set theme: light → Add tab “notifications”; `alexhart-oss` has only Initial settings snapshot.

## Named surface index

The 24 v2 named surfaces are: Title bar, Tab strip, Tab format popover, App bar, Navigation rail, Changes panel, Commit composer, History panel, Actions panel, Workflow manager, Main pane, Diff pane, Commit detail, Workflow run detail, Repository sheet, Branch sheet, Settings dialog, Notification centre, Workflow catalog, Run workflow popover, Clone repositories dialog, Account switcher, Undo history manager, and Regex builder.

The older HTML has only: Title bar, App bar, Navigation rail, Changes panel, Commit composer, History panel, Main pane, Diff pane, Commit detail, Repository sheet, Branch sheet, and Settings dialog.

## Global shell requirements

| ID | Disposition | Required visible structure, state, and interaction |
| --- | --- | --- |
| `REF-GLOBAL-001` | `MATCH` | Windows-only custom shell with a 38 px title bar, tab strip, top app bar, then a flex body containing an 88 px navigation rail, a 372 px list panel, and a flexible main pane. The root is `100vh`, minimum 1240×700 CSS px, clipped internally, and globally non-selectable. |
| `REF-GLOBAL-002` | `MATCH` | Body typography is Roboto/Segoe UI/system at 14 px; code/SHA/path content uses Roboto Mono; styled tabs may use Roboto Serif. Material Symbols Rounded supplies icons. |
| `REF-GLOBAL-003` | `MATCH` | Major cards use surface roles, 24–28 px outer corners, elevation levels 1–3, rounded state layers, and dense 10–14 px supporting text. Interactive hover shapes often morph between rounded rectangles and full pills. |
| `REF-GLOBAL-004` | `MATCH` | Custom scrollbars are 10 px, transparent-track, fully rounded thumbs using 45% outline with a 3 px transparent border; hover uses 75% outline and 2 px border. |
| `REF-GLOBAL-005` | `MATCH` | Keyboard focus uses a 3 px primary-color-mix outline with 1 px offset for buttons and inputs. The reference removes normal outlines globally. |
| `REF-GLOBAL-006` | `AMBIGUOUS` | The prototype is visually Windows chrome, but the screenshots were made through a design runtime and are not proof of native hit testing, DPI rounding, or actual Electron window behavior. |

## Title bar, tabs, app bar, and rail

| ID | Disposition | Element inventory and required states |
| --- | --- | --- |
| `REF-SHELL-001` | `MATCH` | Title bar: 10 px left padding; 21×21 primary app tile with 7 px radius and `commit` icon; “Desktop Material” 12.5 px/600; six menu labels (File, Edit, View, Repository, Branch, Help); flexible drag region; three 46 px-wide Minimize, Maximize, Close buttons. Close hover turns error red/on-error. |
| `REF-SHELL-002` | `AFFORDANCE` | The six menu buttons and all three window buttons have hover styling but no prototype action. Their presence/geometry is addressable; the package does not specify menu contents or native window behavior. |
| `REF-TABS-001` | `MATCH` | Tab strip has 6 px gap and 6 px top/16 px right/12 px left padding. Each tab is 38 px high, 132–240 px wide, with 14/14/5/5 px corners, repository icon, ellipsized styled title, active elevation, active 26×26 text-format button, and a 24×24 close button when more than one tab exists. |
| `REF-TABS-002` | `STATE` | Single click selects and switches the tab-bound repository/branch. Double click replaces the title with an autofocus inline input and primary underline; blur or Enter accepts trimmed text; Escape cancels. Add creates a “New tab”; close is blocked when only one remains and selects the prior neighbor when closing the active tab. |
| `REF-TABS-003` | `MATCH` | Default `alexhart` tabs are bold “material shell” and italic, primary-colored, Roboto Serif “notifications.” The second account starts with one centered 12 px Roboto Mono “playground” tab. |
| `REF-TABS-004` | `MATCH` | Strip trailing controls: 34×34 New tab; 34×34 notification bell with filled/unfilled state and red unread badge; 30 px-high monospaced `Saved · <sha>`/`Committed <sha>` chip; 32×32 Undo, Redo, and Settings-history buttons with dimmed unavailable state. |
| `REF-TABFMT-001` | `MATCH` | Tab-format popover is fixed at top 88 px, dynamically positioned from the active tab, 320 px wide, 16 px padded, 22 px radius, elevation 3. It contains close; Bold/Italic/Underline; left/center/right alignment; size range 11–17 px in 0.5 steps; Roboto/Serif/Mono; and six color swatches (Default, Primary, Green, Amber, Error, Outline). |
| `REF-TABFMT-002` | `STATE` | Formatting updates the active tab immediately and writes a simulated settings-history commit. Selected controls use secondary-container state; the chosen color has a primary ring. |
| `REF-APPBAR-001` | `MATCH` | Repository and branch selectors are 54 px-high elevated cards with 18 px corners, 34×34 icon tiles, optional 11 px helper labels, 14.5 px value labels, and rotating chevrons. Active foldout changes the card to primary-container. |
| `REF-APPBAR-002` | `STATE` | Sync control is a 54 px full pill. Idle is “Fetch origin / Last fetched 3 minutes ago”; when ahead it becomes primary “Push origin,” shows an upward-count badge, and after activation shows spinner, contextual text, and an indeterminate 3 px bar before resetting. |
| `REF-APPBAR-003` | `STATE` | “Commit & push” is a 54 px/18 px-corner control with Copilot subtitle. It dims when unavailable and runs three visible phases: Copilot writing, committing, pushing. The prototype then removes all files and adds an already-pushed commit. |
| `REF-APPBAR-004` | `MATCH` | Theme toggle is 46×46, full-round, surface-container-high. Hover changes to secondary-container and 14 px radius; active scales/rotates. Icon changes dark/light and rotates during theme change. |
| `REF-RAIL-001` | `MATCH` | Rail is 88 px wide with four 80 px entries: Changes, History, Actions, Branches. Each uses a 58×34 pill, 22 px filled/unfilled icon, optional 11.5 px label, active weight/color, and Changes count badge. Bottom controls are 58×40 Settings and a 38×38 account avatar. |
| `REF-RAIL-002` | `STATE` | Changes/History/Actions replace the left and main content; Branches opens its sheet without changing the current workspace. Settings opens page 0; account avatar opens the switcher. |

## Changes workspace and diff

| ID | Disposition | Element inventory and required states |
| --- | --- | --- |
| `REF-CHG-001` | `MATCH` | Changes panel is 372 px wide with 24 px radius/elevation 1. Header has “Changes” at 21 px, count chip, spacer, and a 38×38 filter-list icon. |
| `REF-CHG-002` | `AFFORDANCE` | Header filter-list icon ripples but has no handler. The separately wired Tune button is the actual filter-panel trigger. |
| `REF-CHG-003` | `MATCH` | Search is a 46 px full pill with search icon, text input, conditional clear, 32×32 `.*` regex toggle, and 32×32 Tune. Invalid regex changes the 2 px border to error. Expanded filters show New, Modified, Deleted, Included in commit, Excluded, plus Regex builder. |
| `REF-CHG-004` | `STATE` | Search matches path case-insensitively; filters are ORed across the five chips. Invalid regex is visibly red and returns the unfiltered list. “No files match…” provides a Clear filters button, although it clears only text, not selected chips. |
| `REF-CHG-005` | `MATCH` | Include-all row has a 19×19 tri-state checkbox and changed-file label. Each file row has its own 19×19 checkbox, filename, RTL-truncated directory, and 24×24 status tile: green Add, amber Edit, or error Delete. Selected row is primary-container. |
| `REF-CHG-006` | `STATE` | Default list contains 8 included files. Include-all displays check when all, minus when partial, and toggles all based on whether all are currently on. File click selects its diff; checkbox click stops row selection and toggles inclusion. |
| `REF-COMMIT-001` | `MATCH` | Composer is a low-surface card with 20 px corners, 14 px padding, AH avatar, 46 px summary field, two-row Description field, co-author, Copilot/NEW, commit-options controls, optional 40 px co-author field, and a 48 px primary commit button. |
| `REF-COMMIT-002` | `STATE` | Summary is required and at least one file must be included. Focus adds a primary 2 px border. Summary over 50 characters shows amber warning. Co-author toggles its field. Commit shows a spinner for 1.1 s, commits included files, leaves excluded files, increments ahead count, and displays an inverse-surface Undo banner. Undo restores files and summary. |
| `REF-COMMIT-003` | `AFFORDANCE` | Composer “Generate commit message” and “Commit options” controls have no prototype action. Co-author input is also not stored. |
| `REF-DIFF-001` | `MATCH` | Main pane is flexible, minimum-width 0, 24 px radius/elevation 1. Selected-file header shows 42×42 status tile, full path, status + branch, +adds green chip, −deletions error chip, and 38×38 editor action. |
| `REF-DIFF-002` | `MATCH` | Diff is Roboto Mono 12 px, horizontally/vertically scrollable, with 22 px minimum rows, two 46 px number gutters, 26 px sign column, and preformatted content. Hunk/add/delete rows use the dedicated light/dark diff token pairs. Eight fixture diffs cover additions, deletions, context, and hunks. |
| `REF-DIFF-003` | `AFFORDANCE` | “Open in Visual Studio Code” in the diff header has no prototype action. |
| `REF-EMPTY-001` | `MATCH` | With no selected diff, main pane shows an 84×84 success tile, 26 px “No local changes,” explanation, and three suggestion cards: Open in Visual Studio Code, View on GitHub, View history. The first two are no-ops; View history works. The Changes list also has a smaller 64×64 empty state. |

## History workspace

| ID | Disposition | Element inventory and required states |
| --- | --- | --- |
| `REF-HIST-001` | `MATCH` | History panel mirrors the 372 px Changes shell. Header has title and count. Search has `.*` and Tune; expanded chips are Unpushed, Tagged, Mine, plus Regex builder. |
| `REF-HIST-002` | `STATE` | Search examines summary + author. Chips are AND constraints: selected Unpushed requires unpushed, Tagged requires a tag, Mine requires AH. Commit rows show 34 px author avatar, summary, author/time, optional tag chip, and optional unpushed arrow badge; selected row is primary-container. |
| `REF-HIST-003` | `MATCH` | Commit detail header has a 42 px avatar, 18 px summary, byline, 26 px SHA-copy chip, and changed-file count. Body has a 264 px file list and a diff pane with the same diff-row treatment as Changes. |
| `REF-HIST-004` | `AFFORDANCE` | SHA-copy control is visually specified but has no prototype handler. |

## Actions and workflow surfaces

| ID | Disposition | Element inventory and required states |
| --- | --- | --- |
| `REF-ACT-001` | `MATCH` | Actions panel uses the same 372 px shell. Header has run count, 38×38 Manage workflows, and 36 px-high Run workflow. Search filters title/branch/workflow and offers Success, Failed, Running, `ci.yml`, `pages.yml`, plus Regex builder. |
| `REF-ACT-002` | `MATCH` | Run rows show status icon (green success, error failure, spinning primary running), title, `#id · branch · event · time`, and workflow chip. Default list contains five runs. |
| `REF-WFMGR-001` | `STATE` | Expandable Workflow manager card reports enabled/total, opens New workflow, and lists installed workflows with 30 px icon tiles and 46×28 switches. Disabling keeps history but suspends runs in copy; if it was the dispatch workflow, the first enabled workflow is selected. |
| `REF-RUNDETAIL-001` | `MATCH` | Run detail header has 42×42 status tile, 18 px title, branch chip, run metadata, Re-run, conditional Re-run failed, and View on GitHub. Body has a 264 px job/step column and inverse-surface monospaced Job log. CI fixtures have 6 steps; Pages has 5. Success/failure/running have distinct icons, skipped/pending states, and 7/8/4 log-line fixtures. |
| `REF-RUNDETAIL-002` | `STATE` | Re-run changes the selected non-running run to running, then success after 2.6 s and creates a notification. Re-run failed uses the same simulation with different notification copy. |
| `REF-RUNDETAIL-003` | `AFFORDANCE` | View on GitHub is unhandled. Re-run remains visually enabled for an already-running run but the handler returns without action. |
| `REF-DISPATCH-001` | `MATCH` | Fixed non-modal popover is top 200/left 400, 340 px wide, 24 px radius, 18 px padding. It has close, enabled-workflow segmented choices, two ref choices (`development`, `material-shell`), optional reason input, and primary Run workflow. |
| `REF-DISPATCH-002` | `STATE` | Dispatch prepends a running manual run, closes/reset reason, notifies, then changes it to success after 4.2 s and notifies again. |
| `REF-CATALOG-001` | `MATCH` | Non-modal draggable catalog is 830×640 (viewport max minus 50), 28 px radius. Header says New workflow and destination branch. Search has regex/Tune; five category chips; two-column card grid; empty state. |
| `REF-CATALOG-002` | `MATCH` | Eight cards expose icon, name, `.yml` file, category, description, trigger. Already installed templates show green Added; others show primary Use workflow. Categories: CI, Deployment, Security, Automation, Packaging. |
| `REF-CATALOG-003` | `STATE` | Use workflow adds/enables it in memory, adds a settings-history log entry, and creates a notification. The source does not create an actual `.github/workflows` file. |
| `REF-CATALOG-004` | `AMBIGUOUS` | The Electron release catalog card explicitly says it packages Windows, macOS, and Linux. That is fixture/template copy, not proof that this Windows-only product should gain non-Windows build or release targets. |

## Repository, branch, and clone surfaces

| ID | Disposition | Element inventory and required states |
| --- | --- | --- |
| `REF-SHEET-001` | `MATCH` | Repository/Branch sheets use a 42% black color-mix scrim, fixed 10 px inset top/left/bottom, 390 px width, 28 px radius, elevation 3, and left-slide spring entrance. Scrim click closes the foldout. |
| `REF-REPO-001` | `MATCH` | Repository header: Repositories, 40 px Add, 40 px Clone, 40×40 close. Search is 46 px with regex/Tune. Expanded filters contain Cloned only and Regex builder. Groups render uppercase headings and 14 px-radius rows with 34 px repo tile, name, owner, and selected check. |
| `REF-REPO-002` | `STATE` | Current v2 defaults to two groups: Recent (first 2 local repos) and account name (all 4), so two entries are intentionally duplicated. Selecting a repo updates the active tab and closes the sheet. Search is case-insensitive/plain or regex. |
| `REF-REPO-003` | `AFFORDANCE` | Add has no action. “Cloned only” toggles visual selection but does not change results because current v2 supplies only local repositories to this sheet. Dead `cloneMode`/clonable-row logic exists but is never activated. |
| `REF-BRANCH-001` | `MATCH` | Branch header has title, Merge all into development control, and close. Two 40 px segmented tabs are Branches and Pull requests. Branch search has regex/Tune; filter chip is Default & recent only; rows are grouped Default/Recent/Other, monospaced branch name, recency, and current check. A 56 px-high extended New branch FAB sits bottom-right. |
| `REF-BRANCH-002` | `MATCH` | Pull requests tab has 66×66 merge tile, “No open pull requests,” repository-specific explanation, and Create new branch CTA. |
| `REF-BRANCH-003` | `STATE` | Merge-all computes five initial candidates (all recent/other except current `material-shell` and `gh-pages`), shows per-branch progress, gives `dialogs-and-flows` a Copilot-conflict phase, then removes candidates and reports merge/delete/push in a notification. It is a timer-only simulation. |
| `REF-BRANCH-004` | `AFFORDANCE` | New branch FAB and Pull-request empty-state CTA are unhandled. Merge-all has no confirmation despite destructive copy. |
| `REF-CLONE-001` | `MATCH` | Current v2 Clone is a non-modal draggable 790×664 dialog (viewport max minus 50), 28 px radius. Header contains 40×40 cloud tile, account-specific explanation, close. Search is 48 px with regex/Tune and five chips: TypeScript, Ruby, Shell, Public, Private. |
| `REF-CLONE-002` | `MATCH` | For `alexhart`, owner chips are All, alexhart, desktop-material-org. Repository cards show 19×19 selection, name, visibility, description, language dot/name, stars, forks, size, default branch, updated time, plus progress/percent or green Cloned. Default All view contains six candidates. |
| `REF-CLONE-003` | `MATCH` | Footer reports selected count + aggregate MB, offers Parallel/One by one segmented strategy, and primary Clone selected with dim/busy state. Empty state distinguishes everything cloned from no search/filter match. |
| `REF-CLONE-004` | `STATE` | Clone advances randomized progress every 260 ms, all at once or sequentially. Completion moves selected names from available to local account repositories, logs a settings commit, and notifies. No network/disk clone occurs. |
| `REF-CLONE-005` | `AMBIGUOUS` | `07-clone.png` shows a repository sheet with a clone-selection footer, while the current v2 source puts clone selection in a separate dialog. The annotated upload shows an even earlier inline “Available to clone” section. Treat the separate v2 dialog as current unless product direction restores inline cloning. |

## Settings, accounts, and local-history surfaces

| ID | Disposition | Element inventory and required states |
| --- | --- | --- |
| `REF-SET-001` | `MATCH` | Settings is a non-scrim centered 940×660 surface (viewport max minus 60), 28 px radius/elevation 3. Left navigation is 236 px, 8 pill rows, version `Desktop Material 0.1.0`. Right area has top close, scrollable content, and Cancel/Save footer. |
| `REF-SET-002` | `STATE` | Page changes are immediate; both Cancel and Save merely close. There is no transactional rollback or persistence. Outside the dialog remains pointer-interactive because the full-screen wrapper has `pointer-events:none` and only the card re-enables them. |
| `REF-ACCOUNTS-001` | `MATCH` | Accounts page: heading/explanation; two GitHub.com account cards with 44 px avatars, identity/meta, active chip, and Sign out; Add another account; GitHub Enterprise explanation/sign-in; GitLab server URL, password-masked personal access token, and Sign in to GitLab. |
| `REF-ACCOUNTS-002` | `AFFORDANCE` | Both Sign out buttons, both Add account buttons, GitHub Enterprise sign-in, and GitLab sign-in are unhandled. Only the GitLab URL text field mutates prototype state; the token is not stored. |
| `REF-INTEGRATIONS-001` | `MATCH` | Applications page has two 18 px-radius rows: External editor/Visual Studio Code and Shell/PowerShell, each with 42×42 icon tile and selector-looking 40 px button. |
| `REF-INTEGRATIONS-002` | `AFFORDANCE` | The two selector-looking buttons are not native selects and are unhandled; no option menus are specified. |
| `REF-GITSET-001` | `MATCH` | Git page has labeled 48 px Name and Email fields and two 40 px branch-name chips (`main`, `development`) with selected check/state. |
| `REF-APPEAR-001` | `MATCH` | Appearance page has three max-190 px theme cards (Light, Dark, System), each with 84 px preview, 20 px corners, selected 2.5 px primary border/check. It also has a UI-scale card with 50–200% slider in steps of 5, live percent, and Auto-fit switch/explanation. |
| `REF-NOTIFSET-001` | `MATCH` | Notifications page has one 54×32 Enable notifications switch and explanatory copy. |
| `REF-PROMPTS-001` | `MATCH` | Prompts page has four 16 px-radius checkbox rows, initially checked: Removing repositories, Discarding changes, Checking out a commit, Force pushing. |
| `REF-AUTOMATION-001` | `MATCH` | Automation page has Auto commit & push (initially off) and Auto pull (initially on), each with 54×32 switch and, while enabled, interval pills at 5/15/30/60 minutes. A third informational card describes Merge all branches. |
| `REF-ADVANCED-001` | `MATCH` | Advanced page contains informational Usage stats and Credential storage cards with 42×42 tiles. No toggle/control is provided for Usage stats. |
| `REF-ACCTSW-001` | `MATCH` | Account switcher is fixed left 14/bottom 18, 334 px wide, 24 px radius, 12 px padding. It lists two accounts with 38 px avatars, name, login/tab/commit metadata, active check, divider, and Add another account. A scrim is active. |
| `REF-ACCTSW-002` | `STATE` | Switching account loads that account’s active tab repository/branch, closes formatting/account menu, clears clone selection, and resets selected commit. Add another account is a no-op. |
| `REF-SETTINGSHIST-001` | `MATCH` | Settings-history panel is fixed top/right/bottom 10, 404 px wide, 28 px radius. Header has 40×40 icon, title, account path, close; description; 40 px Undo/Redo; commit count; rows with SHA chip, message/time, HEAD pill or history icon. |
| `REF-SETTINGSHIST-002` | `STATE` | Undo/Redo/row click restores an in-memory snapshot and moves HEAD. A new settings change truncates redo history, appends random seven-hex SHA, pulses the Saved chip for 900 ms, and marks it “Committed.” |
| `REF-SETTINGSHIST-003` | `AMBIGUOUS` | README says every tab/settings change commits to a per-account Git repo. The source has no filesystem/Git calls. Snapshots omit automation, UI scale, auto-fit, workflows, and GitLab URL even when some create log entries; live settings are mostly global rather than account-owned. Match the visible history UX, not the completeness claim, until product semantics are defined. |

## Notification centre

| ID | Disposition | Element inventory and required states |
| --- | --- | --- |
| `REF-NOTIF-001` | `MATCH` | Notification centre is fixed top/right/bottom 10, 384 px wide, 28 px radius, right-slide entrance. Header has 40×40 filled-bell tile, title, `~/.desktop-material/notifications.git · <count/hash>`, mark-all-read, and close. |
| `REF-NOTIF-002` | `MATCH` | Two 36 px segmented tabs: All and Unread. Cards show 34×34 kind icon, title, body, time, unread dot, and 26×26 delete. Unread cards use surface background/heavier title. Empty unread/all state says “You’re all caught up.” |
| `REF-NOTIF-003` | `STATE` | Card click toggles read/unread; delete stops card click and removes; mark-all marks read. Each mutation increments a simulated commit count and random SHA. Bell badge reflects unread count. Other simulated operations prepend notifications, capped at 30. |
| `REF-NOTIF-004` | `AMBIGUOUS` | Enable notifications setting does not gate `notify()` in source. Notification and Settings-history panels can both be opened; notification is z-index 56 over history z-index 55. |

## Regex and search

| ID | Disposition | Element inventory and required states |
| --- | --- | --- |
| `REF-SEARCH-001` | `MATCH` | Every current search context uses the same visual grammar: search field, plain/regex placeholder, `.*` state button, Tune button, contextual chips, and Regex builder. Source contexts are Changes, History, Branches, Repositories, Clone, Actions, and Workflow Catalog. |
| `REF-SEARCH-002` | `STATE` | Plain matching is case-insensitive substring. Regex matching compiles with `i`; invalid pattern makes field border error and returns unfiltered results. Context filter rules are as described in each surface section. |
| `REF-REGEX-001` | `MATCH` | Regex builder is a non-modal draggable 900×644 dialog (viewport max minus 50), 28 px radius. Header has 40×40 `.*` tile/title/target explanation/close. Segmented tabs are Build and How regex works. |
| `REF-REGEX-002` | `MATCH` | Pattern row is 50 px high with `/ pattern /flags`, validity icon, 44×44 backspace and clear. Flags row has six 32 px pills: g, i, m, s, u, y. Default pattern empty, default flag `i`. |
| `REF-REGEX-003` | `MATCH` | Build view has a 176 px category rail and 35 token buttons: Anchors 4; Character classes 12; Quantifiers 8; Groups & refs 5; Alternation 2; Lookaround 4. Live tester has sample textarea, match-count/error chip, and inline highlighted segments. Footer has Cancel and target-specific Apply. |
| `REF-REGEX-004` | `MATCH` | Guide view has 9 sections: matching, anchors, classes, quantifiers, groups/backrefs, alternation, lookaround, flags, Desktop Material usage. Seven sections include code examples. `docs/regex-guide.md` supplies equivalent longer-form content and Tips. |
| `REF-REGEX-005` | `STATE` | Tester adds `g` for counting, stops at 80 matches, refuses zero-length match loops, and highlights matches. Apply copies the pattern to the originating search and turns its regex mode on. |
| `REF-REGEX-006` | `AMBIGUOUS` | Builder-selected flags affect only the tester. Applied searches always compile with `i`, so g/m/s/u/y are not carried to search. The guide says pattern length is capped, but no cap exists in source. |

## Theme, tokens, typography, and motion

| ID | Disposition | Requirement |
| --- | --- | --- |
| `REF-THEME-001` | `MATCH` | Light, Dark, and System choices exist. App-bar toggle alternates explicit light/dark. Selecting System reads `prefers-color-scheme` once. Most surfaces transition colors over 480 ms. A radial primary-tinted reveal pulse expands from about 78%/8% for 750 ms and is removed after 800 ms. |
| `REF-THEME-002` | `AMBIGUOUS` | System mode has no media-query change listener, so it does not live-update after selection. `themePick` can say System while `dark` is the one-time sampled value. |
| `REF-MOTION-001` | `MATCH` | Motion vocabulary has 16 keyframes: Down, Up, Left, Right, Pop, Grow, Sheet-left, Scrim, Dialog, Ripple, Spin, Indeterminate bar, Pulse, Reveal, Bounce, Sheet-right. Entrances are typically 320–600 ms with 40–700 ms staggers; interactive transforms are typically 180–320 ms. |
| `REF-MOTION-002` | `MATCH` | Exposed design prop `motionScale` is 0.4–2.2 in 0.1 steps and sets `--mdur`; helper-description and rail-label props are booleans defaulting true. Only animations written with `calc(... * var(--mdur))` scale; many transitions, fixed animations, and state timers do not. |
| `REF-TYPE-001` | `MATCH` | Loaded families/weights: Roboto 400/500/600/700; Roboto Mono 400/500; Roboto Serif normal/italic 400/600; Material Symbols Rounded variable opsz/weight/fill/grade. Body is 14 px. Visible sizes span 10–42 px, with most labels 11–14.5, section titles 17–21, interstitial title 26. |

### Color and elevation tokens

The v2 source defines 25 M3 color roles. A dash means dark mode inherits the light declaration rather than overriding it.

| Token | Light | Dark |
| --- | --- | --- |
| `primary` | `#006493` | `#8dcdff` |
| `on-primary` | `#ffffff` | `#00344f` |
| `primary-container` | `#c9e6ff` | `#004b70` |
| `on-primary-container` | `#001e30` | `#c9e6ff` |
| `secondary` | `#50606e` | inherited |
| `on-secondary` | `#ffffff` | inherited |
| `secondary-container` | `#d3e5f5` | `#394956` |
| `on-secondary-container` | `#0c1d29` | `#d3e5f5` |
| `error` | `#ba1a1a` | `#ffb4ab` |
| `on-error` | `#ffffff` | `#690005` |
| `error-container` | `#ffdad6` | `#93000a` |
| `on-error-container` | `#410002` | `#ffdad6` |
| `surface` | `#f8f9ff` | `#111417` |
| `surface-container-lowest` | `#ffffff` | `#0c0f12` |
| `surface-container-low` | `#f2f3f9` | `#191c20` |
| `surface-container` | `#eceef4` | `#1d2024` |
| `surface-container-high` | `#e6e8ee` | `#282a2e` |
| `surface-container-highest` | `#e0e2e8` | `#333539` |
| `on-surface` | `#191c20` | `#e1e2e7` |
| `on-surface-variant` | `#41474d` | `#c1c7ce` |
| `outline` | `#71787e` | `#8b9198` |
| `outline-variant` | `#c1c7ce` | `#41474d` |
| `inverse-surface` | `#2e3135` | `#e1e2e7` |
| `inverse-on-surface` | `#eff1f7` | `#2e3135` |
| `scrim` | `#000000` | inherited |

| Extension token | Light | Dark |
| --- | --- | --- |
| `--dm-green` | `#1b7f37` | `#57ab5a` |
| `--dm-green-container` | `#d2f2d8` | `#113a1b` |
| `--dm-amber` | `#9a6700` | `#d8a739` |
| `--dm-amber-container` | `#ffe9b8` | `#3d2e00` |
| `--diff-add-bg` | `#e9f5ea` | `#12261a` |
| `--diff-add-gutter` | `#d0ebd3` | `#1a3826` |
| `--diff-del-bg` | `#fdecea` | `#2d1512` |
| `--diff-del-gutter` | `#f7d7d3` | `#46201b` |
| `--diff-hunk-bg` | `#e3effa` | `#16242f` |
| `--diff-hunk-text` | `#3d5a75` | `#8ab4d8` |

Elevation tokens are exact: level 1 `0 1px 2px rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15)`; level 2 changes the second shadow to `0 2px 6px 2px`; level 3 is `0 1px 3px rgba(0,0,0,.3), 0 4px 8px 3px rgba(0,0,0,.15)`.

Motion properties are `--spring: cubic-bezier(0.38,1.21,0.22,1)`, `--spring-fast: cubic-bezier(0.42,1.67,0.21,.90)`, `--emph: cubic-bezier(.20,0,0,1)`, and `--mdur: 1`.

### Shape and dimension vocabulary

Observed template radii are 4, 6, 7, 8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, and 999 px, plus compound tab/preview radii. The repeated control-height vocabulary is 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 54, and 56 px. Major fixed widths are 320, 334, 340, 372, 384, 390, 404, 790, 830, 900, and 940 px.

## Responsive and scaling behavior

| ID | Disposition | Requirement/limitation |
| --- | --- | --- |
| `REF-RESP-001` | `MATCH` | No reflow breakpoint exists. The shell has `min-width:1240px` and `min-height:700px`. Auto-fit computes `manualZoom × min(1, window.innerWidth / 1240)` and applies CSS `zoom` to the entire root. It never fits height and never grows beyond manual zoom. |
| `REF-RESP-002` | `MATCH` | Dialogs use fixed preferred sizes with `max-width/max-height` of viewport minus 50 or 60 px. Side sheets/popovers remain fixed-width/positioned. Clone, Regex, and Catalog can be dragged with no viewport clamping. Tab-format left is capped at 900 px rather than calculated from viewport. |
| `REF-RESP-003` | `AMBIGUOUS` | Appearance copy says Ctrl+/Ctrl−/Ctrl0 work, but v2 registers no keyboard listener. Browser zoom may react, but the internal 50–200% state will not. |
| `REF-RESP-004` | `AMBIGUOUS` | All seven gallery screenshots are 924×540 and visibly contain horizontal scrollbars/clipping in dense panels. The 390×640 thumbnail compresses the 1240 px desktop shell into a narrow miniature and leaves a large blank lower region. These are evidence of scaling, not a responsive narrow layout. |

## Language and copy coverage

| ID | Disposition | Requirement/limitation |
| --- | --- | --- |
| `REF-I18N-001` | `ABSENT` | The package contains no language selector, locale state, translation resources, bidi behavior, or alternate strings. All user-facing copy is hard-coded English. Therefore the reference cannot establish layouts for English/Cantonese/bilingual modes required elsewhere by project policy. |
| `REF-I18N-002` | `MATCH` | For English comparison, preserve the supplied terminology and punctuation: Desktop Material, Changes, History, Actions, Repositories, Branches, Settings, Notifications, Regex builder, New workflow, Clone repositories, Commit & push, and the ellipsis/center-dot conventions used in state copy. |

## Accessibility semantics visible in the reference

| ID | Disposition | Observation for remediation |
| --- | --- | --- |
| `REF-A11Y-001` | `MATCH` | Preserve focus-visible treatment, semantic `nav`, native buttons/inputs where used, `aria-haspopup` on repository/branch selectors, `role=switch` + `aria-checked` on switches, and aria labels on file include checkboxes. |
| `REF-A11Y-002` | `AMBIGUOUS` | Ten clickable `div role=button` templates lack `tabindex`/keyboard activation; tab `div role=tab` lacks `aria-selected`; several checkbox roles lack `aria-checked`; many icon-only close/action buttons lack accessible names. These are prototype defects, not behaviors to reproduce. |
| `REF-A11Y-003` | `AMBIGUOUS` | Textareas have normal outline removed but are omitted from the custom `:focus-visible` rule. Global non-selection, very small 10–11.5 px copy, icon-font dependence, and color-only selected borders require product accessibility review beyond pixel matching. |

## Prototype-only behavior and no-op ledger

The reference contains no Git, filesystem, GitHub, GitLab, notification-service, credential-store, or Electron IPC calls. All substantial operations are arrays, `setState`, random SHAs/progress, and timers.

| ID | Disposition | Prototype limitation |
| --- | --- | --- |
| `REF-PROTO-001` | `STATE` | Commit, push/fetch, one-click commit/push, merge-all, clone, workflow re-run, and workflow dispatch are timer simulations. Audit the visible busy/success/error states separately from real service correctness. |
| `REF-PROTO-002` | `STATE` | Settings and notification “Git repositories” are in-memory arrays only; refresh loses everything. Random seven-hex strings are presentation values, not commits. |
| `REF-PROTO-003` | `AFFORDANCE` | Twenty-eight reachable no-op instances across states: six app menus; Minimize/Maximize/Close; Changes header filter; composer Generate and options; diff Open in VS Code; history Copy SHA; Actions View on GitHub; Repository Add; two branch-creation controls; two Sign out; two Add-account locations; Enterprise/GitLab sign-in; editor/shell selectors; and empty-workspace Open in editor/View on GitHub. Some still ripple because `onMouseDown` is wired. |
| `REF-PROTO-004` | `AMBIGUOUS` | README calls Settings, Clone, and Regex non-modal and draggable. Clone/Regex (and Catalog) are draggable; Settings is non-modal but has no drag handler. |
| `REF-PROTO-005` | `AMBIGUOUS` | App screenshot content and current source do not always align: current source has an Automation settings tab and Regex Build/Guide tabs, while corresponding screenshots omit them. |

## Runtime (`support.js`) implications

| ID | Disposition | Runtime fact |
| --- | --- | --- |
| `REF-RUNTIME-001` | `AMBIGUOUS` | The `.dc.html` is not ordinary app HTML. `support.js` parses `<x-dc>`, conditionals/repeats, interpolations, style pseudo-attributes, and evaluates `class Component extends DCLogic` into React rendering. Pixel comparison must account for this design runtime. |
| `REF-RUNTIME-002` | `AMBIGUOUS` | Runtime loads React 18.3.1 and ReactDOM 18.3.1 from unpkg with SRI when not prebundled; HTML loads Google Fonts. Opening the folder offline can fail or fall back to local fonts, so the package is not truly dependency-free despite being a single main HTML. |
| `REF-RUNTIME-003` | `MATCH` | `style-hover`/`style-active` are compiled to generated CSS pseudo-classes; ripples append a temporary current-color circle for 620 ms. These interaction visuals are intentional requirements even though implementation technology may differ. |
| `REF-RUNTIME-004` | `AMBIGUOUS` | The runtime supports streaming placeholders, editor bridges, external components, print CSS, and `new Function` logic evaluation. None of those are Desktop Material product requirements. |

## Older HTML delta

The older HTML is a useful baseline, not the target. It has the same base colors, typography (except Roboto Serif), core file/commit fixtures, diff treatment, title bar, app bar, rail, Changes, History, repositories/branches, and seven-page Settings.

Notable v2 additions/changes are implementation-addressable under the IDs above: tabs/formatting, multi-account and settings history, Actions/workflow surfaces, current clone dialog, regex search/builder/guide, notifications, one-click commit/push, merge-all, Automation, GitLab, UI scaling/auto-fit, right-side sheets, body overflow auto, root minimum height, and Roboto Serif. V2 changes rail entries from 3 to 4 and settings pages from 7 to 8. Older History has an unbound “Select branch to compare…” input instead of v2 search/filter controls. Older repository groups are Recent, alexhart, and Other and contain five unique local repositories; v2 makes repositories account-bound.

## Screenshot-by-screenshot reference matrix

| Screenshot | Visible state and pixel evidence | Authority notes |
| --- | --- | --- |
| `workspace-changes-light.png` | Light shell; two styled tabs; repository/branch cards; Changes selected with red `8` badge; filters collapsed; selected `_material.scss` green-add diff; composer visible. Horizontal scrollbars appear in list/diff. | Strong visual evidence for `REF-SHELL-*`, `REF-TABS-*`, `REF-CHG-*`, `REF-DIFF-*`; right app-bar controls are outside/cropped from the captured view. |
| `workspace-dark.png` | Same workspace in dark; Changes filter chips expanded; Regex builder chip; dark composer and green diff. | Strong dark-token/state evidence. |
| `tab-text-style.png` | Light 320 px format popover over workspace; Bold and left selected; 12.5 px; Roboto selected; six color swatches. | Matches current source closely. |
| `regex-builder.png` | Centered light builder over dimmed workspace; pattern `^`, `i` flag, Anchors selected, tester, Cancel/Apply. | Stale/contradictory: screenshot omits current Build/How regex tabs, and shows a dim background although current `rbOpen` does not enable scrim. |
| `settings-history-manager.png` | Right 404 px history sheet, light; 3 commits; Undo enabled/Redo dim; HEAD on `a41f9c2`; workspace remains undimmed. | Matches source defaults and right-sheet geometry. |
| `settings-accounts-dark.png` | Dark Settings with 236 px left nav and accounts cards; vertical and horizontal scrollbars; Cancel/Save. | Stale: left nav shows 7 tabs and omits current Automation. Useful dark/dialog evidence. |
| `07-clone.png` | Scrimmed repository sheet with Add/Clone, search, local groups, bottom selection/strategy/Clone selected footer. | Historical clone variant; conflicts with current separate clone dialog. |
| Auxiliary annotated upload | Full 1593×947 light repository sheet. Red annotation circles inline Available to clone entries (`gemoji`, `dugite`, `printenvz`). No selection footer. | Earlier historical variant; annotation itself is not product UI. |
| `.thumbnail` | 390×640 miniature Actions workspace with failed run, job steps, and dark job log crowded into top portion. | Only supplied Actions visual. It demonstrates content hierarchy, not usable narrow responsiveness. |

## Explicit ambiguity decisions needed before strict pixel sign-off

1. `REF-CLONE-005`: separate v2 Clone dialog versus two older inline repository-sheet clone designs.
2. `REF-PROTO-004`: whether Settings must become draggable as README claims.
3. `REF-PROTO-005`: whether screenshots should be regenerated for Automation and Regex guide tabs or the source should be rolled back.
4. `REF-RESP-004`: whether horizontal scrollbars/clipping at 924×540 are accepted reference artifacts or defects.
5. `REF-REGEX-006`: whether search must preserve all selected regex flags and enforce a pattern-length cap.
6. `REF-SETTINGSHIST-003`: which settings are truly per-account and restorable.
7. `REF-NOTIF-004`: whether notification enablement gates events and whether right panels are mutually exclusive.
8. `REF-A11Y-002`/`003`: accessibility should improve on the prototype rather than reproduce its missing semantics.
9. `REF-I18N-001`: the design package cannot adjudicate the project’s required three language modes.

## Audit acceptance summary

A complete implementation comparison should exercise at least these addressable visual states: light and dark Changes (filters closed/open); selected/add/delete diff rows; partial/all/none inclusion; commit disabled/focused/warning/busy/undo; no-change and no-match states; History filters/tag/unpushed/detail; Actions success/failure/running, manager, catalog, dispatch, logs; repository and branch sheets plus PR empty; separate Clone search/filter/selection/progress/done/empty; both accounts and tab rename/format/add/close; settings pages 0–7; notification all/unread/empty; settings-history HEAD/undo/redo/restore; Regex valid/invalid/build/guide/apply; theme reveal; 50/100/200% and auto-fit at 1240×700 and 924×540.

Backend verification must not use the prototype’s timers/random data as acceptance evidence. Conversely, no-op affordances must not be reported as missing interactions solely from this design package.
