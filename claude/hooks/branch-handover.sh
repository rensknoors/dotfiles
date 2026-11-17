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

block() {
  echo "branch-handover: $1" >&2
  exit 2
}

release() {
  local branch
  branch=$(git -C "$worktree" symbolic-ref --quiet --short HEAD) || exit 0
  git -C "$worktree" switch --quiet --detach 2>/dev/null || exit 0
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
    git -C "$main_folder" switch --quiet --detach 2>/dev/null ||
      block "could not detach $main_folder from $branch."
  fi

  git -C "$worktree" switch --quiet "$branch" 2>/dev/null ||
    block "could not check out $branch in this worktree; its uncommitted changes probably conflict with new commits on $branch. Resolve that in $worktree, then prompt again."
  git -C "$worktree" merge --quiet --ff-only "$detached_head" 2>/dev/null ||
    block "could not fast-forward $branch to $detached_head."
  rm -f "$state_file"
}

case "$event" in
  Stop | SessionEnd) release ;;
  UserPromptSubmit) reclaim ;;
esac
exit 0
