# Broad editor support

Desktop Material discovers a curated cross-platform catalog including Visual
Studio Code/VSCodium variants, JetBrains IDEs, Sublime Text, Vim/Neovim front
ends, and many platform-specific editors. Windows uses validated application
registration metadata, macOS uses known bundle identifiers, and Linux checks
known executable locations. A custom executable/argument integration remains
available when a supported editor is installed elsewhere.

Discovery checks registration/path metadata and never starts a candidate.
Duplicate editions stay distinguishable, missing executables are skipped, and
the selected value falls back with clear Preferences guidance. Launches do not
use a shell. Custom argument parsing, process output, and time are bounded.

Platform editor discovery, custom integration, and launch tests verify these
contracts. WSL editions are covered by
[WSL-aware editor opening](wsl-aware-editor-opening.md), and entry points by
[One-click editor actions](one-click-editor-actions.md).
