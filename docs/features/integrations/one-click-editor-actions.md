# One-click editor actions

The selected external editor is one action away from repository rows, the
Changes empty state, changed-file context menus, conflict rows, and the diff
header. File actions pass the exact selected path; repository actions pass the
working-tree root. Tooltips name the resolved editor when available.

Every launch uses an executable and positional argument array with no command
shell. A missing app, rejected custom configuration, or launch failure leaves
the repository untouched and offers Preferences recovery. Repository-specific
editor overrides are resolved before the app default and never change another
repository's choice.

Verification includes diff-header, file/repository context-menu, conflict row,
editor launch, and repository override suites. Discovery details are in
[Broad editor support](broad-editor-support.md).
