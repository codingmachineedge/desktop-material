# Branch switcher workflows

The branch sheet combines local and remote branches with text filtering,
recent branches, default-branch context, activity/alphabetical sorting, and
explicit hidden/solo visibility controls. Local branches without a working
upstream retain a visible publish state.

Branch creation can use bounded name presets emitted by an optional custom
integration. Presets show both a prefix/name and description, and the first nine
can be selected by keyboard. Repository Settings can override the default
branch used by comparisons and related workflows.

A checkout still passes through the existing dirty-worktree, conflict,
submodule, and in-progress-operation protections. Filter and visibility choices
do not delete refs. Invalid preset output is treated as display input and the
final branch name remains subject to Git ref validation.

Failures from a preset process are bounded by timeout/output limits and direct
the user back to Settings. Branch discovery remains usable without the custom
integration.

Verification includes `branch-preset-test.ts`, branch grouping/filter suites,
recent-branch Git tests, and the checkout/branch dispatcher suites.
