#!/bin/bash

# Get the directory where this script is located
DOTFILES_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"

# Create symlinks
## Directories
ln -s "$DOTFILES_DIR/.agents" ~/.agents

## Files
ln -sf "$DOTFILES_DIR/.config/opencode/opencode-notifier.json" ~/.config/opencode/opencode-notifier.json
ln -sf "$DOTFILES_DIR/.config/opencode/opencode.json" ~/.config/opencode/opencode.json
ln -sf "$DOTFILES_DIR/.config/opencode/tui.json" ~/.config/opencode/tui.json
ln -sf "$DOTFILES_DIR/.config/zed/settings.json" ~/.config/zed/settings.json
ln -sf "$DOTFILES_DIR/.gitconfig" ~/.gitconfig
ln -sf "$DOTFILES_DIR/.gitignore" ~/.gitignore
ln -sf "$DOTFILES_DIR/.tmux.conf" ~/.tmux.conf
ln -sf "$DOTFILES_DIR/.zshrc" ~/.zshrc

echo "Dotfiles installed!"
