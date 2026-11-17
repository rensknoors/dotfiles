# Dotfiles

macOS zsh + Cursor config.

## Setup

```sh
mkdir -p ~/repos
git clone git@github.com:rensknoors/dotfiles.git ~/repos/dotfiles
cd ~/repos/dotfiles
./setup.sh
```

The script:

- fetches zsh plugins
- backs up existing `~/.zshrc` / `~/.zsh` / Cursor settings
- symlinks this repo in place
- installs Spaceship + nvm if Homebrew is present
- installs Cursor extensions from `cursor/extensions.txt`

Re-run after `git pull` to sync plugins, repair links, and install any new extensions.

## Cursor

`settings.json` and `keybindings.json` live in `cursor/` and are symlinked into `~/Library/Application Support/Cursor/User/`. Edits in Cursor write back to this repo — commit them.

Refresh the extension list after installing something new:

```sh
cursor --list-extensions | sort > cursor/extensions.txt
```

## Claude Code

`claude/hooks/branch-handover.sh` is symlinked to `~/.claude/hooks/` and registered (via `jq`) for `UserPromptSubmit`, `Stop` and `SessionEnd` in `~/.claude/settings.json`; other settings are left alone.

It applies to agent worktrees under `<repo>/.claude/worktrees/`: when the agent goes idle the worktree detaches and releases its branch, so you can check it out in the main folder. On a follow-up prompt the worktree takes the branch back. If the main folder has that branch checked out, it is detached at the same commit, keeping its files and uncommitted changes, so you can keep using git there. It blocks with a message instead of losing diverged work.

## Update plugins

```sh
git submodule update --remote --merge
```

Commit the updated submodule SHAs to pin those versions.

## Plugins

| Plugin | Source |
| --- | --- |
| zsh-syntax-highlighting | [zsh-users/zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting) |
| zsh-autosuggestions | [zsh-users/zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) |
| zsh-completions | [zsh-users/zsh-completions](https://github.com/zsh-users/zsh-completions) |
| zsh-nx-completion | [jscutlery/nx-completion](https://github.com/jscutlery/nx-completion) |
| zsh-git | vendored from Oh My Zsh (`plugins/git`) |
| zsh-alias-finder | vendored from Oh My Zsh (`plugins/alias-finder`) |
