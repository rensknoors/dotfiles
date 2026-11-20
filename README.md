# Dotfiles

macOS zsh, Cursor, Claude Code and Herdr config.

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
- installs Spaceship, nvm and skillshare if Homebrew is present
- installs Cursor extensions from `cursor/extensions.txt`
- copies the Herdr setup into `~/.config/herdr-app` (see [Herdr](#herdr))

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

`claude/hooks/cold-cache.py` is symlinked and registered the same way, for `UserPromptSubmit`. When a session's prompt cache has expired (its TTL, 1h or 5m, is read from the transcript), it blocks the first prompt with a warning, because that prompt re-reads the whole context at full price. Sending again within 10 minutes goes through. Slash commands are never blocked.

`claude/hooks/herdr-location.sh` is symlinked and registered the same way, for `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` and `PostToolUse` (`EnterWorktree|ExitWorktree`). Claude Code enters a worktree without changing its process folder, so Herdr only sees the folder `claude` started in. The hook labels the agent's terminal with the session's current folder (`herdr.agent.cwd`), which the Herdr Spaces sidebar uses to show the agent under its branch. It does nothing outside a herdr-core terminal.

## Herdr

`herdr/` holds the [Herdr](https://herdr.dev) app's setup: `keys.json`, `settings.json`, the `my-main` layout, the `onyx-git` theme and my mods. Herdr applies a change the moment a file in its home (`~/.config/herdr-app`) changes, but it doesn't notice a change made through a symlink, so these are copies:

```sh
herdr/sync.sh sync      # both ways: save, commit herdr/, pull, install, push
herdr/sync.sh save      # Herdr → repo only
herdr/sync.sh install   # repo → Herdr only; setup.sh runs this
```

Edit in Herdr's home as usual, then run `sync` on that machine, and `sync` on the other machine to get the change. It saves and commits before it pulls, so git merges the two machines' changes; on a conflict it stops in the rebase: resolve it, `git rebase --continue`, and `sync` again. It pushes everything the branch has unpushed, not only the Herdr commit.

`save` copies what's yours: `keys.json`, `settings.json`, and the layouts, themes and mods Herdr doesn't ship (`installed.json` lists those). Herdr's type files in each mod (`gpui-kit.d.ts`, `jsconfig.json`) and hidden files are left out. What you delete in Herdr is deleted from the repo, and the next `install` on another machine removes it there too (keeping it in the backup folder below).

Neither direction overwrites the other's news. Each item is recorded at the last sync (`~/.local/state/dotfiles/herdr-synced`): `install` skips anything changed in Herdr since, telling you to `save` first, and `save` skips anything only the repo changed since (a pull), telling you to `install`. On a machine's first sync the repo's setup wins: items that differ are replaced and the old ones kept in `~/.config/herdr-app.bak.<time>/`. Switch to the layout with `cmd-shift-l`.

The skillshare panel (`mods/skillshare`) updates itself, so it isn't kept here: `install` fetches it from [runkids/skillshare](https://github.com/runkids/skillshare)'s latest release when it's missing.

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
