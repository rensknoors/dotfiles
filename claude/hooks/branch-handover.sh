#!/bin/bash
# Claude Code hook: a worktree under <repo>/.claude/worktrees/ holds its branch
# only while its own session is working, so the branch can be checked out in the
# main folder whenever that session is idle.
#   Stop, SessionEnd           -> detach the worktree, releasing the branch
#   UserPromptSubmit           -> take the branch back; if the main folder has it
#                                 checked out, detach the main folder in place
#                                 (files untouched)
#   PostToolUse EnterWorktree  -> make the worktree this session's; take its branch
#   PostToolUse ExitWorktree   -> release the worktree and forget it
#   SessionStart after /clear  -> keep an entered worktree for the new session id
#
# A session's worktree is the one it started in (CLAUDE_PROJECT_DIR, as for a
# dispatched worker) or the one it entered with EnterWorktree. Never the one its
# shell happens to be in: a session that cd's into another agent's worktree (an
# orchestrator checking a worker) must not take or release that agent's branch.
set -u

input=$(cat)
event=$(jq -r '.hook_event_name // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
session=$(jq -r '.session_id // empty' <<<"$input")
tool=$(jq -r '.tool_name // empty' <<<"$input")
start_source=$(jq -r '.source // empty' <<<"$input")

# Which worktree each session entered with EnterWorktree, one file per session id.
registry_dir="${XDG_STATE_HOME:-$HOME/.local/state}/branch-handover/sessions"
registry="$registry_dir/${session:-unknown}"

# worktree_of <dir>: prints the top of <dir>'s worktree when it sits at
# <main folder>/.claude/worktrees/<name> of the same repository. The main folder
# comes from the path, not from git's common dir: a submodule keeps its common
# dir in the superproject's .git/modules.
worktree_of() {
  local top main
  [ -n "$1" ] || return 1
  top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) || return 1
  top=$(cd "$top" && pwd -P)
  case "$top" in */.claude/worktrees/*) ;; *) return 1 ;; esac
  main=${top%%/.claude/worktrees/*}
  [ "$(common_dir_of "$main")" = "$(common_dir_of "$top")" ] || return 1
  echo "$top"
}

common_dir_of() {
  (cd "$1" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)
}

registered_worktree() {
  local dir
  [ -f "$registry" ] || return 1
  dir=$(cat "$registry")
  [ -d "$dir" ] && echo "$dir"
}

worktree=
case "$event:$tool" in
  PostToolUse:EnterWorktree)
    worktree=$(worktree_of "$cwd") || exit 0
    mkdir -p "$registry_dir" && echo "$worktree" >"$registry"
    ;;
  PostToolUse:ExitWorktree)
    worktree=$(registered_worktree)
    rm -f "$registry"
    [ -n "$worktree" ] || exit 0
    ;;
  SessionStart:*)
    # /clear gives the session a new id; a worktree it had entered stays its own.
    [ "$start_source" = clear ] || exit 0
    worktree_of "${CLAUDE_PROJECT_DIR:-}" >/dev/null && exit 0
    worktree=$(worktree_of "$cwd") || exit 0
    [ "${worktree%%/.claude/worktrees/*}" = "$(cd "${CLAUDE_PROJECT_DIR:-/nonexistent}" 2>/dev/null && pwd -P)" ] || exit 0
    mkdir -p "$registry_dir" && echo "$worktree" >"$registry"
    exit 0
    ;;
  *)
    worktree=$(worktree_of "${CLAUDE_PROJECT_DIR:-}") || worktree=$(registered_worktree) || worktree=
    [ "$event" = SessionEnd ] && rm -f "$registry"
    [ -n "$worktree" ] || exit 0
    ;;
esac
main_folder=${worktree%%/.claude/worktrees/*}
git_dir=$(git -C "$worktree" rev-parse --absolute-git-dir)

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

  if [ "$(git -C "$main_folder" symbolic-ref --quiet HEAD)" = "refs/heads/$branch" ]; then
    # Detach in place: the main folder keeps its files, uncommitted changes and commit.
    git_retry -C "$main_folder" switch --quiet --detach ||
      block "could not detach $main_folder from $branch."
  else
    # The first entry is the main folder (which git lists as .git/modules/<name>
    # for a submodule), checked above.
    holder=$(git -C "$worktree" worktree list --porcelain |
      awk -v ref="refs/heads/$branch" '/^worktree /{n++; path=substr($0,10)} n>1 && $1=="branch" && $2==ref{print path}')
    [ -z "$holder" ] ||
      block "$branch is checked out in $holder. Switch that folder to another branch, then prompt again."
  fi

  git_retry -C "$worktree" switch --quiet "$branch" ||
    block "could not check out $branch in this worktree (see git's error below; uncommitted changes that conflict with new commits on $branch are the usual cause). Resolve that in $worktree, then prompt again."
  git_retry -C "$worktree" merge --quiet --ff-only "$detached_head" ||
    block "could not fast-forward $branch to $detached_head."
  rm -f "$state_file"
}

case "$event:$tool" in
  Stop:* | SessionEnd:* | PostToolUse:ExitWorktree) release ;;
  UserPromptSubmit:* | PostToolUse:EnterWorktree) reclaim ;;
esac
exit 0
