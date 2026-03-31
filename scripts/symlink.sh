#!/bin/bash

# Get the directory where this script is located
DOTFILES_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"

# Create symlinks
## Directories
ln -s "$DOTFILES_DIR/.agents" ~/
ln -s "$DOTFILES_DIR/.config/opencode" ~/.config

## Files
ln -sf "$DOTFILES_DIR/.config/zed/settings.json" ~/.config/zed/settings.json
ln -sf "$DOTFILES_DIR/.npmrc" ~/.npmrc
ln -sf "$DOTFILES_DIR/.gitconfig" ~/.gitconfig
ln -sf "$DOTFILES_DIR/.gitignore" ~/.gitignore
ln -sf "$DOTFILES_DIR/.tmux.conf" ~/.tmux.conf
ln -sf "$DOTFILES_DIR/.zshrc" ~/.zshrc

echo "Dotfiles installed!"
