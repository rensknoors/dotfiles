#!/usr/bin/env zsh
# Copies the Herdr setup between this folder and Herdr's home (~/.config/herdr-app).
#
#   sync.sh sync      Both ways with your other machines: save, commit herdr/, pull, install, push.
#   sync.sh save      Herdr → repo. Run before committing.
#   sync.sh install   repo → Herdr. setup.sh runs this.
#
# Copies, not symlinks: Herdr reloads a layout, key or mod when a file changes inside its home,
# and doesn't notice a change made through a symlink.
#
# Yours, and so kept here: keys.json, settings.json, and the layouts, themes and mods Herdr
# doesn't ship (installed.json lists the shipped ones). Each layout, theme or mod is one item.
# Mods in EXTERNAL update themselves; install fetches them instead.
#
# Neither side overwrites the other's news. Each item is remembered as it was at the last sync:
# install leaves an item alone when it has changed in Herdr since then (save first), and save leaves
# one alone when only the repo has changed it (a pull; install first). Deletions travel the same way.
# On a machine's first sync install replaces an item that differs and keeps the old one in
# ~/.config/herdr-app.bak.<time>/.
set -euo pipefail

REPO="${0:A:h}"
LIVE="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/dotfiles/herdr-synced"
SHIPPED_THEMES=(atom-one-dark win98) # installed.json doesn't list themes
EXTERNAL=(skillshare)
# Not copied: the type files Herdr writes into every mod, hidden files (the skillshare panel keeps
# its update backups in .bak-update-*), installed packages.
SKIP=(gpui-kit.d.ts jsconfig.json '.*' node_modules)

SHIPPED_MODS=() SHIPPED_LAYOUTS=() KNOWS_SHIPPED=0
if [[ -f $LIVE/installed.json ]] && (( $+commands[jq] )); then
  KNOWS_SHIPPED=1
  for k in ${(f)"$(jq -r 'keys[]' "$LIVE/installed.json")"}; do
    if [[ $k == layout:* ]]; then SHIPPED_LAYOUTS+=(${k#layout:}); else SHIPPED_MODS+=($k); fi
  done
fi

# units <root>: the items under <root> that are yours, one per line.
units() {
  local root=$1 f name
  for f in keys.json settings.json; do
    if [[ -f $root/$f ]]; then print -r -- $f; fi
  done
  for f in $root/layouts/*.(json|svg|png)(N.); do
    name=${${f:t}:r}
    if (( ! ${SHIPPED_LAYOUTS[(Ie)$name]} )); then print -r -- layouts/${f:t}; fi
  done
  for f in $root/themes/*.json(N.); do
    name=${${f:t}:r}
    if (( ! ${SHIPPED_THEMES[(Ie)$name]} )); then print -r -- themes/${f:t}; fi
  done
  for f in $root/mods/*(N/); do
    name=${f:t}
    if (( ! ${SHIPPED_MODS[(Ie)$name]} && ! ${EXTERNAL[(Ie)$name]} )); then print -r -- mods/$name; fi
  done
}

# fingerprint <root> <unit>: a hash of the item's content, empty when it doesn't exist.
fingerprint() {
  local p=$1/$2 s
  local -a skip=()
  if [[ -d $p ]]; then
    for s in $SKIP; do skip+=(-o -name $s); done
    (cd $p && find . -mindepth 1 \( ${skip[2,-1]} \) -prune -o -type f -print0 | sort -z | xargs -0 shasum) |
      shasum | cut -d' ' -f1
  elif [[ -f $p ]]; then
    shasum < $p | cut -d' ' -f1
  fi
}

# copy <from root> <to root> <unit>
copy() {
  local from=$1/$3 to=$2/$3
  mkdir -p ${to:h}
  if [[ -d $from ]]; then
    rsync -a --delete ${SKIP/#/--exclude=} $from/ $to/
  else
    cp -p $from $to
  fi
}

typeset -A synced
if [[ -f $STATE ]]; then
  while IFS=$'\t' read -r u h; do synced[$u]=$h; done < $STATE
fi

write_state() {
  mkdir -p ${STATE:h}
  local u
  for u in ${(k)synced}; do print -r -- "$u"$'\t'"${synced[$u]}"; done | sort > $STATE
}

save_all() {
  if (( ! KNOWS_SHIPPED )); then
    echo "    can't tell your files from Herdr's: needs jq and $LIVE/installed.json (open Herdr once)" >&2
    exit 1
  fi
  local u l r s
  local -a live=(${(f)"$(units $LIVE)"})
  for u in $live; do
    l=$(fingerprint $LIVE $u) r=$(fingerprint $REPO $u) s=${synced[$u]:-}
    if [[ $l == "$r" ]]; then
      synced[$u]=$l
      continue
    elif [[ -n $s && $l == "$s" ]]; then
      # Unchanged in Herdr since the last sync, changed in the repo: a pull brought a newer one.
      if [[ -z $r ]]; then
        echo "    left $u: deleted in the repo; run herdr/sync.sh install"
      else
        echo "    left $u: the repo's is newer; run herdr/sync.sh install"
      fi
      continue
    fi
    copy $LIVE $REPO $u
    if [[ -n $s && -n $r && $r != "$s" ]]; then
      echo "    saved $u over a newer one in the repo; git diff herdr/$u shows what to merge"
    else
      echo "    saved $u"
    fi
    synced[$u]=$l
  done
  for u in ${(f)"$(units $REPO)"}; do
    if (( ${live[(Ie)$u]} )); then continue; fi
    s=${synced[$u]:-}
    if [[ -n $s && $(fingerprint $REPO $u) == "$s" ]]; then
      rm -rf $REPO/$u
      unset "synced[$u]"
      echo "    removed $u (deleted in Herdr)"
    elif [[ -n $s ]]; then
      echo "    left $u: deleted in Herdr but changed in the repo; run herdr/sync.sh install to get it back, or delete herdr/$u"
    else
      echo "    left $u: not in Herdr yet; run herdr/sync.sh install"
    fi
  done
  write_state
}

install_all() {
  local u r l s backup="$LIVE.bak.$(date +%Y%m%d-%H%M%S)"
  local -a repo=(${(f)"$(units $REPO)"})
  mkdir -p $LIVE
  for u in $repo; do
    r=$(fingerprint $REPO $u) l=$(fingerprint $LIVE $u) s=${synced[$u]:-}
    if [[ $l == "$r" ]]; then
      synced[$u]=$r
      continue
    elif [[ -z $l ]]; then
      copy $REPO $LIVE $u
      echo "    installed $u"
    elif [[ $l == "$s" ]]; then
      copy $REPO $LIVE $u
      echo "    updated $u"
    elif [[ -z $s ]]; then
      mkdir -p $backup/${u:h}
      cp -Rp $LIVE/$u $backup/$u
      copy $REPO $LIVE $u
      echo "    replaced $u, yours is in $backup/$u"
    elif [[ $r == "$s" ]]; then
      echo "    kept $u: changed in Herdr since the last sync; run herdr/sync.sh save to keep it"
      continue
    else
      echo "    skipped $u: changed in Herdr and in the repo; run herdr/sync.sh save, merge with git, then install"
      continue
    fi
    synced[$u]=$r
  done
  if (( KNOWS_SHIPPED )); then
    for u in ${(f)"$(units $LIVE)"}; do
      if (( ${repo[(Ie)$u]} )); then continue; fi
      s=${synced[$u]:-}
      if [[ -z $s ]]; then
        echo "    $u is only in Herdr; run herdr/sync.sh save to add it"
      elif [[ $(fingerprint $LIVE $u) == "$s" ]]; then
        # Deleted in the repo (on another machine) and untouched here since the last sync.
        mkdir -p $backup/${u:h}
        mv $LIVE/$u $backup/$u
        unset "synced[$u]"
        echo "    removed $u (deleted in the repo), it's in $backup/$u"
      else
        echo "    kept $u: deleted in the repo but changed in Herdr; run herdr/sync.sh save to keep it"
      fi
    done
  fi
  write_state
  if [[ ! -d $LIVE/mods/skillshare ]]; then fetch_skillshare; fi
}

# The skillshare panel (github.com/runkids/skillshare), from its latest release, fetched the way the
# panel updates itself. It needs the skillshare CLI.
fetch_skillshare() {
  local repo=https://github.com/runkids/skillshare src=herdr/skillshare/mods/skillshare tmp url
  tmp=$(mktemp -d)
  if url=$(curl -fsSLI --max-time 15 -o /dev/null -w '%{url_effective}' $repo/releases/latest) &&
    GIT_TERMINAL_PROMPT=0 git -c advice.detachedHead=false clone -q --depth 1 --filter=blob:none \
      --sparse --branch ${url##*/} $repo.git $tmp/repo &&
    git -C $tmp/repo sparse-checkout set $src &&
    [[ -f $tmp/repo/$src/main.js ]]; then
    mkdir -p $LIVE/mods
    cp -R $tmp/repo/$src $LIVE/mods/skillshare
    echo "    installed mods/skillshare ${url##*/}"
  else
    echo "    could not fetch the skillshare panel, skipped"
  fi
  rm -rf $tmp
}

# Both ways with the other machines, in the one safe order: save and commit what changed here
# before pulling, so git merges the two machines' changes, then install what came in and push.
# A machine's first sync only pulls and installs: the repo's setup wins, as with install.
sync_all() {
  local upstream
  local -a g=(git -C $REPO)
  $g symbolic-ref --quiet HEAD >/dev/null || {
    echo "    the repo isn't on a branch (rebase in progress?); finish that, then sync again" >&2
    exit 1
  }
  if [[ -f $STATE ]]; then
    save_all
    $g add -A -- .
    if ! $g diff --cached --quiet -- .; then
      $g commit --quiet -m "chore(herdr): sync from ${HOST%%.*}" -- .
      echo "    committed"
    fi
  else
    echo "    first sync on this machine: taking the repo's setup"
  fi
  if upstream=$($g rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
    $g pull --quiet --rebase --autostash || {
      echo "    pull stopped; resolve it (git status, then git rebase --continue) and sync again" >&2
      exit 1
    }
  else
    echo "    no upstream branch, skipped pull and push"
  fi
  install_all
  if [[ -n $upstream ]] && (( $($g rev-list --count '@{u}..HEAD') )); then
    $g push --quiet && echo "    pushed to $upstream"
  fi
}

case "${1:-}" in
  save) save_all ;;
  install) install_all ;;
  sync) sync_all ;;
  *)
    echo "usage: herdr/sync.sh save | install | sync" >&2
    exit 2
    ;;
esac
