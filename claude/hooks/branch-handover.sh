#!/bin/bash
# Claude Code hook: a worktree under .claude/worktrees/ holds its branch only
# while its agent is working, so the branch can be checked out in the main
# folder whenever the agent is idle.
#   Stop, SessionEnd   -> detach the worktree, releasing the branch
#   UserPromptSubmit   -> take the branch back; if the main folder has it checked
#                         out, detach the main folder in place (files untouched)
set -u

input=$(cat)
event=$(jq -r '.hook_event_name // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
[ -n "$cwd" ] || exit 0

worktree=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
git_dir=$(git -C "$worktree" rev-parse --absolute-git-dir)
common_dir=$(cd "$worktree" && cd "$(git rev-parse --git-common-dir)" && pwd -P)
main_folder=$(dirname "$common_dir")

case "$(cd "$worktree" && pwd -P)" in
  "$main_folder/.claude/worktrees/"*) ;;
  *) exit 0 ;;
esac

state_file="$git_dir/handover-branch"

# Serialize runs on this worktree: if the hook is registered twice (global and
# project settings), Claude Code starts both at once and they would race to
# switch branches. A second run waits here, then finds the work already done.
lock_dir="$git_dir/handover.lock"
for _ in $(seq 1 100); do
  mkdir "$lock_dir" 2>/dev/null && break
  # A lock older than a minute was left by a killed run; take it over.
  if [ -n "$(find "$lock_dir" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
    rmdir "$lock_dir" 2>/dev/null
    continue
  fi
  sleep 0.1
done
trap 'rmdir "$lock_dir" 2>/dev/null' EXIT

block() {
  echo "branch-handover: $1" >&2
  [ -n "${git_err:-}" ] && printf 'git said: %s\n' "$git_err" >&2
  exit 2
}

# Runs git, retrying while another git process (an editor, a status bar, a
# sidebar) briefly holds index.lock or a ref lock. The last error is left in
# $git_err.
git_retry() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if git_err=$(git "$@" 2>&1 >/dev/null); then
      git_err=
      return 0
    fi
    case "$git_err" in
      *".lock"*"File exists"* | *"Unable to create"*".lock"* | *"cannot lock ref"*) sleep 0.2 ;;
      *) return 1 ;;
    esac
  done
  return 1
}

release() {
  local branch
  branch=$(git -C "$worktree" symbolic-ref --quiet --short HEAD) || exit 0
  git_retry -C "$worktree" switch --quiet --detach || exit 0
  echo "$branch" >"$state_file"
}

reclaim() {
  [ -f "$state_file" ] || exit 0
  local branch detached_head holder
  branch=$(cat "$state_file")

  if git -C "$worktree" symbolic-ref --quiet HEAD >/dev/null; then
    rm -f "$state_file"
    exit 0
  fi

  detached_head=$(git -C "$worktree" rev-parse HEAD)
  # Commits made while detached are reachable from no branch; refuse to leave them behind.
  if ! git -C "$worktree" merge-base --is-ancestor "$detached_head" "$branch" &&
    ! git -C "$worktree" merge-base --is-ancestor "$branch" "$detached_head"; then
    block "this worktree has commits made while detached ($detached_head) that diverge from $branch. Merge or cherry-pick them onto $branch by hand, then prompt again."
  fi

  holder=$(git -C "$worktree" worktree list --porcelain |
    awk -v ref="refs/heads/$branch" '/^worktree /{path=substr($0,10)} $1=="branch" && $2==ref{print path}')

  if [ -n "$holder" ]; then
    [ "$holder" = "$main_folder" ] ||
      block "$branch is checked out in $holder. Switch that folder to another branch, then prompt again."
    # Detach in place: the main folder keeps its files, uncommitted changes and commit.
    git_retry -C "$main_folder" switch --quiet --detach ||
      block "could not detach $main_folder from $branch."
  fi

  git_retry -C "$worktree" switch --quiet "$branch" ||
    block "could not check out $branch in this worktree (see git's error below; uncommitted changes that conflict with new commits on $branch are the usual cause). Resolve that in $worktree, then prompt again."
  git_retry -C "$worktree" merge --quiet --ff-only "$detached_head" ||
    block "could not fast-forward $branch to $detached_head."
  rm -f "$state_file"
}

case "$event" in
  Stop | SessionEnd) release ;;
  UserPromptSubmit) reclaim ;;
esac
exit 0
