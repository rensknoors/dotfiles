#!/bin/sh
# Prints one JSON line about the Claude Code session a process is running, and exits:
#   total <pid>:     the transcript's last main-chain assistant line or compact boundary
#   breakdown <pid>: the session's /context breakdown (get_context_usage response)
#
# The breakdown comes from a throwaway resumed fork of the session, started in its
# folder so tools, MCP, skills and memory files load as they would there. It sends no
# prompt, so no model call is made; hooks are off so none fire for the fork.
#
# Exit: 0 = printed, 1 = no session found for that process (never a guess).

mode=$1
pid=$2
case "$pid" in '' | *[!0-9]*) exit 1 ;; esac

dir=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
meta="$dir/sessions/$pid.json"
[ -f "$meta" ] || exit 1
id=$(sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' "$meta")
case "$id" in '' | *[!0-9a-zA-Z-]*) exit 1 ;; esac
cwd=$(sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p' "$meta")

case "$mode" in
  total)
    for file in "$dir"/projects/*/"$id".jsonl; do
      [ -f "$file" ] || exit 1
      line=$(grep -E '"subtype":"compact_boundary"|"type":"assistant"' "$file" | grep -v '"isSidechain":true' | tail -n 1)
      [ -n "$line" ] || exit 1
      printf '%s\n' "$line"
      exit 0
    done
    exit 1
    ;;
  breakdown)
    cd "${cwd:-$HOME}" || exit 1
    printf '%s\n' \
      '{"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}' \
      '{"type":"control_request","request_id":"ctx","request":{"subtype":"get_context_usage","detail":"summary"}}' |
      claude -p --resume "$id" --fork-session --no-session-persistence \
        --settings '{"disableAllHooks":true}' \
        --input-format stream-json --output-format stream-json --verbose |
      grep -m 1 '"request_id":"ctx"'
    ;;
  *) exit 1 ;;
esac
