#!/usr/bin/env -S python3 -I
"""Claude Code UserPromptSubmit hook: stops the first prompt sent to a session whose prompt
cache has gone cold, because that prompt re-reads the whole context at full price.

The cache lives for its TTL (1h or 5m, read from the transcript) after the last API call.
When it has expired, the prompt is blocked once with a message. Any prompt sent to the same
session within RETRY seconds after that goes through. Slash commands and turns Claude Code
starts itself (task notifications) are never blocked.
"""

import json
import os
import sys
import tempfile
import time
from datetime import datetime

RETRY = 10 * 60
TAIL = 4 << 20  # bytes read from the transcript's end before falling back to all of it


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
    """The newest main-chain response's timestamp, and the newest cache TTL found."""
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


def read_transcript(path):
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - TAIL))
        last, ttl = last_response(f.read().decode(errors="replace").splitlines())
        if (not last or not ttl) and size > TAIL:
            f.seek(0)
            last, ttl = last_response(f.read().decode(errors="replace").splitlines())
    return last, ttl or 300


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    prompt = (event.get("prompt") or "").lstrip()
    session = event.get("session_id") or ""
    transcript = event.get("transcript_path") or ""
    if prompt.startswith(("/", "<")) or not session.replace("-", "").isalnum() or not os.path.isfile(transcript):
        return

    last, ttl = read_transcript(transcript)
    if not last:
        return  # a new session: there is no cache to lose
    at = datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp()
    cold_for = time.time() - (at + ttl)
    if cold_for <= 0:
        return

    marker_dir = os.path.join(tempfile.gettempdir(), "claude-cold-cache")
    marker = os.path.join(marker_dir, session)
    try:
        with open(marker) as f:
            warned_last, warned_at = f.read().split()
        if warned_last == last and time.time() - float(warned_at) < RETRY:
            os.remove(marker)
            return
    except (OSError, ValueError):
        pass
    os.makedirs(marker_dir, exist_ok=True)
    with open(marker, "w") as f:
        f.write(f"{last} {time.time()}")

    minutes = int(cold_for // 60)
    ago = f"{minutes // 60}h {minutes % 60}m" if minutes >= 60 else f"{minutes}m"
    print(json.dumps({
        "decision": "block",
        "reason": (
            f"Prompt cache is cold (TTL {ttl // 60}m, expired {ago} ago): this prompt would re-read "
            "the whole context at full price. Send it again to go ahead, or /clear or /compact first."
        ),
    }))


if __name__ == "__main__":
    main()
