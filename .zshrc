### ZSH HOME
export ZSH=$HOME/.zsh
export ZSH_THEMES=$HOME/.zsh/themes
export ZSH_PLUGINS=$HOME/.zsh/plugins

# Brew
export PATH="/opt/homebrew/bin:$PATH"

# NVM
export NVM_DIR="$HOME/.nvm"
  [ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"  # This loads nvm
  [ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"  # This loads nvm bash_completion

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
if [[ "$AGENT_MODE" != "true" ]]; then
  source "/opt/homebrew/opt/spaceship/spaceship.zsh"
fi

# Set Oh My Zsh theme conditionally - disable for agents only
if [[ "$AGENT_MODE" == "true" ]]; then
  ZSH_THEME=""
fi

# Start SSH agent
eval $(ssh-agent)

# Aliases
alias gdel="git branch --merged | egrep -v '(^\*|master|main|dev)' | xargs git branch -d"

# Plugins
source $ZSH_PLUGINS/zsh-syntax-highlighting/zsh-syntax-highlighting.plugin.zsh
source $ZSH_PLUGINS/zsh-autosuggestions/zsh-autosuggestions.plugin.zsh
fpath=($ZSH_PLUGINS/zsh-completions/src $fpath)
source $ZSH_PLUGINS/zsh-git/zsh-git.zsh
source $ZSH_PLUGINS/zsh-alias-finder/zsh-alias-finder.zsh
source $ZSH_PLUGINS/zsh-nx-completion/nx-completion.plugin.zsh

# Bun
export PATH="/Users/rensknoors/.bun/bin:$PATH"

# Created by `pipx` on 2025-02-21 15:24:13
export PATH="$PATH:/Users/rensknoors/.local/bin"

# pnpm
export PNPM_HOME="/Users/rensknoors/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end

# Added by Antigravity
export PATH="/Users/rensknoors/.antigravity/antigravity/bin:$PATH"
