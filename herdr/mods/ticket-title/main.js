// Ticket title: names each tab "<ticket number> · <what its agent is on>", e.g. "289 · PR 77 feedback".
//
// The ticket is the issue key in the agent's git branch, without its project prefix.
// The summary is the agent's terminal title, which Claude Code keeps as a short topic
// of the conversation, so no model call is made here.
//
// It draws nothing: it sits in the layout as a floating block only to stay running.
// A name the person gave a tab stays; "" (tab.rename) hands the tab back to this mod.
import { View, div } from "gpui-kit";
import { checking, exec, hc, machines, panes, run, setShared, shared, spaces } from "herdr";

const OWNED = "ticket-title.names"; // tab id → the name this mod gave it
const KEY = /\b[A-Z][A-Z0-9]+-(\d+)\b/;
const KEYS = new RegExp(KEY.source, "g");
const MAX = 32;

const ticketIn = (text) => text?.match(KEY)?.[1] ?? null;

function summary(pane, ticket) {
  // Agents lead their title with a status glyph.
  let text = (pane.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (!text || text === pane.program?.name || /^[~/]/.test(text)) return "";
  text = text.replace(KEYS, "$1");
  if (ticket) text = text.replace(new RegExp(`^${ticket}\\b[\\s:·›–-]*`), "");
  if (text.length <= MAX) return text;
  const cut = text.slice(0, MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export default class TicketTitle extends View {
  init(_props, _cx) {
    this.branch = {}; // terminal → branch where its program runs
    this.status = {};
    this.looking = {};
  }

  // A pane reports the branch of its shell's folder; an agent started elsewhere
  // (`cd repo && claude` in one line) works in its own, so ask where the program runs.
  lookup(terminal, machine, cx) {
    if (this.looking[terminal]) return;
    this.looking[terminal] = true;
    cx.spawn(async (cx) => {
      let branch = "";
      try {
        const info = JSON.parse((await hc(["get", terminal])).stdout);
        const cwd = info.foreground?.cwd ?? info.cwd;
        const git = await exec("git", ["branch", "--show-current"], { cwd, on: machine });
        if (git.code === 0) branch = git.stdout.trim();
      } catch (e) {
        console.error(`ticket-title: ${e?.message ?? e}`);
      }
      delete this.looking[terminal];
      if (this.branch[terminal] !== branch) {
        this.branch[terminal] = branch;
        cx.notify();
      }
    });
  }

  name(tab, space, all, cx) {
    const agent = all.find((p) => p.tab === tab.id && p.terminal && p.status);
    if (!agent) return "";

    const before = this.status[agent.terminal];
    this.status[agent.terminal] = agent.status;
    const turnEnded = before === "working" && agent.status !== "working";
    if (this.branch[agent.terminal] === undefined || turnEnded) this.lookup(agent.terminal, space.machine, cx);

    const ticket =
      ticketIn(this.branch[agent.terminal]) ?? ticketIn(agent.branch) ?? ticketIn(agent.title);
    return [ticket, summary(agent, ticket)].filter(Boolean).join(" · ");
  }

  render(cx) {
    if (checking()) return div();

    const owned = shared(OWNED) ?? {};
    const next = {};
    const all = panes();
    const seen = new Set();

    for (const space of spaces()) {
      for (const tab of space.tabs) {
        seen.add(tab.id);
        const mine = owned[tab.id];
        if (tab.named && tab.name !== mine) continue;

        const name = this.name(tab, space, all, cx);
        if (name) next[tab.id] = name;
        if (name !== (mine ?? "")) run("tab.rename", { id: tab.id, name });
      }
    }

    // A machine still loading hasn't listed its tabs yet: keep what was given to them.
    if (machines().some((m) => m.layout === "loading")) {
      for (const [id, name] of Object.entries(owned)) if (!seen.has(id)) next[id] = name;
    }
    if (JSON.stringify(next) !== JSON.stringify(owned)) setShared(OWNED, next);

    return div();
  }
}
