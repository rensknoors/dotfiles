# Personal instructions

## Worktrees

- A worktree lives under `<repo>/.claude/worktrees/<name>`, never next to the repository. The `branch-handover.sh` hook only hands a branch back to the main folder for worktrees there; elsewhere the branch stays locked.
- Create one with `EnterWorktree` (`name`), so the session runs inside it. To branch off something other than the default branch, run `git worktree add .claude/worktrees/<name> -b <branch> <base>` and then `EnterWorktree` with `path`.
- Run the work from the worktree as the session's directory, not through absolute paths from the main folder: the hooks read the session's directory.

## Herdr

- For anything about Herdr (the `herdr-app` window, `hc`/herdr-core, its layouts, keys or mods), read `~/.config/herdr-app/AGENTS.md` first.
- When a change to `~/.config/herdr-app` is finished (a mod passes `herdr-app check`), run `~/repos/dotfiles/herdr/sync.sh sync`. It commits and pushes the change in the dotfiles repo so my other laptop gets it; that's wanted. Report any `left`, `kept` or `skipped` line it prints, or a pull it stopped, to me.
