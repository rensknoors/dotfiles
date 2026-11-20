"""Prints when a Claude Code session's prompt cache was last written and how long it lives,
as one JSON line: {"last": <epoch ms of the last main-chain response>, "ttl": <seconds>}

The cache lives `ttl` after the last request that used it (each request refreshes it), so
`last + ttl` is when it goes cold. ttl comes from the response's promptCacheRequested ("1h"
or "5m"), else from which cache bucket it wrote to, else 5 minutes.
Exit 1 when no session belongs to the process or it has no response yet (never a guess).
"""

import glob
import json
import os
import re
import sys
from datetime import datetime

TAIL = 4 << 20  # bytes read from the transcript's end before falling back to all of it

pid = sys.argv[1] if len(sys.argv) > 1 else ""
if not pid.isdigit():
    sys.exit(1)

root = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
try:
    with open(f"{root}/sessions/{pid}.json") as f:
        session = json.load(f)["sessionId"]
except (OSError, ValueError, KeyError):
    sys.exit(1)
if not re.fullmatch(r"[0-9A-Za-z-]+", session):
    sys.exit(1)
transcripts = glob.glob(f"{root}/projects/*/{session}.jsonl")
if not transcripts:
    sys.exit(1)


def ttl_of(d):
    req = d.get("promptCacheRequested")
    if req in ("1h", "5m"):
        return 3600 if req == "1h" else 300
    made = (d.get("message") or {}).get("usage", {}).get("cache_creation") or {}
    if made.get("ephemeral_1h_input_tokens"):
        return 3600
    if made.get("ephemeral_5m_input_tokens"):
        return 300
    return None


def last_response(lines):
    last, ttl = None, None
    for line in reversed(lines):
        if '"type":"assistant"' not in line or '"isSidechain":true' in line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if last is None:
            last = d.get("timestamp")
        ttl = ttl_of(d)
        if ttl:
            break
    return last, ttl


with open(transcripts[0], "rb") as f:
    f.seek(0, os.SEEK_END)
    size = f.tell()
    f.seek(max(0, size - TAIL))
    lines = f.read().decode(errors="replace").splitlines()
    last, ttl = last_response(lines)
    if (not last or not ttl) and size > TAIL:
        f.seek(0)
        last, ttl = last_response(f.read().decode(errors="replace").splitlines())

if not last:
    sys.exit(1)
at = datetime.fromisoformat(last.replace("Z", "+00:00"))
print(json.dumps({"last": int(at.timestamp() * 1000), "ttl": ttl or 300}))
