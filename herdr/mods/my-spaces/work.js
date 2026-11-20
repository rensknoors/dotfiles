// In-progress work under a repo's space: the branches agents are working on in that repo, as a flat
// list, nested only where one is stacked on another. Agents on the default branch belong to the space
// row itself (the space stands for main/master). A row shows each agent's status and the branch's pull
// request (GitHub, via `gh`); clicking it goes to the agent. Bitbucket repos show no PRs yet.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, hc, run, agents, panes, terminals, readTextFile, home } from "herdr";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const PR_EVERY = 120000; // PR states change on someone else's clock: ask GitHub at most this often per repo.
const AGENTS_EVERY = 15000; // re-read agents' branches this often even when nothing visible changed
const URGENCY = { blocked: 0, done: 1, working: 2, idle: 3 };
const urgency = (a) => URGENCY[a.status] ?? 4;

/** "owner/repo" for a github.com remote, else null. */
function githubSlug(url) {
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * The repo's default branch, the ref stacks are measured from (origin's copy when there is one: merges
 * land there first), and its GitHub slug.
 */
async function scanRepo(cwd, on) {
  const git = (args) => exec("git", [...READ, ...args], { cwd, on });
  const [head, remote] = await Promise.all([
    git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]),
    git(["remote", "get-url", "origin"]),
  ]);
  let main = head.code === 0 ? head.stdout.trim().replace(/^origin\//, "") : "";
  if (!main) main = (await git(["rev-parse", "--verify", "--quiet", "main"])).code === 0 ? "main" : "master";
  const origin = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${main}`]);
  return {
    main: { name: main },
    base: origin.code === 0 ? `refs/remotes/origin/${main}` : `refs/heads/${main}`,
    github: remote.code === 0 ? githubSlug(remote.stdout) : null,
  };
}

/**
 * Each branch's stack: the other local branches it is built on that `base` doesn't have yet, nearest
 * last. A branch with nothing under it (branched off main) is left out.
 */
async function scanStacks(cwd, on, base, main, branches) {
  const git = (args) => exec("git", [...READ, ...args], { cwd, on });
  const out = {};
  await Promise.all(branches.map(async (b) => {
    const r = await git(["for-each-ref", `--merged=refs/heads/${b}`, `--no-merged=${base}`, "--format=%(objectname) %(refname:short)", "refs/heads"]);
    if (r.code !== 0) return;
    const refs = r.stdout.split("\n").filter(Boolean).map((l) => ({ sha: l.slice(0, l.indexOf(" ")), name: l.slice(l.indexOf(" ") + 1) }));
    const tip = refs.find((x) => x.name === b)?.sha;
    // A branch just made from another (same commit) isn't stacked yet; local main ahead of origin isn't a stack.
    const under = refs.filter((x) => x.name !== b && x.name !== main && x.sha !== tip);
    if (!under.length) return;
    const depth = await Promise.all(under.map((x) => git(["rev-list", "--count", `${base}..${x.sha}`])));
    // Ties go by name, so every stack orders shared branches alike and parents never loop.
    out[b] = under.map((x, i) => ({ name: x.name, n: Number(depth[i].stdout.trim()) || 0 }))
      .sort((p, q) => p.n - q.n || p.name.localeCompare(q.name)).map((x) => x.name);
  }));
  return out;
}

/**
 * An agent's repo and branch, from its folder. A worktree detached by the branch-handover hook
 * (dotfiles claude/hooks/branch-handover.sh) still belongs to the branch it saved in handover-branch.
 */
async function agentGit(cwd, on) {
  const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--absolute-git-dir", "--abbrev-ref", "HEAD"], { cwd, on });
  if (r.code !== 0) return null;
  const [common, gitDir, ref] = r.stdout.split("\n");
  let branch = ref, detached = false;
  if (ref === "HEAD") {
    detached = true;
    const saved = await readTextFile(`${gitDir}/handover-branch`, { on }).catch(() => null);
    branch = saved?.trim() || null;
    if (!branch) {
      const sha = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd, on });
      branch = `detached ${sha.stdout.trim()}`;
    }
  }
  return { repo: JSON.stringify([on, common]), branch, detached };
}

/**
 * Where a Claude Code session works now, from Claude's own records: ~/.claude/sessions/<pid>.json names
 * the session, and its transcript's latest entries carry the session's cwd (a worktree after EnterWorktree,
 * which never changes the process's folder). Used until the herdr-location hook has labelled the terminal.
 */
async function claudeCwd(pid) {
  const h = home();
  const info = await readTextFile(`${h}/.claude/sessions/${pid}.json`).catch(() => null);
  if (!info) return null;
  const { sessionId, cwd } = JSON.parse(info);
  if (!sessionId || !cwd) return null;
  const transcript = `${h}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}/${sessionId}.jsonl`;
  const tail = await exec("tail", ["-c", "131072", transcript]).catch(() => null);
  if (tail?.code !== 0) return cwd;
  const lines = tail.stdout.split("\n");
  for (let i = lines.length - 1; i > 0; i--) {
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(lines[i]);
    if (m) return JSON.parse(`"${m[1]}"`);
  }
  return cwd;
}

/** Open PRs by head branch, from GitHub. */
async function scanPulls(slug, on) {
  const r = await exec("gh", ["pr", "list", "-R", slug, "--state", "open", "--limit", "100",
    "--json", "number,title,headRefName,isDraft,reviewDecision,mergeStateStatus,url,statusCheckRollup"], { on, timeout: 20000 });
  if (r.code !== 0) throw new Error(r.stderr.trim() || "gh pr list failed");
  const out = {};
  for (const pr of JSON.parse(r.stdout)) out[pr.headRefName] = { ...pr, state: prState(pr), checks: checks(pr.statusCheckRollup) };
  return out;
}

/** draft; changes requested; merge conflicts; approved = ready; anything else = waiting for review. */
function prState(pr) {
  if (pr.isDraft) return "draft";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "changes";
  if (pr.mergeStateStatus === "DIRTY") return "conflicts";
  if (pr.reviewDecision === "APPROVED") return "ready";
  return "review";
}

function checks(rollup) {
  if (!rollup?.length) return null;
  const states = rollup.map((c) => (c.conclusion || c.state || c.status || "").toUpperCase());
  if (states.some((s) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(s))) return "fail";
  if (states.some((s) => ["PENDING", "IN_PROGRESS", "QUEUED", "EXPECTED", "WAITING"].includes(s))) return "pending";
  return "pass";
}

const LABEL = { draft: "Draft", review: "In review", changes: "Changes", conflicts: "Conflicts", ready: "Ready" };
const PREFIX = /^(feature|feat|fix|bugfix|hotfix|chore|claude|rebase)\//;

export class Work {
  constructor() {
    this.repos = {}; // repo key -> { main, base, github, cwd, on, pulls, pullsAt, stacks, stackSig }
    this.agents = {}; // agent address -> { cwd, repo, branch, detached }
    this.busy = new Set();
    this.agentSig = "";
    this.agentsAt = 0;
  }

  /** Called after the space list re-read a repo's git (a commit, checkout, fetch...). */
  refresh(repoKey, cwd, on, cx) {
    if (this.busy.has(repoKey)) return;
    this.busy.add(repoKey);
    cx.spawn(async (cx) => {
      try {
        const old = this.repos[repoKey];
        // stackSig null: refs moved, so the stacks are read again whatever branches are worked on.
        this.repos[repoKey] = { ...(await scanRepo(cwd, on)), cwd, on, pulls: old?.pulls ?? {}, pullsAt: old?.pullsAt ?? 0, stacks: old?.stacks ?? {}, stackSig: null };
        this.pullsIfDue(repoKey, on, cx);
        await this.restack(repoKey);
      } catch {}
      finally { this.busy.delete(repoKey); cx.notify(); }
    });
  }

  /** Reads which worked-on branches are stacked on others, when that set of branches changed (or after a refresh). */
  async restack(repoKey) {
    const repo = this.repos[repoKey];
    if (!repo) return;
    // Real branch names only: a detached agent with no saved branch is "detached <sha>".
    const branches = [...new Set(Object.values(this.agents).filter((a) => a.repo === repoKey).map((a) => a.branch))]
      .filter((b) => b && b !== repo.main.name && !b.includes(" ")).sort();
    const sig = JSON.stringify(branches);
    if (sig === repo.stackSig) return;
    repo.stackSig = sig;
    try { repo.stacks = branches.length ? await scanStacks(repo.cwd, repo.on, repo.base, repo.main.name, branches) : {}; }
    catch { repo.stackSig = null; }
  }

  /** PRs only for repos that have agents on them, at most every PR_EVERY. */
  pullsIfDue(repoKey, on, cx) {
    const repo = this.repos[repoKey];
    if (!repo?.github || Date.now() - repo.pullsAt < PR_EVERY) return;
    if (!Object.values(this.agents).some((a) => a?.repo === repoKey)) return;
    repo.pullsAt = Date.now();
    cx.spawn(async (cx) => {
      try { repo.pulls = await scanPulls(repo.github, on); } catch {}
      cx.notify();
    });
  }

  /** Where each agent is. Cheap to call often: it re-reads git only when an agent appears, moves
   * folder or changes status (a turn ending is when a checkout or the handover hook happens), or every AGENTS_EVERY. */
  sync(cx) {
    const ps = panes(), ts = terminals();
    const list = agents().map((a) => {
      const term = ts.find((t) => t.address === a.address);
      const cwd = ps.find((p) => p.pane === a.pane)?.cwd ?? term?.cwd ?? null;
      const label = term?.labels?.["herdr.agent.cwd"] ?? null;
      return { address: a.address, cwd, label, app: a.app, status: a.status, on: a.address.includes("/") ? a.address.split("/")[0] : null };
    });
    const sig = JSON.stringify(list);
    if ((sig === this.agentSig && Date.now() - this.agentsAt < AGENTS_EVERY) || this.syncing) return;
    this.agentSig = sig; this.agentsAt = Date.now(); this.syncing = true;
    cx.spawn(async (cx) => {
      const next = {};
      await Promise.all(list.map(async (a) => {
        try {
          // Where the agent works, best source first:
          // 1. herdr.agent.cwd, set by the herdr-location Claude hook (dotfiles claude/hooks) from the session's own cwd;
          // 2. a local Claude session's transcript (sessions/<pid>.json -> its latest cwd);
          // 3. the program in front of the shell (an agent started from ~ reports ~ as the terminal's folder).
          let cwd = a.label;
          if (!cwd) {
            const got = await hc(["get", a.address, "--json"]).catch(() => null);
            const fg = got?.code === 0 ? JSON.parse(got.stdout).foreground : null;
            if (fg?.pid && !a.on && a.app === "claude-code") cwd = await claudeCwd(fg.pid).catch(() => null);
            cwd ||= fg?.cwd || a.cwd;
          }
          if (!cwd) return;
          const g = await agentGit(cwd, a.on);
          if (g) next[a.address] = { ...g, cwd, on: a.on };
        } catch {}
      }));
      this.agents = next;
      await Promise.all(Object.keys(this.repos).map((k) => this.restack(k)));
      this.syncing = false;
      for (const a of Object.values(next)) this.pullsIfDue(a.repo, a.on, cx);
      cx.notify();
    });
  }

  /**
   * The branches agents work on in a repo, drawn under its space row; null when no agent works in the repo.
   * `inside`: the rows sit in the active space's highlight, so their hover is a step brighter.
   * Returns `{ el, focused, main }`: `el` the branch rows (null when every agent is on the default branch),
   * `focused` when one of them holds the focused agent (and so wears the pill), and `main` the agents on the
   * default branch with whether one is focused: the space row stands for that branch and shows their dots.
   */
  render(repoKey, t, inside) {
    const live = Object.fromEntries(agents().map((a) => [a.address, a]));
    const byBranch = new Map();
    for (const [address, g] of Object.entries(this.agents)) {
      const a = live[address];
      if (!a || g.repo !== repoKey) continue;
      if (!byBranch.has(g.branch)) byBranch.set(g.branch, []);
      byBranch.get(g.branch).push({ ...a, detached: g.detached });
    }
    if (!byBranch.size) return null;
    const data = this.repos[repoKey] ?? { main: { name: "main" }, pulls: {}, stacks: {} };
    const nodes = new Map(); // branch -> { name, list: its agents, most urgent first }; empty list: only the base of a stack
    for (const [name, list] of byBranch) nodes.set(name, { name, list: list.sort((a, b) => urgency(a) - urgency(b) || b.seq - a.seq) });
    const onMain = nodes.get(data.main.name)?.list ?? [];
    nodes.delete(data.main.name);

    // A stacked branch hangs under the branch it's built on, shown even with no agent on it.
    const parent = {};
    for (const name of [...nodes.keys()]) {
      let child = name;
      for (const under of [...(data.stacks?.[name] ?? [])].reverse()) {
        if (child in parent) break;
        parent[child] = under;
        if (!nodes.has(under)) nodes.set(under, { name: under, list: [] });
        child = under;
      }
    }
    const kids = new Map();
    for (const [child, p] of Object.entries(parent)) kids.set(p, [...(kids.get(p) ?? []), child]);
    // Siblings go by the most urgent agent anywhere in their stack, then the most recent.
    const scores = new Map();
    const score = (name) => {
      if (!scores.has(name)) {
        scores.set(name, [9, 0]); // a guard: stacks read at different moments could disagree into a loop
        const own = nodes.get(name).list[0];
        let s = own ? [urgency(own), -own.seq] : [9, 0];
        for (const k of kids.get(name) ?? []) { const c = score(k); if (c[0] < s[0] || (c[0] === s[0] && c[1] < s[1])) s = c; }
        scores.set(name, s);
      }
      return scores.get(name);
    };
    const order = (names) => names.sort((a, b) => score(a)[0] - score(b)[0] || score(a)[1] - score(b)[1]);

    const hover = inside ? t.raised : t.hover;
    const tone = {
      draft: { fg: t.muted, bg: t.raised },
      review: { fg: t.ansi3, bg: t.ansi3 + "26" },
      changes: { fg: t.ansi1, bg: t.ansi1 + "26" },
      conflicts: { fg: t.ansi1, bg: t.ansi1 + "26" },
      ready: { fg: t.ansi2, bg: t.ansi2 + "26" },
    };
    // A row is a pill: filled for the focused agent's branch, else only under the pointer. Top-level pills put
    // their text under the space's name; a stacked one sits past a tree line under its base's text.
    const row = ({ name, list }, depth, last) => {
      const pr = data.pulls?.[name], first = list[0], focused = list.some((a) => a.focused);
      return h_flex().h(24).flex_none().pl(depth ? 33 + 18 * (depth - 1) : 28).pr(2).items_center().text_size(12)
        .when(depth > 0, (e) => e.child(div().w(13).flex_none().text_color(t.input).child(last ? "└" : "├")))
        .child(h_flex().id(`work-${repoKey}-${name}`).flex_1().min_w(0).h(22).px(7).gap(6).items_center().rounded_full()
          .when(focused, (e) => e.bg(t.input))
          .when(Boolean(first), (e) => e.cursor_pointer().on_click(() => run("pane.focus", { pane: first.pane })))
          .when(Boolean(first) && !focused, (e) => e.hover((s) => s.bg(hover)))
          .tooltip([name, ...list.map((a) => `${a.status} · ${a.space_name} / ${a.tab_name || a.tab_index}${a.detached ? " (worktree detached while idle)" : ""}`),
            first ? null : "No agent on it: the branches under it are stacked on it.", pr ? `#${pr.number} ${pr.title}` : null].filter(Boolean).join("\n"))
          .child(div().flex_1().min_w(0).truncate().text_color(focused ? t.foreground : first ? t.muted : t.dim).child(name.replace(PREFIX, "")))
          .when(Boolean(pr), (e) => e.child(this.prBadge(pr, tone[pr.state], t, `${repoKey}-${name}`)))
          .child(h_flex().flex_none().gap(3).items_center().children(list.map((a) => this.dot(a.status, t)))));
    };
    const rows = [];
    const seen = new Set();
    const walk = (name, depth, last) => {
      if (seen.has(name)) return;
      seen.add(name);
      rows.push(row(nodes.get(name), depth, last));
      const under = order(kids.get(name) ?? []);
      under.forEach((k, i) => walk(k, depth + 1, i === under.length - 1));
    };
    order([...nodes.keys()].filter((n) => !(n in parent))).forEach((n) => walk(n, 0, false));
    for (const n of nodes.keys()) walk(n, 0, false); // only reached when stacks disagree into a loop
    return {
      el: rows.length ? v_flex().flex_none().children(rows) : null,
      focused: [...nodes.values()].some((n) => n.list.some((a) => a.focused)),
      main: { agents: onMain, focused: onMain.some((a) => a.focused) },
    };
  }

  /** An agent's status, as the agents list shows it: a spinner while working, a dot otherwise. */
  dot(status, t) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(t.working).spin(900);
    return div().size(6).mx(2).flex_none().rounded(3).bg(t[status] ?? t.unknown).when(status === "idle", (e) => e.opacity(0.6));
  }

  prBadge(pr, tone, t, id) {
    const dot = pr.checks === "fail" ? t.ansi1 : pr.checks === "pending" ? t.ansi3 : pr.checks === "pass" ? t.ansi2 : null;
    return h_flex().id(`pr-${id}`).flex_none().h(17).px(6).gap(4).items_center().rounded(9).bg(tone.bg)
      .text_size(10).font_semibold().text_color(tone.fg).cursor_pointer().hover((s) => s.opacity(0.8))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); exec("open", [pr.url]); })
      .child(`#${pr.number}`)
      .child(div().font_normal().child(LABEL[pr.state]))
      .when(Boolean(dot), (e) => e.child(div().size(5).rounded(3).bg(dot)));
  }
}
