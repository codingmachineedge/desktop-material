# Broad editor support

Desktop Material's supported Windows catalog includes Visual Studio
Code/VSCodium variants, JetBrains IDEs, Sublime Text, Vim/Neovim front ends,
and other Windows editors. Discovery uses validated application registration
metadata and known executable locations. A custom executable/argument
integration remains available when a supported editor is installed elsewhere
on Windows.

Discovery checks registration/path metadata and never starts a candidate.
Duplicate editions stay distinguishable, missing executables are skipped, and
the selected value falls back with clear Preferences guidance. Launches do not
use a shell. Custom argument parsing, process output, and time are bounded.

Windows editor discovery, custom integration, and launch tests verify these
contracts. The product support boundary is documented in
[Windows-only platform support](windows-only-platform-support.md). WSL editions
are covered by
[WSL-aware editor opening](wsl-aware-editor-opening.md), and entry points by
[One-click editor actions](one-click-editor-actions.md).
