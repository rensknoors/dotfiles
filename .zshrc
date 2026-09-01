### ZSH HOME
export ZSH="$HOME/.zsh"
export ZSH_PLUGINS="$HOME/.zsh/plugins"

# Brew
[[ -x /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"

# NVM
export NVM_DIR="$HOME/.nvm"
[[ -s "/opt/homebrew/opt/nvm/nvm.sh" ]] && . "/opt/homebrew/opt/nvm/nvm.sh"
[[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ]] && . "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"

# Spaceship
# Agent detection - only activate minimal mode for actual agents
if [[ -n "$npm_config_yes" ]] || [[ -n "$CI" ]] || [[ "$-" != *i* ]]; then
  export AGENT_MODE=true
else
  export AGENT_MODE=false
fi

if [[ "$AGENT_MODE" == "true" ]]; then
  # Ensure non-interactive mode
  export DEBIAN_FRONTEND=noninteractive
  export NONINTERACTIVE=1
fi

# Enable Spaceship
if [[ "$AGENT_MODE" != "true" && -f /opt/homebrew/opt/spaceship/spaceship.zsh ]]; then
  source /opt/homebrew/opt/spaceship/spaceship.zsh
fi

# Set Oh My Zsh theme conditionally - disable for agents only
if [[ "$AGENT_MODE" == "true" ]]; then
  ZSH_THEME=""
fi

# Start SSH agent (reuse existing session)
if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
  eval "$(ssh-agent -s)" >/dev/null
fi

# Aliases
alias gdel="git branch --merged | egrep -v '(^\*|master|main|dev)' | xargs git branch -d"

# Plugins
_source_if_exists() { [[ -f "$1" ]] && source "$1"; }

_source_if_exists "$ZSH_PLUGINS/zsh-syntax-highlighting/zsh-syntax-highlighting.plugin.zsh"
_source_if_exists "$ZSH_PLUGINS/zsh-autosuggestions/zsh-autosuggestions.plugin.zsh"
_source_if_exists "$ZSH_PLUGINS/zsh-git/zsh-git.zsh"
_source_if_exists "$ZSH_PLUGINS/zsh-alias-finder/zsh-alias-finder.zsh"
_source_if_exists "$ZSH_PLUGINS/zsh-nx-completion/nx-completion.plugin.zsh"
[[ -d "$ZSH_PLUGINS/zsh-completions/src" ]] && fpath=("$ZSH_PLUGINS/zsh-completions/src" $fpath)
unfunction _source_if_exists

# Optional PATH entries (skipped if not installed)
[[ -d "$HOME/.bun/bin" ]] && export PATH="$HOME/.bun/bin:$PATH"
[[ -d "$HOME/.local/bin" ]] && export PATH="$PATH:$HOME/.local/bin"

# pnpm
export PNPM_HOME="$HOME/Library/pnpm"
if [[ -d "$PNPM_HOME" ]]; then
  case ":$PATH:" in
    *":$PNPM_HOME:"*) ;;
    *) export PATH="$PNPM_HOME:$PATH" ;;
  esac
fi

[[ -d "$HOME/.antigravity/antigravity/bin" ]] && export PATH="$HOME/.antigravity/antigravity/bin:$PATH"
