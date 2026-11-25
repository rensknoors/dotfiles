"""Prints what a Claude Code session is still running in the background, as one JSON line:
{"agents": [{"id", "label", "type"}], "tasks": [{"id", "label"}]}

agents: sub-agents (Agent tool) whose meta file isn't finished yet.
tasks: background shell commands and monitors with no task-notification yet, and not stopped
with TaskStop (a stopped task gets no notification).
Exit 1 when no session belongs to the process (never a guess).
"""

import glob
import json
import os
import re
import sys
import time

STALE = 24 * 3600  # a task this old without a notification is a lost one, not a running one

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
transcript = transcripts[0]
folder = transcript[: -len(".jsonl")]

agents = []
for meta_path in glob.glob(f"{folder}/subagents/*.meta.json"):
    try:
        with open(meta_path) as f:
            meta = json.load(f)
        log = meta_path.replace(".meta.json", ".jsonl")
        if meta.get("finished") or time.time() - os.path.getmtime(log) > STALE:
            continue
    except (OSError, ValueError):
        continue
    agent_id = os.path.basename(meta_path)[len("agent-") : -len(".meta.json")]
    agents.append({
        "id": agent_id,
        "label": meta.get("description") or meta.get("agentType") or "Sub-agent",
        "type": meta.get("agentType") or "",
    })

started = {}  # task id → label
described = {}  # tool_use id → its description
notified = set()
now = time.time()
with open(transcript, errors="replace") as f:
    for line in f:
        notified.update(re.findall(r"<task-id>([^<]+)</task-id>", line))
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
                    notified.add(result["task_id"])
                    continue
                task = result.get("backgroundTaskId") or result.get("taskId")
                if not task or result.get("isAsync"):
                    continue
                stamp = entry.get("timestamp", "")
                try:
                    age = now - time.mktime(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S")) + time.timezone
                except ValueError:
                    age = 0
                if age < STALE:
                    started[task] = described.get(block.get("tool_use_id")) or "Background task"

ids = {a["id"] for a in agents}
tasks = [{"id": t, "label": label} for t, label in started.items() if t not in notified and t not in ids]
print(json.dumps({"agents": agents, "tasks": tasks}))
