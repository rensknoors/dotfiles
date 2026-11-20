// Branch actions for the Git panel (my-changes), opened as an overlay with props { root, on, mode, ... }:
//   mode "switch"            the branch select from the panel header: filter, ↑/↓, Enter; local and remote branches,
//                            and "Create branch" for a new name.
//   mode "menu" (default)    a branch's ⋯ menu: Check out, Delete branch ({ branch }); or Open worktree when another
//                            worktree has the branch checked out ({ branch, worktree }).
//   mode "commit"            the Commit ▾ menu: Commit, Commit & Push, Commit (Amend) ({ message, files }).
//   mode "force"             asks before `git branch -D` when `git branch -d` refused ({ branch, sha, lost }).
// After changing branches it bumps shared "git.branchesChanged" so the Git panel reloads.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { exec, props, closeOverlay, openOverlay, theme, notify, setShared, spaces, run, settings } from "herdr";

const TRASH = "mods/my-changes/trash.svg", BRANCH = "mods/my-changes/branch.svg", SPINNER = "mods/workspace-chrome/spinner.svg";
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const git = (p, args) => exec("git", args, { cwd: p.root, on: p.on ?? undefined, timeout: 60000 });
const message = (r) => (r.stderr || r.stdout).trim().split("\n").filter((l) => !l.startsWith("hint:")).join(" ");
const changed = () => setShared("git.branchesChanged", Date.now());
const UNITS = { second: "s", minute: "m", hour: "h", day: "d", week: "w", month: "mo", year: "y" };
const shortAge = (s) => { const m = /(\d+) (second|minute|hour|day|week|month|year)/.exec(s); return m ? m[1] + UNITS[m[2]] : s; };
const validName = (q) => /^[^\s~^:?*[\\]+$/.test(q) && !q.startsWith("-") && !q.endsWith("/") && !q.endsWith(".lock") && !q.includes("..");

function openWorktree(path, on) {
  const space = spaces().find((s) => (s.machine ?? null) === (on ?? null) && s.folder && (s.folder === path || s.folder.startsWith(path + "/")));
  if (space) run("space.select", { id: space.id });
  else run("space.new", { folder: path, machine: on ?? "" });
}

/** git switch for a select item: a local branch, a remote one (creates a tracking branch) or a new one. Throws git's message. */
async function switchBranch(p, item) {
  const args = item.kind === "create" ? ["switch", "-c", item.name]
    : item.kind === "remote" ? ["switch", "-c", item.name, "--track", item.ref]
    : ["switch", item.name];
  const r = await git(p, args);
  if (r.code !== 0) throw new Error(message(r));
  changed();
}

export default class GitBranchMenu extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.handle = cx.focus_handle();
    this.busy = null; this.error = null; this.at = 0;
    if (p.mode !== "switch") { this.handle.focus(); return; }
    this.query = ""; this.local = null; this.remotes = [];
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Find or create a branch…" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = 0; this.scroll.scroll_to_item(0); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.pick(this.items()[this.at], cx));
    this.input.focus();
    cx.spawn(async (cx) => {
      try {
        const [l, r] = await Promise.all([
          git(p, [...READ, "for-each-ref", "--sort=-committerdate", "--count=300", "--format=%(refname:short)%09%(HEAD)%09%(worktreepath)%09%(upstream:track,nobracket)%09%(committerdate:relative)", "refs/heads"]),
          git(p, [...READ, "for-each-ref", "--sort=-committerdate", "--count=400", "--format=%(refname:short)%09%(committerdate:relative)", "refs/remotes"]),
        ]);
        if (l.code !== 0) throw new Error(message(l));
        this.local = l.stdout.split("\n").filter(Boolean).map((line) => {
          const [name, head, worktree, track, age] = line.split("\t");
          return { kind: "local", name, head: head === "*", worktree: worktree && worktree !== p.root ? worktree : null, gone: track === "gone",
            ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0), age: shortAge(age) };
        });
        // The current branch first, the rest newest first.
        this.local.sort((a, b) => Number(b.head) - Number(a.head));
        const names = new Set(this.local.map((b) => b.name));
        if (r.code === 0) for (const line of r.stdout.split("\n").filter(Boolean)) {
          const [ref, age] = line.split("\t"), slash = ref.indexOf("/"), name = ref.slice(slash + 1);
          if (slash < 0 || !name || name === "HEAD" || names.has(name)) continue;
          names.add(name);
          this.remotes.push({ kind: "remote", name, ref, remote: ref.slice(0, slash), age: shortAge(age) });
        }
        // Start on the first branch that isn't the current one: Enter right away goes back to the previous branch.
        this.at = this.local.length > 1 && this.local[0].head ? 1 : 0;
      } catch (e) { this.error = String(e.message ?? e); this.local = []; }
      cx.notify();
    });
  }

  items() {
    if (!this.local) return [];
    const q = this.query.trim(), lq = q.toLowerCase(), match = (b) => !q || b.name.toLowerCase().includes(lq);
    const items = [...this.local.filter(match), ...this.remotes.filter(match).slice(0, q ? 100 : 30)];
    if (q && validName(q) && !this.local.some((b) => b.name === q) && !this.remotes.some((b) => b.name === q)) items.push({ kind: "create", name: q });
    return items;
  }

  pick(item, cx) {
    const p = props();
    if (!item || this.busy) return;
    if (item.head) { closeOverlay(p.overlay); return; }
    if (item.worktree) { closeOverlay(p.overlay); openWorktree(item.worktree, p.on); return; }
    this.busy = item.name; this.error = null;
    cx.spawn(async (cx) => {
      try { await switchBranch(p, item); closeOverlay(p.overlay); }
      catch (e) { this.error = String(e.message ?? e); }
      finally { this.busy = null; cx.notify(); }
    });
    cx.notify();
  }

  // ⋯ menu: Check out. Stays open until git is done (closing cancels pending calls); a refusal comes back as a toast.
  checkout(cx) {
    const p = props();
    if (this.busy) return;
    this.busy = "checkout";
    cx.spawn(async (cx) => {
      try { await switchBranch(p, { kind: "local", name: p.branch }); }
      catch (e) { notify({ title: `Couldn't check out ${p.branch}`, body: String(e.message ?? e), level: "error", timeout: 8000 }); }
      finally { this.busy = null; closeOverlay(p.overlay); }
    });
    cx.notify();
  }

  // ⋯ menu: safe delete; on "not fully merged", hand over to the force dialog with what would be lost.
  remove(cx) {
    const p = props();
    if (this.busy) return;
    this.busy = "delete";
    const fail = (text) => { closeOverlay(p.overlay); notify({ title: `Couldn't delete ${p.branch}`, body: text, level: "error", timeout: 8000 }); };
    cx.spawn(async (cx) => {
      try {
        const r = await git(p, ["branch", "-d", p.branch]);
        if (r.code === 0) {
          changed(); closeOverlay(p.overlay);
          notify({ title: `Deleted branch ${p.branch}`, level: "success", timeout: 4000 });
          return;
        }
        const text = message(r);
        if (!/not fully merged/i.test(text)) { fail(text); return; }
        const [sha, log] = await Promise.all([
          git(p, ["rev-parse", "--short", p.branch]),
          // What -d checks against: its upstream if it has one, else HEAD.
          git(p, ["log", "--format=%h %s", "-n", "6", p.branch, "--not", ...(await this.mergeTarget(p))]),
        ]);
        const lost = log.code === 0 ? log.stdout.trim().split("\n").filter(Boolean) : [];
        closeOverlay(p.overlay);
        openOverlay({
          mod: "git-branch-menu", kind: "dialog", width: 480, height: 210 + Math.max(lost.length, 1) * 19,
          props: { root: p.root, on: p.on, branch: p.branch, mode: "force", sha: sha.stdout.trim(), lost },
        });
      } catch (e) { fail(String(e.message ?? e)); }
      finally { this.busy = null; cx.notify(); }
    });
    cx.notify();
  }

  async mergeTarget(p) {
    const up = await git(p, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${p.branch}@{upstream}`]);
    return up.code === 0 && up.stdout.trim() ? [up.stdout.trim()] : ["HEAD"];
  }

  force(cx) {
    const p = props();
    if (this.busy) return;
    this.busy = "force"; this.error = null;
    cx.spawn(async (cx) => {
      try {
        const r = await git(p, ["branch", "-D", p.branch]);
        if (r.code !== 0) { this.error = message(r); return; }
        changed(); closeOverlay(p.overlay);
        notify({ title: `Force-deleted ${p.branch}`, body: p.sha ? `Restore with: git branch ${p.branch} ${p.sha}` : undefined, level: "success", timeout: 10000 });
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.busy = null; cx.notify(); }
    });
    cx.notify();
  }

  render(cx) {
    const p = props() ?? {};
    if (p.mode === "switch") return this.renderSwitch(p);
    if (p.mode === "force") return this.renderForce(p);
    if (p.mode === "commit") return this.renderCommit(p);
    return this.renderMenu(p);
  }

  renderSwitch(p) {
    const t = theme(), items = this.items(), at = Math.min(this.at, Math.max(items.length - 1, 0));
    const tag = (text, color) => div().flex_none().text_size(10).text_color(color).child(text);
    const move = (by) => { if (items.length) { this.at = (at + by + items.length) % items.length; this.scroll.scroll_to_item(this.at); } };
    const firstRemote = items.findIndex((i) => i.kind === "remote");
    const rows = items.map((item, i) => {
      const busy = this.busy === item.name;
      const icon = busy ? svg(SPINNER).size(12).flex_none().text_color(t.dim).spin(900)
        : item.kind === "create" ? div().w(12).flex_none().text_size(13).text_color(t.accent).child("+")
        : item.head ? div().w(12).flex_none().text_size(11).text_color(t.accent).child("✓")
        : svg(BRANCH).size(12).flex_none().text_color(item.kind === "remote" ? t.dim : t.muted);
      const row = h_flex().id(`opt-${item.kind}-${item.name}`).h(30).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .when(i === at, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.pick(item, cx))
        .child(icon)
        .child(div().flex_1().min_w(0).truncate().text_color(item.head || item.kind === "create" ? t.foreground : t.muted)
          .when(item.head, (e) => e.font_semibold())
          .child(item.kind === "create" ? `Create branch “${item.name}”` : item.name))
        .when(item.kind === "create", (e) => e.child(tag(`from ${this.local.find((b) => b.head)?.name ?? "HEAD"}`, t.dim)))
        .when(Boolean(item.worktree), (e) => e.child(tag("worktree ↗", t.ansi3)))
        .when(Boolean(item.gone), (e) => e.child(tag("gone", t.ansi1)))
        .when(item.ahead > 0, (e) => e.child(tag(`↑${item.ahead}`, t.ansi2)))
        .when(item.behind > 0, (e) => e.child(tag(`↓${item.behind}`, t.ansi1)))
        .when(item.kind === "remote", (e) => e.child(tag(item.remote, t.dim)))
        .when(Boolean(item.age), (e) => e.child(div().w(28).flex_none().text_right().text_size(10).text_color(t.dim).child(item.age)));
      if (i !== firstRemote) return row;
      return v_flex().flex_none()
        .child(div().h(24).px(8).pt(8).text_size(10).font_bold().text_color(t.dim).child("REMOTE"))
        .child(row);
    });
    return v_flex().id("switch").size_full().min_h(0).bg(t.popover).text_size(12.5)
      .on_key_down((e, cx) => {
        if (e.key === "down") move(1);
        else if (e.key === "up") move(-1);
        else if (e.key === "escape") { closeOverlay(p.overlay); }
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(40).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg(BRANCH).size(13).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).h_full().flex().items_center().child(Input.new(this.input).w_full().text_size(12.5).text_color(t.foreground)))
        .child(div().text_size(10).text_color(t.dim).child("↑↓ ⏎")))
      .child(div().h(this.error ? 290 : 330).flex_none().relative()        .child(v_flex().id("options").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll).p(5).children(rows)
          .when(!items.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.local ? "No matching branch" : "Loading branches…")))))
      // Fixed 40px so the popup (372px high) never clips it; the list gives up the room.
      .when(Boolean(this.error), (e) => e.child(div().id("switch-error").h(40).flex_none().px(12).flex().items_center().border_t(1).border_color(t.border)
        .text_size(11).text_color(t.ansi1).overflow_hidden().child(this.error)));
  }

  // Commit ▾: stages everything like the Commit button. Amend without a message keeps the last one.
  commitAs(kind, cx) {
    const p = props();
    if (this.busy) return;
    const title = kind === "amend" ? "Amend" : kind === "push" ? "Commit & Push" : "Commit";
    // Stays open (with a spinner) until git is done: closing a mod copy cancels its pending calls.
    this.busy = kind;
    cx.spawn(async (cx) => {
      try {
        const steps = [["add", "-A"], kind === "amend" ? ["commit", "--amend", ...(p.message ? ["-m", p.message] : ["--no-edit"])] : ["commit", "-m", p.message]];
        for (const args of steps) { const r = await git(p, args); if (r.code !== 0) throw new Error(message(r)); }
        setShared("git.committed", Date.now()); changed();
        if (kind === "push") {
          this.busy = "pushing"; cx.notify();
          const up = await git(p, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
          const r = await exec("git", up.code === 0 ? ["push"] : ["push", "-u", "origin", "HEAD"], { cwd: p.root, on: p.on ?? undefined, timeout: 180000 });
          if (r.code !== 0) throw new Error(`Committed, but push failed: ${message(r)}`);
          changed();
          notify({ title: "Committed and pushed", level: "success", timeout: 4000 });
        }
      } catch (e) { notify({ title: `${title} failed`, body: String(e.message ?? e), level: "error", timeout: 10000 }); }
      finally { this.busy = null; closeOverlay(p.overlay); }
    });
    cx.notify();
  }

  renderCommit(p) {
    const t = theme(), ready = Boolean(p.message && p.files);
    const entries = [
      { id: "commit", label: "Commit", icon: "mods/my-changes/icons/check.svg", ok: ready, kind: "commit" },
      { id: "push", label: "Commit & Push", icon: "mods/my-changes/icons/push.svg", ok: ready, kind: "push" },
      { id: "amend", label: p.message ? "Commit (Amend)" : "Amend (keep message)", icon: "mods/my-changes/icons/commit.svg", ok: true, kind: "amend" },
    ];
    const at = Math.min(this.at, entries.length - 1);
    return v_flex().id("commit-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (at + 1) % entries.length;
        else if (e.key === "up") this.at = (at + entries.length - 1) % entries.length;
        else if (e.key === "enter") { if (entries[at].ok) this.commitAs(entries[at].kind, cx); }
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .children(entries.map((x, i) => h_flex().id(x.id).h(31).px(8).gap(9).rounded(7).items_center()
        .text_color(x.ok ? t.foreground : t.dim)
        .when(x.ok, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).when(i === at, (e) => e.bg(t.selected)))
        .on_click((_e, cx) => { if (x.ok) this.commitAs(x.kind, cx); })
        .child(this.busy === x.kind || (this.busy === "pushing" && x.kind === "push") ? svg(SPINNER).size(14).flex_none().text_color(t.dim).spin(900) : svg(x.icon).size(14).flex_none().text_color(x.ok ? t.muted : t.dim))
        .child(div().flex_1().child(this.busy === "pushing" && x.kind === "push" ? "Pushing…" : x.label))));
  }

  renderMenu(p) {
    const t = theme(), red = t.ansi1;
    const entries = p.worktree
      ? [{ id: "open", label: "Open worktree", icon: "mods/my-changes/worktree.svg", go: () => { closeOverlay(p.overlay); openWorktree(p.worktree, p.on); } }]
      : [{ id: "checkout", label: this.busy === "checkout" ? "Checking out…" : "Check out", icon: BRANCH, go: (cx) => this.checkout(cx) },
         { id: "delete", label: this.busy === "delete" ? "Deleting…" : "Delete branch", icon: TRASH, danger: true, go: (cx) => this.remove(cx) }];
    const at = Math.min(this.at, entries.length - 1);
    return v_flex().id("branch-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (at + 1) % entries.length;
        else if (e.key === "up") this.at = (at + entries.length - 1) % entries.length;
        else if (e.key === "enter") entries[at].go(cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .children(entries.map((x, i) => h_flex().id(x.id).h(31).px(8).gap(9).rounded(7).items_center().cursor_pointer()
        .when(i === at, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
        .text_color(x.danger ? red : t.foreground).on_click((_e, cx) => x.go(cx))
        .child(x.danger && this.busy === "delete" ? svg(SPINNER).size(14).flex_none().text_color(t.dim).spin(900) : svg(x.icon).size(14).flex_none().text_color(x.danger ? red : t.muted))
        .child(div().flex_1().child(x.label))));
  }

  renderForce(p) {
    const t = theme(), red = t.ansi1;
    const button = (id, label, solid, onClick) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(solid ? red : t.input).bg(solid ? red : t.raised).text_color(solid ? "#ffffff" : t.foreground)
      .cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx)).child(label);
    return v_flex().id("force").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.force(cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full().min_h(0).p(18).gap(10).rounded(8).bg(t.popover).text_size(13)
      .child(h_flex().items_center().gap(8)
        .child(svg(TRASH).size(15).flex_none().text_color(red))
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(`Force delete ${p.branch}?`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child("This branch isn't fully merged. Deleting it drops these commits from every branch:"))
      .child(v_flex().flex_none().gap(2).px(10).py(6).rounded(6).bg(t.raised).text_size(11.5).font_family(settings().font_family ?? "JetBrains Mono")
        .children((p.lost?.length ? p.lost : ["(commits not on its upstream or HEAD)"]).map((l, i) => div().id(`lost-${i}`).truncate().text_color(t.foreground).child(l))))
      .when(Boolean(p.sha), (e) => e.child(div().text_size(11).text_color(t.dim).child(`Tip ${p.sha} stays in the reflog for a while if you change your mind.`)))
      .when(Boolean(this.error), (e) => e.child(div().text_size(11).text_color(red).child(this.error)))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(button("no", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("yes", this.busy === "force" ? "Deleting…" : "Force delete", true, (cx) => this.force(cx))));
  }
}
