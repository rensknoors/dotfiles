// The Git panel, laid out like VS Code's Source Control view: foldable CHANGES (message, Commit, changed files),
// GRAPH (HEAD's history with Fetch / Pull / Push) and GitLens-style BRANCHES and WORKTREES.
// A changed file or commit opens its diff in a git-diff pane beside the terminal (one per tab, reused).
// Branch actions, the branch select and the Commit ▾ menu are in git-branch-menu.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, shared, setShared, openOverlay, run, checking } from "herdr";
import { loadBranches, branchRows, worktreeRows, cleanupButton, TREE_ROW } from "./branches.js";
import { loadGraph, graphRows, graphActions, GRAPH_ROW } from "./graph.js";

const I = (name) => name === "spinner" ? "mods/workspace-chrome/spinner.svg" : `mods/my-changes/icons/${name}.svg`;

// The repo is where the focused terminal is. A mod pane (the diff itself) has no folder: use its tab's terminal,
// so opening a diff never moves the panel to another repo.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const cwd = pane?.cwd || (pane ? panes().find((p) => p.tab === pane.tab && p.cwd)?.cwd : null) || f?.cwd || space?.folder;
  return { cwd, on };
}
const key = () => JSON.stringify(location());
const activeTab = () => spaces().find((s) => s.active)?.tabs.find((t) => t.active)?.id ?? null;
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const SECTIONS = { changes: true, graph: true, branches: true, worktrees: false };

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.graph = []; this.message = ""; this.handle = cx.focus_handle();
    this.branchData = null; this.branchesChanged = shared("git.branchesChanged"); this.committed = shared("git.committed");
    // Its placeholder names the branch, which changes: the panel draws it under the (transparent) input instead.
    this.input = InputState.new({ placeholder: "" });
    this.input.on("change", (_e, cx) => {
      const had = Boolean(this.message);
      this.message = this.input.value();
      if (had !== Boolean(this.message) || had !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    try { this.fold = { ...SECTIONS, ...JSON.parse(localStorage.getItem("sections") ?? "{}") }; } catch { this.fold = { ...SECTIONS }; }
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  saveFold() { try { localStorage.setItem("sections", JSON.stringify(this.fold)); } catch {} }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) this.refresh(cx); } }
      catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.graph = []; this.branchData = null;
      this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.graphNote = null; this.watched = null; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.branchData = null; this.files = []; this.graph = []; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0) };
          }
        }
        const entries = status.stdout.split("\0").filter(Boolean), files = [];
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          // VS Code's letters: U untracked, A added, M modified, D deleted, ! conflict.
          const s = conflict ? "!" : xy.includes("D") ? "D" : fresh ? "U" : xy.includes("A") ? "A" : "M";
          files.push({ path, status: s, ...(stats[path] ?? { add: 0, del: 0 }) });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        const [data, graph] = await Promise.all([loadBranches(root, on).catch(() => null), head.code === 0 ? loadGraph(root, on).catch(() => []) : []]);
        if (key() === context) { if (data) this.branchData = data; this.graph = graph; }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  /** Shows a file or commit in this tab's git-diff pane, splitting one off to the right the first time. */
  openDiff(target) {
    const tab = activeTab();
    if (!tab || !this.root) return;
    setShared(`git.diff.${tab}`, { root: this.root, on: this.on ?? null, ...target });
    if (!panes().some((p) => p.tab === tab && p.mod === "git-diff")) run("pane.split", { direction: "right", mod: "git-diff", props: { tab } });
  }

  shownDiff() {
    const tab = activeTab(), d = tab ? shared(`git.diff.${tab}`) : null;
    return d && d.root === this.root && panes().some((p) => p.tab === tab && p.mod === "git-diff") ? d : null;
  }

  commit(cx) {
    if (!this.canCommit()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e.message ?? e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  canCommit() { return Boolean(this.message.trim() && this.root && this.files.length && !this.busy && !this.loading && this.context === key()); }

  iconButton(id, icon, _label, onClick) {
    const t = theme();
    return div().id(id).size(20).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(icon === "spinner" ? svg(I("spinner")).size(13).spin(900) : svg(I(icon)).size(14));
  }

  // A VS Code view-pane header: chevron, bold uppercase title, actions on the right.
  section(id, title, actions, body, size) {
    const t = theme(), open = this.fold[id];
    const head = h_flex().id(`sec-${id}`).h(24).flex_none().pl(4).pr(6).gap(2).items_center().cursor_pointer()
      .when(id !== "changes", (e) => e.border_t(1).border_color(t.border))
      .on_click((_e, cx) => { this.fold[id] = !open; this.saveFold(); cx.notify(); })
      .child(svg(I(open ? "chevron-down" : "chevron-right")).size(16).flex_none().text_color(t.foreground))
      .child(div().flex_1().min_w(0).truncate().text_size(11).font_bold().text_color(t.foreground).child(title))
      .when(open, (e) => e.children(actions.filter(Boolean)));
    const grow = size === "grow";
    return v_flex().flex_none().when(grow && open, (e) => e.flex_1().min_h(0)).child(head)
      .when(open, (e) => e.child(grow ? body.flex_1().min_h(0) : body.h(size).flex_none()));
  }

  scrollList(id, rows) {
    return div().relative().child(v_flex().id(id).absolute().inset_0().overflow_y_scroll().children(rows));
  }

  branchSelect(t) {
    const data = this.branchData;
    if (!this.root || !data) return null;
    const name = data.current ?? `detached ${data.worktrees.find((w) => w.path === this.root)?.head ?? ""}`;
    return h_flex().id("branch-select").h(20).max_w(170).px(6).gap(4).items_center().rounded(4).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "git-branch-menu", kind: "popup", at: "pointer", width: 380, height: 372, props: { mode: "switch", root: this.root, on: this.on ?? null } });
      })
      .child(svg("mods/my-changes/branch.svg").size(12).flex_none())
      .child(div().min_w(0).truncate().text_size(11).child(name))
      .child(svg(I("chevron-down")).size(11).flex_none());
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    // git-branch-menu bumps these after changing branches or committing. While a load runs, the next render retries.
    const changed = shared("git.branchesChanged"), committed = shared("git.committed");
    if (committed !== this.committed) { this.committed = committed; this.message = ""; this.input.set_value(""); }
    if (changed !== this.branchesChanged && !this.loading && !this.busy) { this.branchesChanged = changed; this.refresh(cx); }
    const t = theme(), p = { added: t.ansi2, deleted: t.ansi1, modified: t.ansi3, range: t.ansi5 };
    const statusColor = { M: p.modified, A: p.added, U: p.added, D: p.deleted, "!": p.deleted };
    const shown = this.shownDiff(), branch = this.branchData?.current;

    // CHANGES: message, Commit (▾ for more), then the "Changes" group with its files.
    const enabled = this.canCommit(), purple = t.ansi5, buttonBg = enabled ? purple + "b3" : purple + "40", buttonFg = enabled ? "#ffffff" : t.dim;
    const fileRows = this.files.map((f) => {
      const parts = f.path.split("/"), name = parts.pop();
      return h_flex().id(`change-${f.path}`).h(22).flex_none().pl(22).pr(10).gap(6).items_center().cursor_pointer()
        .when(shown?.path === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click(() => this.openDiff({ path: f.path }))
        .child(svg(I("file")).size(14).flex_none().text_color(statusColor[f.status]))
        .child(div().flex_none().max_w(200).truncate().text_color(f.status === "D" ? t.dim : t.foreground).child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(parts.join("/")))
        .when(f.add > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(p.added).child(`+${f.add}`)))
        .when(f.del > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(p.deleted).child(`−${f.del}`)))
        .child(div().w(12).flex_none().text_right().text_size(12).font_semibold().text_color(statusColor[f.status]).child(f.status));
    });
    const groupOpen = this.fold.group !== false;
    const changesBody = v_flex()
      .child(v_flex().flex_none().px(12).pt(4).pb(8).gap(6)
        .child(div().id("commit-message").relative().h(28).px(8).flex().items_center().rounded(3).border_1().border_color(this.typing ? t.ansi4 : t.input).bg(t.surface)
          .cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .when(!this.message, (e) => e.child(div().absolute().left(8).right(8).top(0).bottom(0).flex().items_center().text_size(12.5).text_color(t.dim)
            .child(div().truncate().child(`Message (⏎ to commit on "${branch ?? "HEAD"}")`))))
          .child(Input.new(this.input).h_full().w_full().text_size(12.5).text_color(t.foreground)))
        .child(h_flex().h(28).rounded(3).bg(buttonBg).text_color(buttonFg).overflow_hidden()
          .child(h_flex().id("commit").flex_1().h_full().gap(6).items_center().justify_center().text_size(12.5)
            .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg("#ffffff14")))
            .on_click((_e, cx) => this.commit(cx))
            .child(this.busy ? svg(I("spinner")).size(13).spin(900) : svg(I("check")).size(14)).child(this.busy ? "Committing…" : "Commit"))
          .child(div().w(1).h(16).bg(buttonFg + "55"))
          .child(div().id("commit-more").w(28).h_full().flex().items_center().justify_center().cursor_pointer().hover((s) => s.bg("#ffffff14"))
            .on_click(() => this.root && openOverlay({ mod: "git-branch-menu", kind: "popup", at: "pointer", width: 220, height: 103,
              props: { mode: "commit", root: this.root, on: this.on ?? null, message: this.message.trim(), files: this.files.length } }))
            .child(svg(I("chevron-down")).size(14))))
        .when(Boolean(this.note), (e) => e.child(div().text_size(11).text_color(p.deleted).child(this.note))))
      .when(this.files.length > 0, (e) => e
        .child(h_flex().id("group-changes").h(22).flex_none().pl(4).pr(10).gap(2).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.fold.group = !groupOpen; this.saveFold(); cx.notify(); })
          .child(svg(I(groupOpen ? "chevron-down" : "chevron-right")).size(16).flex_none().text_color(t.foreground))
          .child(div().flex_1().text_size(12.5).font_semibold().child("Changes"))
          .child(div().h(16).min_w(16).px(5).flex().items_center().justify_center().rounded(8).bg(t.raised).text_size(10.5).text_color(t.foreground).child(String(this.files.length))))
        .when(groupOpen, (e) => e.child(this.scrollList("changes-list", fileRows).flex_1().min_h(0))))
      .when(this.limited, (e) => e.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .when(!this.files.length && Boolean(this.error || !this.root), (e) => e.child(div().px(12).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading…" : "No folder"))));

    const graph = graphRows(this, t, shown?.commit, (c) => this.openDiff({ commit: c.sha }));
    const graphBody = v_flex().child(this.scrollList("graph-list", graph).flex_1().min_h(0))
      .when(Boolean(this.graphNote), (e) => e.child(div().px(12).py(4).text_size(11).text_color(p.deleted).child(this.graphNote)));
    const branches = branchRows(this, t, p), worktrees = worktreeRows(this, t, p);
    const listHeight = (n, max, row) => Math.min(Math.max(n, 1), max) * row + 4;

    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); } })
      .child(this.section("changes", "CHANGES", [this.branchSelect(t)], changesBody, "grow"))
      .when(Boolean(this.root), (e) => e
        .child(this.section("graph", "GRAPH", graphActions(this, t, (...a) => this.iconButton(...a)), graphBody, listHeight(graph.length, 8, GRAPH_ROW) + (this.graphNote ? 24 : 0)))
        .child(this.section("branches", `BRANCHES (${this.branchData?.branches.length ?? 0})`, [cleanupButton(this, "branches", t, p)],
          this.scrollList("branch-list", branches), listHeight(branches.length, 10, TREE_ROW)))
        .child(this.section("worktrees", `WORKTREES (${this.branchData?.worktrees.length ?? 0})`, [cleanupButton(this, "worktrees", t, p)],
          this.scrollList("worktree-list", worktrees), listHeight(worktrees.length, 6, TREE_ROW)))
        .when(Boolean(this.cleanNote), (e) => e.child(div().px(12).py(4).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child(this.cleanNote))))
      // Folded sections stack at the top, VS Code-style; the rest of the height stays empty.
      .when(!this.fold.changes, (e) => e.child(div().flex_1()));
  }
}
