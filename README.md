# Dotfiles

macOS zsh config.

## Setup

```sh
mkdir -p ~/repos
git clone git@github.com:rensknoors/dotfiles.git ~/repos/dotfiles
cd ~/repos/dotfiles
./setup.sh
```

The script fetches plugins, backs up any existing `~/.zshrc` / `~/.zsh`, symlinks this repo in place, and installs Spaceship + nvm if Homebrew is present.

Re-run after `git pull` to sync plugins and repair links.

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
