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
      "$cursor_bin" --install-extension "$ext"
    fi
  done < "$ROOT/cursor/extensions.txt"
else
  echo "    cursor CLI not found, skipped extensions"
  echo "    install Cursor, or Command Palette → \"Shell Command: Install 'cursor' command in PATH\""
fi

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
  echo "==> Homebrew"
  export HOMEBREW_NO_AUTO_UPDATE=1
  for pkg in spaceship nvm; do
    if brew list --formula "$pkg" &>/dev/null; then
      echo "    $pkg already installed"
    else
      brew install "$pkg"
    fi
  done
else
  echo "==> Homebrew not found; skipped spaceship/nvm"
  echo "    https://brew.sh then re-run $0"
fi

echo
echo "Done. Reload with:  exec zsh"
