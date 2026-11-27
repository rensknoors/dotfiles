#!/usr/bin/env zsh
set -euo pipefail

ROOT="${0:A:h}"

already_linked() {
  local src="$1" dest="$2" target
  [[ -L "$dest" ]] || return 1
  target="$(readlink "$dest")"
  [[ "${target:A}" == "${src:A}" ]]
}

link() {
  local src="$1" dest="$2"
  if already_linked "$src" "$dest"; then
    echo "    $dest already linked"
    return
  fi
  if [[ -e "$dest" || -L "$dest" ]]; then
    local bak="$dest.bak.$(date +%Y%m%d-%H%M%S)"
    mv "$dest" "$bak"
    echo "    backed up $dest -> $bak"
  fi
  ln -s "$src" "$dest"
  echo "    linked $dest -> $src"
}

echo "==> Plugins"
git -C "$ROOT" submodule update --init --recursive

echo "==> Symlinks"
link "$ROOT/.zshrc" "$HOME/.zshrc"
link "$ROOT/.zsh" "$HOME/.zsh"

CURSOR_USER="$HOME/Library/Application Support/Cursor/User"
echo "==> Cursor"
mkdir -p "$CURSOR_USER"
link "$ROOT/cursor/settings.json" "$CURSOR_USER/settings.json"
link "$ROOT/cursor/keybindings.json" "$CURSOR_USER/keybindings.json"

cursor_bin="$(command -v cursor 2>/dev/null || true)"
[[ -z "$cursor_bin" && -x /Applications/Cursor.app/Contents/Resources/app/bin/cursor ]] &&
  cursor_bin=/Applications/Cursor.app/Contents/Resources/app/bin/cursor

if [[ -n "$cursor_bin" ]]; then
  installed="$("$cursor_bin" --list-extensions 2>/dev/null || true)"
  while IFS= read -r ext; do
    [[ -z "$ext" || "$ext" == \#* ]] && continue
    if print -r -- "$installed" | grep -qx -- "$ext"; then
      echo "    $ext already installed"
    else
      echo "    installing $ext"
      "$cursor_bin" --install-extension "$ext" || echo "    failed to install $ext, skipped"
    fi
  done < "$ROOT/cursor/extensions.txt"
else
  echo "    cursor CLI not found, skipped extensions"
  echo "    install Cursor, or Command Palette → \"Shell Command: Install 'cursor' command in PATH\""
fi

echo "==> Claude Code"
mkdir -p "$HOME/.claude/hooks"
link "$ROOT/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
HANDOVER="$HOME/.claude/hooks/branch-handover.sh"
link "$ROOT/claude/hooks/branch-handover.sh" "$HANDOVER"
COLD_CACHE="$HOME/.claude/hooks/cold-cache.py"
link "$ROOT/claude/hooks/cold-cache.py" "$COLD_CACHE"
HERDR_LOCATION="$HOME/.claude/hooks/herdr-location.sh"
link "$ROOT/claude/hooks/herdr-location.sh" "$HERDR_LOCATION"

CLAUDE_SETTINGS="$HOME/.claude/settings.json"

# register_hook [--matcher <tools>] <command> <event>...: adds the command to each event once.
register_hook() {
  local matcher="" cmd tmp
  if [[ $1 == --matcher ]]; then matcher="$2"; shift 2; fi
  cmd="$1"
  shift
  tmp="$(mktemp)"
  jq --arg cmd "$cmd" --arg matcher "$matcher" --args '
    reduce $ARGS.positional[] as $e (.;
      if any(.hooks[$e][]?.hooks[]?; .command == $cmd) then .
      else .hooks[$e] += [{hooks: [{type: "command", command: $cmd}]}
        + (if $matcher == "" then {} else {matcher: $matcher} end)] end)
  ' "$@" < "$CLAUDE_SETTINGS" > "$tmp" && mv "$tmp" "$CLAUDE_SETTINGS"
  echo "    registered ${cmd:t} for $* in $CLAUDE_SETTINGS"
}

if command -v jq &>/dev/null; then
  [[ -f "$CLAUDE_SETTINGS" ]] || echo '{}' > "$CLAUDE_SETTINGS"
  register_hook "$HANDOVER" UserPromptSubmit Stop SessionEnd
  register_hook "$COLD_CACHE" UserPromptSubmit
  register_hook "$HERDR_LOCATION" SessionStart UserPromptSubmit Stop SessionEnd
  register_hook --matcher "EnterWorktree|ExitWorktree" "$HERDR_LOCATION" PostToolUse
else
  echo "    jq not found, skipped registering Claude hooks"
fi

echo "==> Herdr"
"$ROOT/herdr/sync.sh" install

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
  echo "==> Homebrew"
  export HOMEBREW_NO_AUTO_UPDATE=1
  for pkg in starship nvm skillshare; do
    if brew list --formula "$pkg" &>/dev/null; then
      echo "    $pkg already installed"
    else
      brew install "$pkg"
    fi
  done
else
  echo "==> Homebrew not found; skipped starship/nvm/skillshare"
  echo "    https://brew.sh then re-run $0"
fi

# Record the commit this machine's setup ran at; .zshrc warns when a pull changes what setup handles.
SETUP_STAMP="${XDG_STATE_HOME:-$HOME/.local/state}/dotfiles/setup-commit"
mkdir -p "${SETUP_STAMP:h}"
git -C "$ROOT" rev-parse HEAD > "$SETUP_STAMP"

echo
echo "Done. Reload with:  exec zsh"
