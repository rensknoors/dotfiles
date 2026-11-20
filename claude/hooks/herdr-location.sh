#!/bin/bash
# Claude Code hook: tells Herdr which folder this agent works in now.
# EnterWorktree moves the session into .claude/worktrees/<name> without changing the
# process's folder, so Herdr and hc only ever see the folder claude started in. This labels
# the agent's terminal with the session's own cwd (herdr.agent.cwd), which the Spaces
# sidebar (~/.config/herdr-app/mods/my-spaces) reads to find the agent's branch.
#   SessionStart, UserPromptSubmit, Stop, PostToolUse(EnterWorktree|ExitWorktree) -> set it
#   SessionEnd                                                                    -> remove it
set -u

[ -n "${HC_TERMINAL_ID:-}" ] || exit 0 # not in a herdr-core terminal
hc=$(command -v hc || echo "$HOME/.local/bin/hc")
[ -x "$hc" ] || exit 0

input=$(cat)
event=$(jq -r '.hook_event_name // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")

if [ "$event" = SessionEnd ]; then
  "$hc" label "$HC_TERMINAL_ID" herdr.agent.cwd= >/dev/null 2>&1
elif [ -n "$cwd" ]; then
  "$hc" label "$HC_TERMINAL_ID" "herdr.agent.cwd=$cwd" >/dev/null 2>&1
fi
exit 0
