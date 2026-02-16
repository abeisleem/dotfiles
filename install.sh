#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/scripts"

"$SCRIPT_DIR/brew-install.sh"
"$SCRIPT_DIR/symlink.sh"

echo "All done!"
