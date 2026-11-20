// A diff as a pane, opened by the Git panel (my-changes) beside the terminal, like VS Code's diff editor.
// Props: { tab }. What it shows is shared "git.diff.<tab>": { root, on, path } for a working-tree file
// (against HEAD) or { root, on, commit } for a commit. The panel sets that key, so one pane per tab is reused.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { exec, readTextFile, watchFolder, theme, settings, shared, props, checking } from "herdr";
import { PALETTES, highlight, langFor } from "./highlight.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const MAX_LINES = 4000;
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

function palette() {
  const dark = settings().dark;
  if (typeof dark === "boolean") return dark ? PALETTES.dark : PALETTES.light;
  const hex = theme().background ?? "#000000", n = parseInt(hex.slice(1, 7), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 128 ? PALETTES.dark : PALETTES.light;
}

// Numbers each diff line once, so a frame only draws the rows on screen. A commit's diff holds several files:
// each "diff --git" line becomes a file header and switches the highlighter's language.
// Each side keeps its own open block comment, so a removed "/*" can't color the added lines.
function diffRows(lines, path) {
  let old = 0, next = 0, oldState = { open: null }, newState = { open: null }, lang = path ? langFor(path) : null;
  const p = palette(), spans = (text, state) => lang ? highlight(text, lang, p, state) : [{ text, color: p.fg }];
  const rows = [];
  for (const line of lines) {
    const file = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (file) { lang = langFor(file[1]); rows.push({ kind: "file", text: file[1] }); continue; }
    if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to)|old mode|new mode)/.test(line)) continue;
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; oldState = { open: null }; newState = { open: null }; rows.push({ kind: "@", text: line }); continue; }
    const kind = line[0], text = untab(line.slice(1)) || " ";
    if (kind === "-") rows.push({ kind, number: old++, text, spans: spans(text, oldState) });
    else if (kind === "+") rows.push({ kind, number: next++, text, spans: spans(text, newState) });
    else if (kind === " ") { old++; rows.push({ kind, number: next++, text, spans: spans(text, newState) }); oldState = { open: newState.open }; }
    else rows.push({ kind: "", text: line });
  }
  return rows;
}

export default class GitDiff extends View {
  init(_props, cx) {
    this.rows = []; this.width = 300; this.add = 0; this.del = 0; this.title = null;
    if (checking()) return;
    cx.timer.every(10000, (cx) => this.reload(cx));
  }

  target() { return shared(`git.diff.${props()?.tab}`) ?? null; }

  watch(root, on, cx) {
    if (on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) this.reload(cx); } }
      catch { this.watched = null; }
    });
  }

  reload(cx) {
    const target = this.target();
    if (!target?.root || this.loading) return;
    const key = JSON.stringify(target);
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const { lines, title } = await this.load(target);
        if (JSON.stringify(this.target()) !== key) return;
        this.key = key; this.title = title; this.error = null;
        const cut = lines.slice(0, MAX_LINES).map((l) => l.length > 4000 ? l.slice(0, 4000) + "… (line truncated)" : l);
        this.rows = diffRows(cut, target.path);
        this.truncated = lines.length > MAX_LINES;
        this.add = this.rows.filter((r) => r.kind === "+").length; this.del = this.rows.filter((r) => r.kind === "-").length;
        this.width = Math.max(300, ...this.rows.map((row) => (row.text.length + 1) * 7 + 60));
        this.watch(target.root, target.on, cx);
      } catch (e) { this.key = key; this.rows = []; this.error = String(e.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load({ root, on, path, commit }) {
    const git = (args) => exec("git", [...READ, ...args], { cwd: root, on: on ?? undefined });
    if (commit) {
      const r = await git(["show", "--no-color", "--no-ext-diff", "--format=%h%x1f%s%x1f%an%x1f%cr", commit]);
      if (r.code !== 0) throw new Error(r.stderr.trim());
      const [head, ...rest] = r.stdout.replace(/\n$/, "").split("\n");
      const [sha, subject, author, age] = head.split("\x1f");
      return { title: { sha, subject, author, age }, lines: rest.filter((l, i) => i > 0 || l !== "") };
    }
    const title = { path };
    const status = await git(["status", "--porcelain=v1", "-z", "--", path]);
    const xy = status.stdout.slice(0, 2), head = await git(["rev-parse", "--verify", "HEAD"]);
    if (xy === "??" || (head.code !== 0 && xy.includes("A"))) {
      const text = await readTextFile(`${root}/${path}`, { on: on ?? undefined }).catch(() => null);
      if (text === null) return { title, lines: ["Cannot preview this file (binary, too large, or unreadable)"] };
      if (text.includes("\0")) return { title, lines: ["Binary file · no text diff"] };
      return { title, lines: [`@@ -0,0 +1,${countLines(text)} @@`, ...text.slice(0, 600000).replace(/\n$/, "").split("\n").map((l) => `+${l}`)] };
    }
    const r = await git(["diff", ...(head.code === 0 ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path]);
    if (r.code !== 0) throw new Error(r.stderr.trim());
    const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
    if (first >= 0) return { title, lines: all.slice(first) };
    return { title, lines: [r.stdout.includes("Binary files") ? "Binary file changed" : xy ? "No text changes" : "No changes: this file matches HEAD"] };
  }

  row({ kind, number, text, spans }, t, p) {
    if (kind === "file") return h_flex().w_full().h(20).flex_none().px(12).gap(8).items_center().bg(t.raised).border_t(1).border_color(t.border)
      .child(svg("mods/my-changes/icons/file.svg").size(13).flex_none().text_color(t.muted)).child(div().font_semibold().text_color(t.foreground).child(text));
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.surface).text_color(p.range).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(p.inserted)).when(kind === "-", (e) => e.bg(p.removed))
      .child(div().w(40).flex_none().text_right().text_color(p.lineNumber).child(number === undefined ? "" : String(number)))
      .child(div().w(10).flex_none().text_color(kind === "+" ? p.added : p.deleted).child(kind === "+" || kind === "-" ? kind : ""))
      .child(spans
        ? h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().children(spans.map((s) => div().flex_none().whitespace_nowrap().text_color(s.color).when(Boolean(s.bold), (e) => e.font_bold()).child(s.text)))
        : div().flex_1().min_w(0).truncate().text_color(p.fg).child(text));
  }

  render(cx) {
    const target = this.target();
    if (target && JSON.stringify(target) !== this.key && !this.loading) this.reload(cx);
    const t = theme(), p = palette(), title = this.title;
    const header = !target ? div().text_color(t.dim).child("Pick a file in the Git panel")
      : target.commit ? h_flex().min_w(0).gap(8).items_center()
        .child(svg("mods/my-changes/icons/commit.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_none().text_color(t.dim).font_family(settings().font_family ?? "JetBrains Mono").child(title?.sha ?? target.commit.slice(0, 7)))
        .child(div().min_w(0).truncate().font_semibold().child(title?.subject ?? ""))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(title ? `${title.author} · ${title.age}` : ""))
      : h_flex().min_w(0).gap(8).items_center()
        .child(svg("mods/my-changes/icons/file.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_none().font_semibold().child(target.path.split("/").pop()))
        .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(target.path.split("/").slice(0, -1).join("/")))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Working Tree ↔ HEAD"));
    return v_flex().id("git-diff").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(34).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).child(header))
        .when(this.loading, (e) => e.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.dim).spin(900)))
        .when(Boolean(target) && this.add + this.del > 0, (e) => e
          .child(div().flex_none().text_size(11).text_color(p.added).child(`+${this.add}`))
          .child(div().flex_none().text_size(11).text_color(p.deleted).child(`−${this.del}`))))
      .when(Boolean(this.error), (e) => e.child(div().p(12).text_color(t.ansi1).child(this.error)))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(12)
        .child(div().id("git-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.width).h_full().child(v_virtual_list("git-diff-rows", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.row(row, t, p))).size_full())))
        .child(Scrollbar.vertical("git-diff-rows").viewport_from_layout().absolute().inset_0()))
      .when(Boolean(this.truncated), (e) => e.child(div().px(12).py(4).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child(`Showing the first ${MAX_LINES} lines`)));
  }
}
