# GitHub Desktop demand backlog coverage

This ledger maps the 30 user-demand statements in the supplied research brief
to their Desktop Material implementation and feature contract. **Complete**
means the behavior is present in the application tree and has focused automated
coverage; release and headless acceptance evidence is recorded separately in
`HANDOFF.md`.

| # | Demand | Status | Feature contract |
|---:|---|---|---|
| 1 | Multiple accounts and per-repository identity | Complete | [Identity and account binding](identity-and-workspace/multiple-accounts-and-repository-identity.md) |
| 2 | Full in-app pull-request review | Complete | [PR review workspace](collaboration/pull-request-review-workspace.md) |
| 3 | Selective stash of chosen files | Complete | [Selective stashes](repository-management/selective-stashes.md) |
| 4 | Rich pull-request context and actions | Complete | [PR context and actions](collaboration/pull-request-context-and-actions.md) |
| 5 | Complete tag lifecycle | Complete | [Tag lifecycle](repository-management/tag-lifecycle-management.md) |
| 6 | In-app pull-request creation | Complete | [PR creation](collaboration/pull-request-creation.md) |
| 7 | Desktop notifications for PR activity | Complete | [PR notifications](collaboration/pull-request-activity-notifications.md) |
| 8 | Multiple and named stashes | Complete | [Named Stash Manager](repository-management/named-stash-manager.md) |
| 9 | Advanced history search and remote commits | Complete | [Advanced History](repository-management/advanced-history-discovery.md) |
| 10 | Repository sidebar, pinning, and switching | Complete | [Repository sidebar](identity-and-workspace/repository-sidebar-and-pinning.md) |
| 11 | Branch-switcher improvements | Complete | [Branch workflows](identity-and-workspace/branch-switcher-workflows.md) |
| 12 | Checkout branches from other forks | Complete | [Fork branch checkout](collaboration/fork-branch-checkout.md) |
| 13 | Tree view for changed files | Complete | [Changed-file tree](review-and-diff/changed-file-tree-view.md) |
| 14 | Repository-picker filters and visibility | Complete | [Picker filters](repository-management/repository-picker-filters-and-visibility.md) |
| 15 | Pull or fetch across reviewed repositories | Complete | [Batch sync](repository-management/reviewed-batch-sync.md) |
| 16 | Recognize and manage external stashes | Complete | [External stashes](repository-management/external-stash-interoperability.md) |
| 17 | WSL-aware editor and file integration | Complete | [WSL editor opening](integrations/wsl-aware-editor-opening.md) |
| 18 | Structured CSV/TSV diffs | Complete | [Structured data diffs](review-and-diff/structured-csv-and-tsv-diffs.md) |
| 19 | Custom Git commands and extensibility | Complete | [Custom command presets](integrations/custom-git-command-presets.md) |
| 20 | Always-expanded and richer diff context | Complete | [Expanded context](review-and-diff/expanded-diff-context.md) |
| 21 | One-click open in editor | Complete | [Editor actions](integrations/one-click-editor-actions.md) |
| 22 | Rich `.tga` image previews | Complete | [TGA previews](review-and-diff/tga-image-previews.md) |
| 23 | Broader external-editor support | Complete | [Editor discovery](integrations/broad-editor-support.md) |
| 24 | Global Git ignore management | Complete | [Global ignore](integrations/global-ignore-management.md) |
| 25 | Patch-series import and export | Complete | [Patch series](repository-management/patch-series.md) |
| 26 | Bulk local-branch deletion | Complete | [Reviewed branch deletion](repository-management/reviewed-bulk-branch-deletion.md) |
| 27 | Network-drive and WSL repository paths | Complete | [Network paths](repository-management/network-and-wsl-repository-paths.md) |
| 28 | Copilot commit-message controls | Complete | [Copilot controls](integrations/copilot-commit-message-controls.md) |
| 29 | In-app GitHub project-board view | Complete | [GitHub Projects](collaboration/offline-github-projects.md) |
| 30 | Offline cached project view | Complete | [Offline Projects](collaboration/offline-github-projects.md) |

The category indexes describe bounds, configuration, failure recovery,
security, and verification for each workflow. No item in this ledger creates a
new application HTTP endpoint, so no backlog-specific Postman collection is
applicable.
