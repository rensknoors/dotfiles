# Dotfiles

macOS zsh config. Paths are based on `$HOME` and Homebrew (`/opt/homebrew`), so this works for any macOS user.

Clone with plugins:

```sh
git clone --recurse-submodules git@github.com:rensknoors/dotfiles.git
```

If you already cloned without submodules:

```sh
git submodule update --init --recursive
```

## Symlink `.zshrc`

A symlink makes `~/.zshrc` point at this repo's file. Edits in the repo are picked up by every new shell; you still version-control one copy.

From the repo root:

```sh
ln -s "$(pwd)/.zshrc" ~/.zshrc
```

If `~/.zshrc` already exists, back it up first:

```sh
mv ~/.zshrc ~/.zshrc.bak
ln -s "$(pwd)/.zshrc" ~/.zshrc
```

To replace an existing file or symlink in one step:

```sh
ln -sf "$(pwd)/.zshrc" ~/.zshrc
```

`-s` creates a symlink, `-f` overwrites the destination if it already exists.

Confirm it worked:

```sh
ls -l ~/.zshrc
```

You should see `~/.zshrc -> /path/to/dotfiles/.zshrc`. Then reload:

```sh
source ~/.zshrc
```

## Symlink `.zsh`

Plugins live in this repo under `.zsh/plugins`. Point `~/.zsh` at that folder the same way:

```sh
ln -s "$(pwd)/.zsh" ~/.zsh
```

If `~/.zsh` already exists:

```sh
mv ~/.zsh ~/.zsh.bak
ln -s "$(pwd)/.zsh" ~/.zsh
```

Or replace it:

```sh
ln -sf "$(pwd)/.zsh" ~/.zsh
```

## Plugins

Most plugins are git submodules pointing at upstream. Pull the latest from each remote:

```sh
git submodule update --remote --merge
```

Then commit the updated submodule SHAs if you want to pin those versions.

| Plugin | Source |
| --- | --- |
| zsh-syntax-highlighting | [zsh-users/zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting) |
| zsh-autosuggestions | [zsh-users/zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) |
| zsh-completions | [zsh-users/zsh-completions](https://github.com/zsh-users/zsh-completions) |
| zsh-nx-completion | [jscutlery/nx-completion](https://github.com/jscutlery/nx-completion) |
| zsh-git | vendored from Oh My Zsh (`plugins/git`) |
| zsh-alias-finder | vendored from Oh My Zsh (`plugins/alias-finder`) |

Missing optional tools (nvm, Spaceship, bun, pnpm, etc.) are skipped, so a missing install will not break your shell.
