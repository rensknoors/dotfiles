import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, run, home, panes, terminals, readTextFile, openOverlay } from "herdr";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const KEEP = new Set(["main", "master", "dev", "develop"]);

/** origin's default branch (as gdel: origin/main), else a local main/master. */
async function baseRef(git) {
  const head = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim();
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if ((await git(["rev-parse", "--verify", "--quiet", ref])).code === 0) return ref;
  }
  return null;
}

/** Same rule as gdel in .zshrc: an ancestor of base, or Bitbucket's "Merged in <branch> (" on base after the branch's last commit. */
async function mergedSet(git, base, branches) {
  if (!base) return { merged: new Set(), mergedAt: {} };
  const [anc, log] = await Promise.all([
    git(["branch", "--format=%(refname:short)", "--merged", base]),
    git(["log", base, "-n", "3000", "--fixed-strings", "--grep=Merged in ", "--format=%ct%x09%s"]),
  ]);
  const merged = new Set(anc.code === 0 ? anc.stdout.split("\n").filter(Boolean) : []);
  const mergedAt = {};
  if (log.code === 0) for (const line of log.stdout.split("\n")) {
    const [ct, subject] = line.split("\t"), m = /Merged in (\S+) \(/.exec(subject ?? "");
    if (m && !(m[1] in mergedAt)) mergedAt[m[1]] = Number(ct);
  }
  for (const b of branches) if (mergedAt[b.name] && b.tip <= mergedAt[b.name]) merged.add(b.name);
  return { merged, mergedAt };
}
const UNITS = { second: "s", minute: "m", hour: "h", day: "d", week: "w", month: "mo", year: "y" };
const shortAge = (s) => { const m = /(\d+) (second|minute|hour|day|week|month|year)/.exec(s); return m ? m[1] + UNITS[m[2]] : s; };

/** Local branches (newest first) and the repo's worktrees, with dirty counts for each worktree. */
export async function loadBranches(root, on) {
  const git = (args, cwd = root) => exec("git", [...READ, ...args], { cwd, on });
  const [refs, list] = await Promise.all([
    git(["for-each-ref", "--sort=-committerdate", "--count=200",
      "--format=%(refname:short)%09%(upstream:short)%09%(upstream:track,nobracket)%09%(committerdate:relative)%09%(HEAD)%09%(worktreepath)%09%(committerdate:unix)%09%(contents:subject)",
      "refs/heads"]),
    git(["worktree", "list", "--porcelain"]),
  ]);
  const branches = refs.code !== 0 ? [] : refs.stdout.split("\n").filter(Boolean).map((line) => {
    const [name, upstream, track, age, head, worktree, tip, subject] = line.split("\t");
    return {
      name, upstream, tip: Number(tip), gone: track === "gone", age: shortAge(age), ageLong: age, head: head === "*", worktree, subject,
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
    };
  });
  const worktrees = [];
  if (list.code === 0) {
    let wt = null;
    for (const line of list.stdout.split("\n")) {
      if (line.startsWith("worktree ")) worktrees.push(wt = { path: line.slice(9), branch: null, head: "", sha: "", dirty: 0 });
      else if (!wt) continue;
      else if (line.startsWith("HEAD ")) { wt.sha = line.slice(5); wt.head = wt.sha.slice(0, 7); }
      else if (line.startsWith("branch ")) wt.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "bare") wt.bare = true;
      else if (line.startsWith("prunable")) wt.prunable = true;
      else if (line.startsWith("locked")) wt.locked = true;
    }
  }
  await Promise.all(worktrees.slice(0, 16).filter((w) => !w.bare && !w.prunable).map(async (w) => {
    const r = await git(["status", "--porcelain", "--untracked-files=normal"], w.path).catch(() => null);
    if (r?.code === 0) w.dirty = r.stdout.split("\n").filter(Boolean).length;
  }));
  const base = await baseRef(git), { merged, mergedAt } = await mergedSet(git, base, branches);
  for (const b of branches) b.merged = merged.has(b.name) && !KEEP.has(b.name) && b.name !== base?.replace(/^origin\//, "");
  const main = worktrees[0]?.path;
  await Promise.all(worktrees.map((w) => w.path === main || w.bare || w.prunable ? null : judgeWorktree(git, w, branches, base, mergedAt, on)));
  return { branches, worktrees, base, current: branches.find((b) => b.head)?.name ?? null };
}

/**
 * Decides whether a worktree can go without losing anything.
 * Its branch: the checked-out one, or for a detached worktree the name the branch-handover hook
 * (dotfiles claude/hooks/branch-handover.sh) left in <worktree git dir>/handover-branch.
 * Removable when it is clean, that branch is merged (gdel's rule), and its commit is either on some
 * branch or on base, or older than the branch's "Merged in" commit (the merge superseded it).
 * In that last case `backup` is set: the commit is kept under refs/worktree-backup/ before removal.
 */
async function judgeWorktree(git, w, branches, base, mergedAt, on) {
  if (!w.branch) {
    const dir = await git(["rev-parse", "--absolute-git-dir"], w.path).catch(() => null);
    const name = dir?.code === 0 ? await readTextFile(`${dir.stdout.trim()}/handover-branch`, { on }).catch(() => null) : null;
    w.owner = name?.trim() || null;
  } else w.owner = w.branch;
  if (w.dirty !== 0 || w.locked || !base || !w.sha) return;
  const ownerBranch = branches.find((b) => b.name === w.owner);
  const [onBase, refs, time] = await Promise.all([
    git(["merge-base", "--is-ancestor", w.sha, base]),
    git(["for-each-ref", "--count=1", "--format=%(refname)", "--contains", w.sha, "refs/heads", "refs/remotes"]),
    git(["log", "-1", "--format=%ct", w.sha]),
  ]);
  const reachable = onBase.code === 0 || (refs.code === 0 && Boolean(refs.stdout.trim()));
  const supersededAt = w.owner ? mergedAt[w.owner] : undefined;
  const superseded = Boolean(supersededAt) && Number(time.stdout.trim()) <= supersededAt;
  const ownerDone = ownerBranch ? ownerBranch.merged : onBase.code === 0 || superseded;
  if (w.owner && KEEP.has(w.owner)) return;
  w.merged = ownerDone && (reachable || superseded);
  w.backup = w.merged && !reachable;
}

/** A live terminal or pane whose folder is inside the worktree: an agent may still be using it. */
function inUse(path) {
  const inside = (cwd) => typeof cwd === "string" && (cwd === path || cwd.startsWith(path + "/"));
  return panes().some((p) => inside(p.cwd)) || terminals().some((t) => t.state !== "finished" && inside(t.cwd));
}

/** What a cleanup would remove: merged branches checked out nowhere (nor here), and clean merged worktrees other than the shown one. */
function candidates(data, root) {
  return {
    branches: data.branches.filter((b) => b.merged && !b.head && !b.worktree),
    worktrees: data.worktrees.filter((w) => w.merged && w.path !== root && !inUse(w.path)),
  };
}

/** Fetches base like gdel, re-checks everything, then deletes. Never forces: git refuses anything unmerged or dirty. */
async function cleanup(kind, root, on) {
  const git = (args, cwd = root) => exec("git", args, { cwd, on, timeout: 120000 });
  const base = await baseRef((a) => git([...READ, ...a]));
  if (base?.startsWith("origin/")) await git(["fetch", "origin", base.slice(7)]);
  const fresh = await loadBranches(root, on), todo = candidates(fresh, root), failed = [];
  if (kind === "worktrees") {
    const backups = [];
    for (const w of todo.worktrees) {
      if (w.backup) {
        const name = w.path.split("/").pop().replace(/[^\w.-]/g, "-");
        let ref = `refs/worktree-backup/${name}`;
        for (let i = 2; (await git(["rev-parse", "--verify", "--quiet", ref])).code === 0; i++) ref = `refs/worktree-backup/${name}-${i}`;
        const b = await git(["update-ref", "-m", `worktree cleanup: ${w.path} (${w.owner})`, ref, w.sha]);
        if (b.code !== 0) { failed.push(`${w.path}: could not back up ${w.head}, kept`); continue; }
        backups.push(ref.replace("refs/", ""));
      }
      const r = await git(["worktree", "remove", w.path]);
      if (r.code !== 0) { failed.push(`${w.path}: ${(r.stderr || r.stdout).trim()}`); continue; }
      // The branch goes too when it is merged and no other worktree has it.
      const owner = fresh.branches.find((b) => b.name === w.owner);
      if (owner?.merged && !owner.head && (!owner.worktree || owner.worktree === w.path)) {
        const d = await git(["branch", "-D", owner.name]);
        if (d.code !== 0) failed.push(`${owner.name}: ${(d.stderr || d.stdout).trim()}`);
      }
    }
    return { done: todo.worktrees.length - failed.filter((f) => f.startsWith("/")).length, failed, backups };
  }
  for (const b of todo.branches) {
    const r = await git(["branch", "-D", b.name]);
    if (r.code !== 0) failed.push(`${b.name}: ${(r.stderr || r.stdout).trim()}`);
  }
  return { done: todo.branches.length - failed.length, failed };
}

function openWorktree(path, on) {
  const space = spaces().find((s) => (s.machine ?? null) === (on ?? null) && s.folder && (s.folder === path || s.folder.startsWith(path + "/")));
  if (space) run("space.select", { id: space.id });
  else run("space.new", { folder: path, machine: on ?? "" });
}

const tilde = (path) => { const h = home(); return h && path.startsWith(h) ? "~" + path.slice(h.length) : path; };

const I = (name) => `mods/my-changes/icons/${name}.svg`;
export const TREE_ROW = 22;

/** The header action of BRANCHES / WORKTREES: "Delete N merged", then Cancel / Delete N to confirm. */
export function cleanupButton(view, kind, t, p) {
  const data = view.branchData;
  if (!view.root || !data) return null;
  const n = candidates(data, view.root)[kind].length;
  const ask = view.confirmDelete === kind, busy = view.cleaning === kind;
  // style: "danger" (tinted), "solid" (the confirm), "plain" (cancel).
  const btn = (id, label, style, onClick, icon) => {
    const red = p.deleted;
    const bg = style === "solid" ? red : style === "danger" ? red + "1f" : t.raised;
    const hoverBg = style === "solid" ? red + "d9" : style === "danger" ? red + "33" : t.hover;
    const fg = style === "solid" ? "#ffffff" : style === "danger" ? red : t.foreground;
    return h_flex().id(id).h(18).px(7).gap(4).items_center().rounded(4).border_1()
      .border_color(style === "plain" ? t.border : red + (style === "solid" ? "" : "59"))
      .bg(bg).text_size(10).font_semibold().text_color(fg).cursor_pointer()
      .hover((s) => s.bg(hoverBg)).active((s) => s.opacity(0.8))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .when(Boolean(icon), (e) => e.child(svg(icon).size(10).flex_none().text_color(fg)))
      .child(label);
  };
  const trash = "mods/my-changes/trash.svg";
  if (busy) return h_flex().h(18).px(6).gap(5).items_center().text_size(10).text_color(t.dim)
    .child(svg("mods/workspace-chrome/spinner.svg").size(10).text_color(t.dim).spin(900)).child("Deleting…");
  if (!n) return null;
  if (!ask) return btn(`clean-${kind}`, `Delete ${n} merged`, "danger", (cx) => { view.confirmDelete = kind; cx.notify(); }, trash);
  return h_flex().gap(4)
    .child(btn(`clean-${kind}-no`, "Cancel", "plain", (cx) => { view.confirmDelete = null; cx.notify(); }))
    .child(btn(`clean-${kind}-yes`, `Delete ${n}`, "solid", (cx) => {
      view.confirmDelete = null; view.cleaning = kind; view.cleanNote = null;
      const root = view.root, on = view.on;
      cx.spawn(async (cx) => {
        try {
          const r = await cleanup(kind, root, on);
          view.cleanNote = (r.failed.length ? `Deleted ${r.done}; skipped ${r.failed.length}: ${r.failed[0]}` : `Deleted ${r.done} ${kind === "worktrees" ? "worktree" : "branch"}${r.done === 1 ? "" : kind === "worktrees" ? "s" : "es"}`)
            + (r.backups?.length ? ` · old commits kept as ${r.backups.join(", ")}` : "");
        } catch (e) { view.cleanNote = `Cleanup failed: ${e}`; }
        finally { view.cleaning = null; view.refresh(cx); cx.notify(); }
      });
      cx.notify();
    }, trash));
}

// A GitLens-style tree row: indent, chevron slot, icon, label, dim description, then right-side bits.
function treeRow(id, depth, t) {
  return h_flex().id(id).h(TREE_ROW).flex_none().pl(8 + depth * 12).pr(8).gap(6).items_center().text_size(13).hover((s) => s.bg(t.hover));
}
const chevronSlot = (open, t) => open === undefined ? div().w(14).flex_none()
  : svg(I(open ? "chevron-down" : "chevron-right")).size(14).flex_none().text_color(t.muted);
const desc = (text, color) => div().flex_none().text_size(12).text_color(color).child(text);

/**
 * The BRANCHES tree, as GitLens shows it: branches grouped into folders by their "/" prefixes (folded until opened),
 * the current branch first with a ◎. Actions (check out, delete, open worktree) are in each branch's ⋯ menu.
 */
export function branchRows(view, t, p) {
  const data = view.branchData;
  if (!view.root || !data) return [];
  const meatball = (b) => {
    if (b.head) return svg(I("target")).size(13).flex_none().text_color(t.muted);
    const elsewhere = b.worktree && b.worktree !== view.root ? b.worktree : null;
    return div().id(`more-${b.name}`).w(18).h(18).flex_none().flex().items_center().justify_center().rounded(4)
      .text_size(13).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        // A worktree's branch can't be checked out or deleted here: its menu only opens the worktree.
        openOverlay({ mod: "git-branch-menu", kind: "popup", at: "pointer", width: 190, height: elsewhere ? 41 : 72,
          props: { root: view.root, on: view.on ?? null, branch: b.name, worktree: elsewhere } });
      })
      .child("⋯");
  };
  const branchRow = (b, label, depth) => {
    const elsewhere = b.worktree && b.worktree !== view.root;
    const track = b.gone ? desc("⇄ gone", p.deleted)
      : b.upstream ? desc(b.ahead || b.behind ? `${b.ahead ? `↑${b.ahead} ` : ""}${b.behind ? `↓${b.behind} ` : ""}${b.upstream}` : `⇄ ${b.upstream}`, t.dim) : null;
    return treeRow(`branch-${b.name}`, depth, t)
      .child(chevronSlot(undefined, t))
      .child(svg(b.head ? I("branch-check") : elsewhere ? "mods/my-changes/worktree.svg" : "mods/my-changes/branch.svg").size(14).flex_none().text_color(b.head ? p.added : t.muted))
      .child(div().flex_none().max_w(220).truncate().text_color(t.foreground).child(label))
      .child(h_flex().flex_1().min_w(0).gap(6).overflow_hidden()
        .when(Boolean(track), (e) => e.child(track))
        .when(b.merged, (e) => e.child(desc("merged", p.range)))
        .child(desc(`• ${b.ageLong}`, t.dim)))
      .child(meatball(b));
  };
  // Folder tree from the names; the current branch stays on top, outside any folder.
  const rootNode = { dirs: new Map(), leaves: [] };
  const current = data.branches.find((b) => b.head);
  for (const b of data.branches) {
    if (b === current) continue;
    const parts = b.name.split("/");
    let node = rootNode;
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), leaves: [] });
      node = node.dirs.get(dir);
    }
    node.leaves.push({ b, label: parts[parts.length - 1] });
  }
  const count = (node) => node.leaves.length + [...node.dirs.values()].reduce((n, d) => n + count(d), 0);
  const rows = current ? [branchRow(current, current.name, 0)] : [];
  const walk = (node, depth, prefix) => {
    for (const [dir, child] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
      const key = `dir:${prefix}${dir}`, open = Boolean(view.fold[key]);
      rows.push(treeRow(`dir-${prefix}${dir}`, depth, t).cursor_pointer()
        .on_click((_e, cx) => { view.fold[key] = !open; view.saveFold(); cx.notify(); })
        .child(chevronSlot(open, t))
        .child(svg(I("folder")).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(dir))
        .child(desc(String(count(child)), t.dim)));
      if (open) walk(child, depth + 1, `${prefix}${dir}/`);
    }
    for (const { b, label } of node.leaves) rows.push(branchRow(b, label, depth));
  };
  walk(rootNode, 0, "");
  return rows;
}

/** WORKTREES: one row each; a click opens (or creates) its space. */
export function worktreeRows(view, t, p) {
  const data = view.branchData;
  if (!view.root || !data) return [];
  return data.worktrees.map((w) => {
    const current = w.path === view.root;
    return treeRow(`wt-${w.path}`, 0, t).cursor_pointer().when(current, (e) => e.bg(t.selected))
      .on_click(() => openWorktree(w.path, view.on))
      .child(chevronSlot(undefined, t))
      .child(svg("mods/my-changes/worktree.svg").size(14).flex_none().text_color(current ? p.added : t.muted))
      .child(div().flex_none().max_w(200).truncate().text_color(t.foreground).child(w.branch ?? (w.owner ? `${w.owner} (detached)` : `detached ${w.head}`)))
      .child(h_flex().flex_1().min_w(0).gap(6).overflow_hidden()
        .child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(w.path === data.worktrees[0]?.path ? tilde(w.path) : w.path.split("/").pop()))
        .when(w.merged, (e) => e.child(desc(w.backup ? "merged · superseded" : "merged", p.range)))
        .when(w.merged && !current && inUse(w.path), (e) => e.child(desc("in use", p.modified)))
        .when(w.locked, (e) => e.child(desc("locked", t.dim)))
        .when(w.prunable, (e) => e.child(desc("prunable", p.deleted))))
      .when(w.dirty > 0, (e) => e.child(desc(`●${w.dirty}`, p.modified)))
      .when(current, (e) => e.child(svg(I("target")).size(13).flex_none().text_color(t.muted)));
  });
}
