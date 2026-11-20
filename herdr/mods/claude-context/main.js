// Claude context: the /context breakdown of the focused Claude Code agent.
// Roles (props.role): the panel (default); "toggle", the tab-bar button that shows or hides it.
//
// helpers/context.sh does the reading: the transcript's last usage for a quick total,
// then a resumed fork of the session for the exact per-category breakdown.
// Refreshes on focus change and when the agent stops working; nothing polls.
import { View, div, svg } from "gpui-kit";
import { HoverCard, h_flex, v_flex } from "gpui-base";
import { agents, appHome, exec, focused, layout, props, run, theme } from "herdr";

const BLOCK = "claude-context"; // the layout block keys.json toggles
const HELPER = () => `${appHome()}/mods/claude-context/helpers/context.sh`;
const WARN = 70;
const HOT = 85;

function tokens(n) {
  if (n < 1000) return String(n);
  if (n < 999500) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

const percent = (n, max) => (max ? (n / max) * 100 : 0);
const shortPercent = (p) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);

// Context used at the last response; after a compaction with no reply yet, what it left.
function totalFrom(line) {
  const d = JSON.parse(line);
  if (d.subtype === "compact_boundary") return d.compactMetadata?.postTokens ?? null;
  const u = d.message?.usage;
  if (!u) return null;
  const last = u.iterations?.length ? u.iterations[u.iterations.length - 1] : u;
  const n = (last.input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0);
  return n || null;
}

function breakdownFrom(line) {
  const r = JSON.parse(line).response;
  if (r?.subtype !== "success") throw new Error(r?.error ?? "get_context_usage failed");
  return r.response;
}

export default class ClaudeContext extends View {
  init(_props, _cx) {
    this.terminal = null;
    this.byTerminal = {}; // terminal → { total, breakdown, stale, error }
    this.lastStatus = {};
    this.busy = false;
    this.pending = null;
  }

  refresh(terminal, cx) {
    if (this.busy) {
      this.pending = terminal;
      return;
    }
    this.busy = true;
    const entry = (this.byTerminal[terminal] ??= {});
    entry.stale = true;
    entry.error = null;
    cx.spawn(async (cx) => {
      try {
        const info = JSON.parse((await exec("hc", ["get", terminal])).stdout);
        const pid = String(info.foreground?.pid ?? "");
        const total = await exec("sh", [HELPER(), "total", pid]);
        entry.total = total.code === 0 ? totalFrom(total.stdout) : null;
        cx.notify();
        const full = await exec("sh", [HELPER(), "breakdown", pid], { timeout: 20000 });
        if (full.code !== 0 || !full.stdout.trim()) throw new Error(full.stderr.trim() || `exit ${full.code}`);
        entry.breakdown = breakdownFrom(full.stdout);
        entry.stale = false;
      } catch (e) {
        console.error(`claude-context: ${e?.message ?? e}`);
        entry.error = "breakdown unavailable";
        entry.stale = false;
      } finally {
        this.busy = false;
      }
      cx.notify();
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        this.refresh(next, cx);
      }
    });
  }

  render(cx) {
    if (props()?.role === "toggle") return toggleButton();
    const t = theme();
    const f = focused();
    const terminal = f?.terminal ?? null;
    const agent = terminal ? agents().find((a) => a.address === terminal) : null;
    const isClaude = agent?.app === "claude-code";

    // A hidden copy stays alive: it only notes what changed and catches up when shown.
    const shown = !findNode(layout(), BLOCK)?.hidden;
    if (isClaude) {
      const before = this.lastStatus[terminal];
      this.lastStatus[terminal] = agent.status;
      const turnEnded = before === "working" && agent.status !== "working";
      if (terminal !== this.terminal || turnEnded || !this.wasShown) this.dirty = true;
      if (shown && this.dirty) {
        this.dirty = false;
        this.refresh(terminal, cx);
      }
    }
    this.wasShown = shown;
    this.terminal = terminal;

    const root = v_flex().id("root").size_full().bg(t.chrome).p(12).gap(10).text_size(12.5).text_color(t.foreground).overflow_y_scrollbar();
    if (!agent) return root.child(this.note("No Claude Code agent in focus", t));
    if (!isClaude) return root.child(this.note(`Not supported for ${agent.app ?? agent.program?.name ?? "this agent"}`, t));

    const entry = this.byTerminal[terminal] ?? {};
    return root.children([this.header(entry, t), ...this.body(entry, t)]);
  }

  note(text, t) {
    return div().text_color(t.dim).child(text);
  }

  header(entry, t) {
    const b = entry.breakdown;
    const max = b?.maxTokens ?? null;
    const used = entry.stale && entry.total != null ? entry.total : (b?.totalTokens ?? entry.total);
    const approx = entry.stale || !b;
    const p = max && used != null ? percent(used, max) : null;
    const level = p == null ? t.foreground : p >= HOT ? t.ansi1 : p >= WARN ? t.ansi3 : t.foreground;
    const summary =
      used == null ? "…" : `${approx ? "~" : ""}${tokens(used)}${max ? ` / ${tokens(max)} · ${Math.round(p)}%` : ""}`;
    return v_flex()
      .gap(2)
      .child(
        h_flex()
          .justify_between()
          .child(div().font_semibold().child("Context"))
          .child(div().text_color(t.muted).truncate().child(b?.model ?? "")),
      )
      .child(
        h_flex()
          .gap(6)
          .child(div().text_size(15).font_semibold().text_color(level).child(summary))
          .when(entry.stale, (el) => el.child(div().text_color(t.dim).child("updating…")))
          .when(!!entry.error, (el) => el.child(div().text_color(t.dim).child(entry.error))),
      );
  }

  body(entry, t) {
    const b = entry.breakdown;
    if (!b) return [];
    const max = b.maxTokens;
    const p = percent(b.totalTokens, max);
    const warn = p >= HOT ? t.ansi1 : p >= WARN ? t.ansi3 : null;
    const colorOf = (c) => (c.kind === "free" ? t.raised : c.kind === "buffer" ? t.dim : (COLORS[c.id] ?? COLORS.other));

    const inWindow = b.categories.filter((c) => c.kind !== "deferred").map((c) => ({ ...c, color: colorOf(c) }));
    const deferred = b.categories.filter((c) => c.kind === "deferred");

    const bar = h_flex()
      .w_full()
      .h(10)
      .rounded(3)
      .overflow_hidden()
      .bg(t.raised)
      .when(!!warn, (el) => el.border(1).border_color(warn))
      .children(
        inWindow
          .filter((c) => c.kind !== "free" && c.tokens > 0)
          .map((c) => div().h_full().w(`${percent(c.tokens, max)}%`).bg(c.color)),
      );

    const row = (c, color, dim) => {
      const line = h_flex()
        .id(`row-${c.id}`)
        .gap(8)
        .items_center()
        .px(4)
        .mx(-4)
        .rounded(4)
        .text_color(dim ? t.dim : t.foreground)
        .child(div().w(8).h(8).rounded(2).bg(color))
        .child(div().flex_1().truncate().child(c.name))
        .child(div().text_color(dim ? t.dim : t.muted).child(tokens(c.tokens)))
        .child(div().w(34).flex().justify_end().text_color(t.dim).child(dim ? "" : shortPercent(percent(c.tokens, max))));
      const sections = details(c, b);
      if (!sections) return line;
      return HoverCard.new(`hc-${c.id}`)
        .anchor("top_right")
        .open_delay(250)
        .close_delay(150)
        .trigger(line.hover((s) => s.bg(t.hover)))
        .content(card(c, color, sections, t));
    };

    return [
      bar,
      v_flex().gap(5).children(inWindow.map((c) => row(c, c.color, false))),
      ...(deferred.length
        ? [
            v_flex()
              .gap(5)
              .pt(4)
              .child(div().text_size(11).text_color(t.dim).child("Loaded on demand, not in context"))
              .children(deferred.map((c) => row(c, t.border, true))),
          ]
        : []),
    ];
  }
}

const TOGGLE_PAD = 10; // right edge of the window

function toggleButton() {
  const t = theme();
  const on = !findNode(layout(), BLOCK)?.hidden;
  return h_flex()
    .size_full()
    .pr(TOGGLE_PAD)
    .items_center()
    .justify_end()
    .bg(t.chrome)
    .border_b(1)
    .border_color(t.border)
    .child(
      h_flex()
        .id("toggle-claude-context")
        .on_size_change((size) => {
          // The layout can't size a block to its content, so the button sizes its own block.
          const id = props()?.block ?? "claude-context-toggle", px = Math.ceil(size.width) + TOGGLE_PAD;
          if (findNode(layout(), id)?.size?.px !== px) run("layout.resize", { id, px });
        })
        .h(26)
        .px(8)
        .gap(5)
        .flex_none()
        .items_center()
        .rounded(6)
        .text_size(12)
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => run("layout.toggle", { id: BLOCK }))
        .child(svg("mods/claude-context/context.svg").size(14))
        .child("Context"),
    );
}

// Fixed hues rather than the theme's ANSI colours, which many themes mute into near-greys.
const COLORS = {
  system_prompt: "#5B8FF9",
  system_tools: "#5AD8A6",
  mcp_tools: "#9270CA",
  mcp_instructions: "#B38CF0",
  custom_agents: "#6DC8EC",
  memory_files: "#F6BD16",
  skills: "#FF9845",
  messages: "#F0609E",
  other: "#A3A3A3",
};
const MAX_ITEMS = 12;

const fileName = (path) => (path ?? "").replace(/^.*\/(?=[^/]+\/[^/]+$)/, "");

// The parts behind a category, as sections of { label, sub?, tokens }; null when there are none.
function details(c, b) {
  const list = (heading, items) => (items?.length ? [{ heading, items: items.filter((i) => i.tokens > 0) }] : []);
  switch (c.id) {
    case "skills": {
      const s = b.skills;
      if (!s?.skillFrontmatter?.length) return null;
      return [
        {
          heading: `${s.includedSkills} of ${s.totalSkills} skills listed`,
          items: s.skillFrontmatter.map((k) => ({ label: k.name, sub: k.source, tokens: k.tokens })),
        },
      ];
    }
    case "memory_files":
      return nonEmpty(list("Files", b.memoryFiles?.map((f) => ({ label: fileName(f.path), sub: f.type, tokens: f.tokens }))));
    case "mcp_tools":
    case "mcp_tools_deferred":
      return nonEmpty(
        list(
          "Tools",
          b.mcpTools
            ?.filter((m) => (c.id === "mcp_tools") === !!m.isLoaded)
            .map((m) => ({ label: m.name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, ""), sub: m.serverName, tokens: m.tokens })),
        ),
      );
    case "mcp_instructions":
      return nonEmpty(list("Servers", b.mcpInstructions?.map((m) => ({ label: m.serverName ?? m.name, tokens: m.tokens }))));
    case "custom_agents":
      return nonEmpty(list("Agents", b.agents?.map((a) => ({ label: a.agentType, sub: a.source, tokens: a.tokens }))));
    case "messages":
      return messageDetails(c, b.messageBreakdown);
    case "autocompact_buffer":
      return [
        {
          note: b.isAutoCompactEnabled
            ? `Kept free so the conversation is compacted before the window fills${b.autoCompactThreshold ? `, at ${tokens(b.autoCompactThreshold)}` : ""}.`
            : "Autocompact is off.",
          items: [],
        },
      ];
    default:
      return null;
  }
}

const nonEmpty = (sections) => (sections.some((s) => s.items.length) ? sections : null);

// The split is a local estimate that doesn't add up to the measured total: scale it to fit.
function messageDetails(c, m) {
  if (!m) return null;
  const parts = [
    { label: "Tool results", tokens: m.toolResultTokens },
    { label: "Attachments", tokens: m.attachmentTokens },
    { label: "User messages", tokens: m.userMessageTokens },
    { label: "Assistant messages", tokens: m.assistantMessageTokens },
    { label: "Tool calls", tokens: m.toolCallTokens },
  ];
  const sum = parts.reduce((n, x) => n + (x.tokens ?? 0), 0);
  if (!sum) return null;
  const scale = (n) => Math.round((n * c.tokens) / sum);
  const scaled = (items) => items.map((x) => ({ ...x, tokens: scale(x.tokens ?? 0), approx: true })).filter((x) => x.tokens > 0);
  return [
    { heading: "By kind", items: scaled(parts), note: "Estimated split, scaled to the measured total." },
    { heading: "Tools", items: scaled((m.toolCallsByType ?? []).map((x) => ({ label: x.name.replace(/^mcp__/, ""), tokens: x.callTokens + x.resultTokens }))) },
    { heading: "Attachments", items: scaled((m.attachmentsByType ?? []).map((x) => ({ label: x.name.replaceAll("_", " "), tokens: x.tokens }))) },
  ].filter((s) => s.items.length);
}

function card(c, color, sections, t) {
  const item = (x) =>
    h_flex()
      .gap(8)
      .child(div().flex_1().min_w(0).truncate().child(x.label))
      .when(!!x.sub, (el) => el.child(div().flex_none().text_color(t.dim).text_size(11).child(x.sub)))
      .child(div().flex_none().w(44).flex().justify_end().text_color(t.muted).child(`${x.approx ? "~" : ""}${tokens(x.tokens)}`));
  const section = (s) => {
    const sorted = [...s.items].sort((a, z) => z.tokens - a.tokens);
    const rest = sorted.slice(MAX_ITEMS);
    return v_flex()
      .gap(3)
      .when(!!s.heading, (el) => el.child(div().text_size(11).text_color(t.dim).child(s.heading)))
      .children(sorted.slice(0, MAX_ITEMS).map(item))
      .when(rest.length > 0, (el) =>
        el.child(div().text_color(t.dim).child(`+${rest.length} more · ${tokens(rest.reduce((n, x) => n + x.tokens, 0))}`)),
      )
      .when(!!s.note, (el) => el.child(div().text_size(11).text_color(t.dim).child(s.note)));
  };
  return v_flex()
    .w(300)
    .p(10)
    .gap(10)
    .rounded(8)
    .border(1)
    .border_color(t.border)
    .bg(t.popover)
    .shadow_lg()
    .text_size(12)
    .text_color(t.foreground)
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .child(div().w(8).h(8).rounded(2).bg(color))
        .child(div().flex_1().font_semibold().child(c.name))
        .child(div().text_color(t.muted).child(tokens(c.tokens))),
    )
    .children(sections.map(section));
}
