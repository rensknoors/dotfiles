// The GRAPH section: HEAD's history along its first parents (one lane, like VS Code's graph on a branch),
// with ref badges, and Fetch / Pull / Push / Refresh in the section header.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const I = (name) => `mods/my-changes/icons/${name}.svg`;
export const GRAPH_ROW = 22;

/** The last 80 commits on HEAD's first-parent line, each with its local and remote refs. */
export async function loadGraph(root, on) {
  const r = await exec("git", [...READ, "log", "--first-parent", "-n", "80", "--format=%H%x1f%h%x1f%D%x1f%s%x1f%an%x1f%cr%x1f%P", "HEAD"], { cwd: root, on });
  if (r.code !== 0) return [];
  return r.stdout.split("\n").filter(Boolean).map((line) => {
    const [sha, short, refs, subject, author, age, parents] = line.split("\x1f");
    const local = [], remote = [], tags = [];
    let head = false;
    for (const ref of refs ? refs.split(", ") : []) {
      if (ref === "HEAD") head = true;
      else if (ref.startsWith("HEAD -> ")) { head = true; local.push(ref.slice(8)); }
      else if (ref.startsWith("tag: ")) tags.push(ref.slice(5));
      else if (ref.includes("/") && !ref.endsWith("/HEAD") && /^[^/]+\//.test(ref) && !local.includes(ref)) remote.push(ref);
      else if (!ref.endsWith("/HEAD")) local.push(ref);
    }
    // A remote ref that's a local branch's own upstream name merges into that badge (shown as a cloud on it).
    const badges = local.map((name) => ({ name, synced: remote.some((x) => x.replace(/^[^/]+\//, "") === name) }));
    const extra = remote.filter((x) => !local.includes(x.replace(/^[^/]+\//, "")));
    return { sha, short, subject, author, age, head, badges, remotes: extra, tags, merge: parents.split(" ").length > 1 };
  }).filter((c, i, all) => all.findIndex((x) => x.sha === c.sha) === i);
}

/** Fetch, pull and push, with what a missing upstream needs for push. Throws git's message. */
export async function sync(kind, root, on) {
  const git = (args) => exec("git", args, { cwd: root, on, timeout: 180000 });
  let args = kind === "fetch" ? ["fetch", "--all", "--prune"] : kind === "pull" ? ["pull"] : ["push"];
  if (kind === "push" && (await git(["rev-parse", "--abbrev-ref", "@{upstream}"])).code !== 0) args = ["push", "-u", "origin", "HEAD"];
  const r = await git(args);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").filter((l) => !l.startsWith("hint:")).slice(-2).join(" "));
}

export function graphActions(view, t, iconButton) {
  const busy = view.syncing;
  const run = (kind) => (cx) => {
    if (view.syncing || !view.root) return;
    view.syncing = kind; view.graphNote = null;
    const root = view.root, on = view.on;
    cx.spawn(async (cx) => {
      try { await sync(kind, root, on); }
      catch (e) { view.graphNote = `${kind[0].toUpperCase() + kind.slice(1)} failed: ${e.message ?? e}`; }
      finally { view.syncing = null; view.refresh(cx); cx.notify(); }
    });
    cx.notify();
  };
  return [
    iconButton("g-fetch", busy === "fetch" ? "spinner" : "fetch", "Fetch", run("fetch")),
    iconButton("g-pull", busy === "pull" ? "spinner" : "pull", "Pull", run("pull")),
    iconButton("g-push", busy === "push" ? "spinner" : "push", "Push", run("push")),
    iconButton("g-refresh", view.loading ? "spinner" : "refresh", "Refresh", (cx) => view.refresh(cx)),
  ];
}

/** One row per commit: the lane (line + dot; HEAD hollow), subject, then badges. */
export function graphRows(view, t, selected, open) {
  const commits = view.graph ?? [], lane = t.ansi12 ?? t.ansi4;
  return commits.map((c, i) => {
    const dot = c.head
      ? div().absolute().left(2).top(5).size(12).rounded(6).border_2().border_color(lane).bg(t.background)
      : div().absolute().left(4).top(7).size(8).rounded(4).bg(lane);
    const laneEl = div().relative().w(16).h(GRAPH_ROW).flex_none()
      .when(i > 0, (e) => e.child(div().absolute().left(7).top(0).w(2).h(GRAPH_ROW / 2).bg(lane)))
      .when(i < commits.length - 1, (e) => e.child(div().absolute().left(7).top(GRAPH_ROW / 2).w(2).h(GRAPH_ROW / 2).bg(lane)))
      .child(dot);
    const badge = (b) => h_flex().flex_none().h(16).px(5).gap(3).items_center().rounded(8).bg(lane).text_color(t.background).text_size(10.5).font_semibold()
      .child(svg(I("target")).size(10).flex_none()).child(b.name)
      .when(b.synced, (e) => e.child(svg(I("cloud")).size(10).flex_none()));
    const remoteBadge = (name) => h_flex().flex_none().h(16).px(5).gap(3).items_center().rounded(8).border_1().border_color(lane).text_color(lane).text_size(10.5)
      .child(svg(I("cloud")).size(10).flex_none()).child(name);
    return h_flex().id(`commit-${c.sha}`).h(GRAPH_ROW).flex_none().pl(10).pr(8).gap(6).items_center().cursor_pointer()
      .when(selected === c.sha, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click(() => open(c))
      .child(laneEl)
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).when(c.head, (e) => e.font_bold()).child(c.subject))
      .children(c.badges.map(badge))
      .children(c.remotes.slice(0, 2).map(remoteBadge))
      .children(c.tags.slice(0, 1).map((name) => div().flex_none().text_size(10).text_color(t.dim).child(`🏷 ${name}`)));
  });
}
