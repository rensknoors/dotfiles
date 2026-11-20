#!/bin/sh
# Prints Gemini's quota (one JSON line from the Antigravity CLI) and exits.
#
# Runs `agy -p /usage --output-format json`: a read-only slash command that
# agy answers itself, without starting a turn or a conversation and without
# spending tokens. agy authenticates itself; this script reads no tokens.
#
# Exit: 0 = printed the reply, 127 = agy not found, 1 = no reply in 15 s.
# Override the binary with HERDR_USAGE_AGY_BIN.

AGY=$(command -v "${HERDR_USAGE_AGY_BIN:-agy}" 2>/dev/null) || exit 127

dir=$(mktemp -d "${TMPDIR:-/tmp}/herdr-gemini-usage.XXXXXX") || exit 1
out="$dir/out"

"$AGY" -p /usage --output-format json </dev/null >"$out" 2>/dev/null &
pid=$!

i=0
while [ "$i" -lt 75 ]; do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.2
  i=$((i + 1))
done
kill "$pid" 2>/dev/null
wait "$pid" 2>/dev/null

status=1
if grep -m1 '"command"' "$out"; then status=0; fi
rm -rf "$dir"
exit $status
