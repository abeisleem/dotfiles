# My Dotfiles

## Installation

```bash
git clone https://github.com/abeisleem/dotfiles.git ~/repos/dotfiles
cd ~/repos/dotfiles
chmod +x install.sh
./install.sh
```

`install.sh` will:
1. Install Homebrew (if needed) and all packages from `Brewfile`
2. Create symlinks for all dotfiles

## Local Configuration

Copy the example file and add your secrets:

```bash
cp .zshrc.local.example ~/.zshrc.local
# Edit ~/.zshrc.local with your actual values
```

This file is automatically sourced by `.zshrc` if it exists and is **never tracked by git**.

## OpenCode V1 and V2

OpenCode V1 and V2 currently run side by side because their native configuration formats are incompatible:

- `.config/opencode/` contains the native V2 configuration used by `opencode2`.
- `.config/opencode-v1/opencode/` is a pre-V2 snapshot used only by V1.
- The `opencode` shell function in `.zshrc` sets a V1-specific `XDG_CONFIG_HOME`, while `opencode2` uses the normal config directory.
- `scripts/symlink.sh` installs both configuration directories.

When V1 is no longer needed, remove `.config/opencode-v1/`, its symlink entry from `scripts/symlink.sh`, and the `opencode` wrapper from `.zshrc`. Then remove or repoint the `oc` alias to `opencode2`, delete the live `~/.config/opencode-v1` symlink, and optionally uninstall the V1 binary. Do not merge the V1 files back into the V2 configuration.

## Directory Structure

```
dotfiles/
├── README.md
├── install.sh              # Main installer (runs brew-install.sh + symlink.sh)
├── Brewfile                # Homebrew packages
├── .gitignore
├── .zshrc
├── .zshrc.local.example    # Template for secrets
├── .gitconfig
├── .gitignore
├── .tmux.conf
├── .agents/
│   └── skills/              # Skills installed from the `skills` npm CLI package
├── .config/
│   ├── opencode/             # Native OpenCode V2 configuration
│   │   ├── commands/        # Custom OpenCode commands
│   │   └── skills/          # Custom handwritten OpenCode skills
│   └── opencode-v1/          # Isolated legacy OpenCode V1 configuration
└── scripts/
    ├── brew-install.sh     # Installs Homebrew + packages
    └── symlink.sh          # Creates symlinks

~
├── .zshrc -> dotfiles/.zshrc
├── .gitconfig -> dotfiles/.gitconfig
├── .tmux.conf -> dotfiles/.tmux.conf
├── .config/
│   ├── opencode/
│   │   ├── opencode.json -> dotfiles/.config/opencode/opencode.json
│   │   ├── opencode-notifier.json -> dotfiles/.config/opencode/opencode-notifier.json
│   │   ├── commands/ -> dotfiles/.config/opencode/commands/
│   │   └── skills/ -> dotfiles/.config/opencode/skills/
│   ├── opencode-v1/ -> dotfiles/.config/opencode-v1/
│   └── zed/
│       └── settings.json -> dotfiles/.config/zed/settings.json
├── .agents/
│   └── skills/ -> dotfiles/.agents/skills/
└── .zshrc.local            # Secrets (not in git)
```

## What's Included

- `.zshrc` - Zsh configuration with Oh My Zsh, fnm, and custom functions
- `.gitconfig` - Git settings
- `.tmux.conf` - Tmux configuration
- `.config/` - App configurations (opencode, zed)
- `.agents/skills/` - Skills installed from the `skills` npm command-line package
- `.config/opencode/skills/` - Custom handwritten OpenCode skills
- `.config/opencode/commands/` - Custom OpenCode slash commands
