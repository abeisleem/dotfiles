# My Dotfiles

## Installation

```bash
git clone https://github.com/abeisleem/dotfiles.git ~/repos/dotfiles
cd ~/repos/dotfiles
chmod +x install.sh
./install.sh
```

## Local Configuration

Create `~/.zshrc.local` for machine-specific settings and secrets:

```bash
export GITHUB_TOKEN="your_token"
export API_KEY="your_key"
export WORK_SPECIFIC_VAR="your_value"
```

This file is automatically sourced by `.zshrc` if it exists and is **never tracked by git**.

## What's Included

- `.zshrc` - Zsh configuration with Oh My Zsh setup
- `.gitconfig` - Git settings with user info and preferences  
- `.gitignore` - Global git ignore patterns
- `install.sh` - Automated installation script that creates symlinks

## Directory Structure

```
~/repos/dotfiles/
├── README.md          # This file
├── install.sh         # Installation script
├── .gitignore        # Patterns for files to ignore
├── .zshrc            # Zsh shell configuration
└── .gitconfig        # Git configuration

~/
├── .zshrc -> ~/repos/dotfiles/.zshrc
├── .gitconfig -> ~/repos/dotfiles/.gitconfig
├── .gitignore -> ~/repos/dotfiles/.gitignore
└── .zshrc.local      # Secrets (not in git)
```