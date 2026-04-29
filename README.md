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
│   └── opencode/
│       ├── commands/        # Custom OpenCode commands
│       └── skills/          # Custom handwritten OpenCode skills
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
