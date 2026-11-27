### ZSH HOME
export ZSH="$HOME/.zsh"
export ZSH_PLUGINS="$HOME/.zsh/plugins"

# Brew
[[ -x /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"

# Completion: set up once, from the cache; rebuild at most once a day.
# Must come before nvm, whose completion script otherwise runs a full compinit.
[[ -d "$ZSH_PLUGINS/zsh-completions/src" ]] && fpath=("$ZSH_PLUGINS/zsh-completions/src" $fpath)
autoload -Uz compinit bashcompinit
_zcd=(~/.zcompdump(N.mh+24))
if (( $#_zcd )); then compinit; else compinit -C; fi
unset _zcd
bashcompinit

# NVM: load without switching versions (slow); put the default Node on PATH directly
export NVM_DIR="$HOME/.nvm"
[[ -s "/opt/homebrew/opt/nvm/nvm.sh" ]] && . "/opt/homebrew/opt/nvm/nvm.sh" --no-use
_nvm_default=($NVM_DIR/versions/node/v24*(N/On))
(( $#_nvm_default )) && export PATH="$_nvm_default[1]/bin:$PATH"
unset _nvm_default
[[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ]] && . "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"

# Prompt
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

# Enable Starship (config: ~/.config/starship.toml, defaults if absent)
if [[ "$AGENT_MODE" != "true" ]] && (( $+commands[starship] )); then
  eval "$(starship init zsh)"
fi
# Fallback: Spaceship (slower to load). Swap with the block above to go back.
# if [[ "$AGENT_MODE" != "true" && -f /opt/homebrew/opt/spaceship/spaceship.zsh ]]; then
#   source /opt/homebrew/opt/spaceship/spaceship.zsh
# fi

# Set Oh My Zsh theme conditionally - disable for agents only
if [[ "$AGENT_MODE" == "true" ]]; then
  ZSH_THEME=""
fi

# Start SSH agent (reuse existing session)
if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
  eval "$(ssh-agent -s)" >/dev/null
fi

# Aliases
unalias gdel 2>/dev/null
gdel() {
  git fetch origin main
  local current
  current=$(git branch --show-current)
  git branch --format='%(refname:short)' | while read -r branch; do
    case $branch in
      main|master|dev|"$current") continue ;;
    esac
    if git merge-base --is-ancestor "$branch" origin/main; then
      git branch -D "$branch"
      continue
    fi
    local merged tip
    merged=$(git log origin/main -1 --fixed-strings --grep="Merged in ${branch} (" --format='%ct')
    [[ -z $merged ]] && continue
    tip=$(git log -1 --format='%ct' "$branch")
    (( tip > merged )) && continue
    git branch -D "$branch"
  done
}

# Plugins
_source_if_exists() { [[ -f "$1" ]] && source "$1"; }

_source_if_exists "$ZSH_PLUGINS/zsh-syntax-highlighting/zsh-syntax-highlighting.plugin.zsh"
_source_if_exists "$ZSH_PLUGINS/zsh-autosuggestions/zsh-autosuggestions.plugin.zsh"
_source_if_exists "$ZSH_PLUGINS/zsh-git/zsh-git.zsh"
_source_if_exists "$ZSH_PLUGINS/zsh-alias-finder/zsh-alias-finder.zsh"
_source_if_exists "$ZSH_PLUGINS/zsh-nx-completion/nx-completion.plugin.zsh"
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

# Vite+
. "$HOME/.config/vite-plus/env"

# Azure CLI completion
[[ -f "$HOMEBREW_PREFIX/etc/bash_completion.d/az" ]] && source "$HOMEBREW_PREFIX/etc/bash_completion.d/az"

# Warn when a pull changed what setup.sh handles since it last ran here. setup.sh records the
# commit it ran at; the repo's HEAD is read from .git directly, so git only runs after a pull.
# What counts: setup.sh, .gitmodules, cursor/extensions.txt and plugin (submodule) versions.
# Everything else is symlinked into place, so a pull alone updates it.
if [[ "$AGENT_MODE" != "true" ]]; then
  () {
    local repo=${${(%):-%x}:A:h}
    local stamp=${XDG_STATE_HOME:-$HOME/.local/state}/dotfiles/setup-commit
    local run="Run: ${repo/#$HOME/~}/setup.sh"
    local head ran line
    local -a raw changed
    [[ -r $repo/.git/HEAD ]] || return 0
    read -r head < $repo/.git/HEAD
    if [[ $head == "ref: "* ]]; then
      if [[ -r $repo/.git/${head#ref: } ]]; then read -r head < $repo/.git/${head#ref: }
      else head=$(git -C $repo rev-parse -q --verify HEAD) || return 0
      fi
    fi
    if [[ ! -r $stamp ]]; then
      print -P "%F{yellow}dotfiles:%f setup.sh hasn't recorded a run on this machine. $run"
      return 0
    fi
    read -r ran < $stamp
    [[ $ran == $head ]] && return 0
    raw=(${(f)"$(git -C $repo diff --raw $ran $head -- setup.sh .gitmodules cursor/extensions.txt .zsh/plugins 2>/dev/null)"}) || {
      print -P "%F{yellow}dotfiles:%f can't tell what changed since setup.sh last ran here. $run"
      return 0
    }
    for line in $raw; do
      # Under .zsh/plugins only submodule pointers (mode 160000) need setup; plain files are symlinked.
      [[ ${line#*$'\t'} == .zsh/plugins/* && $line != :160000* && $line != ":"<->" 160000"* ]] && continue
      changed+=(${line#*$'\t'})
    done
    if (( $#changed )); then
      print -P "%F{yellow}dotfiles:%f a pull changed ${(j:, :)changed}. $run"
    else
      print -r -- $head > $stamp
    fi
  }
fi
