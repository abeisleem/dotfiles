# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH

# Path to your Oh My Zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time Oh My Zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
ZSH_THEME="pmcgee"

# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in $ZSH/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment one of the following lines to change the auto-update behavior
# zstyle ':omz:update' mode disabled  # disable automatic updates
# zstyle ':omz:update' mode auto      # update automatically without asking
# zstyle ':omz:update' mode reminder  # just remind me to update when it's time

# Uncomment the following line to change how often to auto-update (in days).
# zstyle ':omz:update' frequency 13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# You can also set it to another string to have that shown instead of the default red dots.
# e.g. COMPLETION_WAITING_DOTS="%F{yellow}waiting...%f"
# Caution: this setting can cause issues with multiline prompts in zsh < 5.7.1 (see #5765)
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Plugins
# zsh-syntax-highlighting should be added at the end of the list
plugins=(git zsh-autosuggestions zsh-syntax-highlighting)

source $ZSH/oh-my-zsh.sh

# User configuration

# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='nvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch $(uname -m)"

# Set personal aliases, overriding those provided by Oh My Zsh libs,
# plugins, and themes. Aliases can be placed here, though Oh My Zsh
# users are encouraged to define aliases within a top-level file in
# the $ZSH_CUSTOM folder, with .zsh extension. Examples:
# - $ZSH_CUSTOM/aliases.zsh
# - $ZSH_CUSTOM/macos.zsh
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="cursor ~/.zshrc"
# alias ohmyzsh="cursor ~/.oh-my-zsh"

# Add this line to source secrets if they exist:
if [[ -f ~/.zshrc.local ]]; then
    source ~/.zshrc.local
fi

# https://github.com/Schniz/fnm#zsh
eval "$(fnm env --use-on-cd --resolve-engines --shell  zsh)"

function mkcdir ()
{
    mkdir -p -- "$1" &&
      cd -P -- "$1"
}

# https://twitter.com/wesbos/status/601426471240998912
function t() {
 tree -I '.git|node_modules|bower_components|.DS_Store' --dirsfirst --filelimit 15 -L ${1:-3} -aC $2
}

################################################################
# https://github.com/pmarreck/dotfiles/blob/master/bin/functions/please.bash
# obligatory AI stuff
# must brew install gum as well
################################################################

# graceful dependency enforcement
# Usage: needs <executable> [provided by <packagename>]
# only redefines it here if it's not already defined
# >/dev/null declare -F needs || \
needs() {
  [ -v EDIT ] && unset EDIT && edit_function "${FUNCNAME[0]}" "$BASH_SOURCE" && return
  local bin=$1
  shift
  command -v "$bin" >/dev/null 2>&1 || { echo >&2 "I require $bin but it's not installed or in PATH; $*"; return 1; }
}

platform() {
  [ -v EDIT ] && unset EDIT && edit_function "${FUNCNAME[0]}" "$BASH_SOURCE" && return
  local unameOut
  local machine
  unameOut="$(uname -s)"
  case "${unameOut}" in
    Linux*)     machine=Linux;;
    Darwin*)    machine=macOS;;
    CYGWIN*)    machine=Cygwin;;
    MINGW*)     machine=MinGW;;
    *)          machine="${unameOut}"
  esac
  printf "%s" "$machine"
}

_generate_curl_api_request_for_please() {
  [ -v EDIT ] && unset EDIT && edit_function "${FUNCNAME[0]}" "$BASH_SOURCE" && return
  needs jq
  local request args timeout model curl
  curl=${CURL:-curl}
  model=${OPENAI_MODEL:-gpt-4-1106-preview} # other options: gpt-4, gpt-4-0314, gpt-4-32k, gpt-4-32k-0314, gpt-3.5-turbo, gpt-3.5-turbo-0301
  timeout=${OPENAI_TIMEOUT:-30}
  args="$@"
  args=$(printf "%b" "$args" | sed "s/'/'\\\\''/g") # This is just a narsty sed to escape single quotes.
  # (Piping to "jq -sRr '@json'" was not working correctly, so I had to take control of the escaping myself.)
# printf "escaped args: %b\n" "$args" >&2
  # note that gpt-3.5-turbo-0301 is the very latest model as of 2021-03-01 but will only be supported for a few weeks
  read -r -d '' request <<EOF
  $curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --silent \
  --max-time $timeout \
  -d '{"model": "$model", "messages": [{"role": "user", "content": "$args"}], "temperature": 0.7}'
EOF
  printf "%b" "$request"
}

# you can also try https://x.com/pbbakkum/status/1847033065195139583
please() {
  [ -v EDIT ] && unset EDIT && edit_function "${FUNCNAME[0]}" "$BASH_SOURCE" && return
  needs curl
  needs jq
  needs gum from https://github.com/charmbracelet/gum
  local request response response_parsed response_parsed_cleaned args
  local plat=$(platform)
  request=$(_generate_curl_api_request_for_please "What is the $plat bash command to $@? Only return the command to run itself, do not describe anything. Only use commands and executables that are common on most $plat systems. Do not quote the response and do not use markdown.")
# printf "request: %s\n" "$request" >&2 
  response=$(eval "gum spin --show-output -s line --title \"Figuring out how to do this...\" -- $request")
# printf "response: %s\n" "$response" >&2
  response_parsed=$(printf "%s" "$response" | jq --raw-output '.choices[0].message.content')
# printf "response_parsed: %s\n" "$response_parsed" >&2
  if [[ "$response_parsed" == "null" || "$?" != "0" ]]; then
    printf "Error:\n" >&2
    printf "%b\n" "$response" >&2
    printf "%b\n" "$response_parsed"
  else
    response_parsed_cleaned=$(printf "%s" "$response_parsed" | sed -e 's/^[\\n]\+//' -e 's/^[\n]\+//')
    if gum confirm --affirmative="Run it" --negative="GTFO" "$response_parsed_cleaned"; then
      printf "\e[0;33m%s\n\e[m" "$response_parsed_cleaned" >&2
      printf "%s" "$response_parsed_cleaned" | bash
    else
      printf "%s" "Aborted."
      return 1
    fi
  fi
}
