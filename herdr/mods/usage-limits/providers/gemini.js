// Gemini: the Antigravity CLI's own `/usage` command (helpers/gemini-usage.sh).
// agy groups models that share a quota; each group has a 5-hour and/or weekly
// bucket and reports what's *remaining*, so it's turned into used here.
import { makeWindow, okReport, errorReport, unavailableReport, toEpoch, jsonLines } from "../lib/report.js";

const SOURCE = "agy CLI";
const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;
const WINDOWS = {
  "5h": { short: "5h", long: "5-hour", durationSec: 5 * HOUR, order: 0 },
  weekly: { short: "wk", long: "Weekly", durationSec: WEEK, order: 1 },
};

// "Gemini Models" is the main group and goes unlabelled, like Claude's own limits.
// "Claude and GPT models" → "Claude/GPT", "Gemini 4 Argon" → "Argon".
export function groupLabel(name) {
  const s = String(name ?? "")
    .replace(/\s+models$/i, "")
    .replace(/^Gemini(\s+\d+(\.\d+)?)?\s*/i, "")
    .replace(/\s+and\s+/gi, "/")
    .trim();
  return s || null;
}

function bucketWindow(prefix, b) {
  const kind = WINDOWS[b.window] ?? { short: b.window ?? "limit", long: b.name ?? b.window ?? "Limit", durationSec: null, order: 2 };
  return {
    order: kind.order,
    window: makeWindow({
      id: String(b.id ?? `${prefix ?? "gemini"}:${b.window}`),
      short: prefix ? `${prefix} ${kind.short}` : kind.short,
      long: prefix ? `${prefix} · ${kind.long}` : kind.long,
      percent: (1 - Number(b.remaining_fraction)) * 100,
      resetsAt: toEpoch(b.reset_time),
      durationSec: kind.durationSec,
    }),
  };
}

export function parse(text, now) {
  const msg = jsonLines(text).find((m) => m.command);
  if (!msg) return errorReport(SOURCE, "No reply from the agy CLI", now);
  if (msg.status !== "SUCCESS") return errorReport(SOURCE, String(msg.error ?? msg.response ?? "agy could not read usage").trim(), now);
  const groups = msg.command.data?.groups ?? [];
  const windows = groups.flatMap((g) => {
    const prefix = groupLabel(g.name);
    return (g.buckets ?? [])
      .filter((b) => b && b.remaining_fraction != null && Number.isFinite(Number(b.remaining_fraction)))
      .map((b) => bucketWindow(prefix, b))
      .sort((a, b) => a.order - b.order) // 5-hour before weekly, as with Claude and Codex
      .map((x) => x.window);
  });
  if (windows.length === 0) return unavailableReport(SOURCE, "No quota limits", now);
  return okReport(SOURCE, now, windows);
}

export default {
  id: "gemini",
  name: "Gemini",
  icon: "mods/usage-limits/icons/gemini.svg",
  helper: "helpers/gemini-usage.sh",
  parse,
};
