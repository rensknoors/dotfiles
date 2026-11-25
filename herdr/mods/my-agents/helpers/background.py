"""Prints what a Claude Code session is still running in the background, as one JSON line:
{"agents": [{"id", "label", "type"}], "tasks": [{"id", "label"}]}

agents: sub-agents (Agent tool) whose meta file isn't finished yet.
tasks: background shell commands and monitors that haven't ended: no task-notification with a
<status> (a Monitor's <event> notifications come while it runs), and not stopped with TaskStop
(a stopped task gets no notification).
Both: only what this process started. Claude Code kills its background work when it exits, and
a resumed session's transcript still holds the old process's unfinished starts.
Exit 1 when no session belongs to the process (never a guess).
"""

import calendar
import glob
import json
import os
import re
import sys
import time

STALE = 24 * 3600  # a task this old without a notification is a lost one, not a running one
NOTIFICATION = re.compile(r"<task-notification>(.*?)</task-notification>")
TASK_ID = re.compile(r"<task-id>([^<]+)</task-id>")

pid = sys.argv[1] if len(sys.argv) > 1 else ""
if not pid.isdigit():
    sys.exit(1)

root = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
try:
    with open(f"{root}/sessions/{pid}.json") as f:
        info = json.load(f)
    session = info["sessionId"]
except (OSError, ValueError, KeyError):
    sys.exit(1)
if not re.fullmatch(r"[0-9A-Za-z-]+", session):
    sys.exit(1)
process_start = (info.get("startedAt") or 0) / 1000

transcripts = glob.glob(f"{root}/projects/*/{session}.jsonl")
if not transcripts:
    sys.exit(1)
transcript = transcripts[0]
folder = transcript[: -len(".jsonl")]
now = time.time()

agents = []
for meta_path in glob.glob(f"{folder}/subagents/*.meta.json"):
    try:
        with open(meta_path) as f:
            meta = json.load(f)
        written = os.path.getmtime(meta_path.replace(".meta.json", ".jsonl"))
        if meta.get("finished") or written < process_start or now - written > STALE:
            continue
    except (OSError, ValueError):
        continue
    agent_id = os.path.basename(meta_path)[len("agent-") : -len(".meta.json")]
    agents.append({
        "id": agent_id,
        "label": meta.get("description") or meta.get("agentType") or "Sub-agent",
        "type": meta.get("agentType") or "",
    })


def seconds(stamp):
    """Epoch seconds of a transcript timestamp ("2026-11-25T15:40:48.923Z", UTC), or None."""
    try:
        return calendar.timegm(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError):
        return None


def quoted(entry):
    """A notification inside a reply or a tool's output is text about a task, not its end."""
    if entry.get("type") == "assistant":
        return True
    content = (entry.get("message") or {}).get("content")
    return isinstance(content, list) and any(b.get("type") == "tool_result" for b in content if isinstance(b, dict))


started = {}  # task id → label
described = {}  # tool_use id → its description
ended = set()
with open(transcript, errors="replace") as f:
    for line in f:
        if "<task-notification>" in line:
            ends = [TASK_ID.search(n) for n in NOTIFICATION.findall(line) if "<status>" in n]
            if any(ends):
                try:
                    if not quoted(json.loads(line)):
                        ended.update(m.group(1) for m in ends if m)
                except ValueError:
                    pass
        if not any(key in line for key in ('"tool_use"', "backgroundTaskId", '"taskId"', '"task_id"')):
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        content = (entry.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get("type") == "tool_use":
                args = block.get("input") or {}
                described[block.get("id")] = args.get("description") or args.get("command") or block.get("name")
            elif block.get("type") == "tool_result":
                result = entry.get("toolUseResult")
                if not isinstance(result, dict):
                    continue
                # TaskStop's result: a dict only when the stop succeeded.
                if result.get("task_id") and result.get("task_type"):
                    ended.add(result["task_id"])
                    continue
                task = result.get("backgroundTaskId") or result.get("taskId")
                if not task or result.get("isAsync"):
                    continue
                at = seconds(entry.get("timestamp")) or now
                if at >= process_start and now - at < STALE:
                    started[task] = described.get(block.get("tool_use_id")) or "Background task"

ids = {a["id"] for a in agents}
tasks = [{"id": t, "label": label} for t, label in started.items() if t not in ended and t not in ids]
print(json.dumps({"agents": agents, "tasks": tasks}))
