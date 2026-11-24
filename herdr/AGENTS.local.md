# My Herdr setup

## Herdr Roundup mods

Seven mods come from https://github.com/carstenlucke/herdr-roundup, installed one by one into my own
layout `my-main`, not as Roundup's whole layout:

| Mod | Role in `my-main` | Local changes |
|---|---|---|
| `roundup-spaces` | `spaces` block (replaced `my-spaces`) | none |
| `roundup-tabs` | `tabs` block, `props: {pr: 3}` (replaced `my-tabs`) | yes, see below |
| `roundup-pane` | pane header and root `terminal_menu` (replaced shipped `pane`) | none |
| `roundup-files` | `files` block in `panel-body` (replaced shipped `files`) | none |
| `roundup-preview` | opened by `roundup-files` | none |
| `roundup-confirm` | close prompt for `roundup-tabs` / `roundup-pane` | none |
| `roundup-menu` | space right-click menu for `roundup-spaces` | none |

Installed from commit `13ff3e96ea3201b290010158db84a4cfc73f158e` (layout version `0.11.0-beta.3`).
This commit is the merge base for the next update.

Left out: Roundup's layout `Herdr-Roundup`, `roundup-workspace-chrome` (its update check), and
`roundup-agents`. The Agents block stays my own `my-agents`. The agent integrations
(`scripts/agent-integrations.sh`) are not switched on. `my-spaces` (with its agent-branches list,
`work.js`) is retired on purpose. It stays on disk, outside the layout.

`keys.json` has a `layout:my-main` section from Roundup: `cmd-w` → `roundup-tabs.close`,
`cmd-shift-w` → `roundup-tabs.close-pane`.

### Local changes

Every local change in a Roundup mod carries a `// local:` comment on the line above it.
`grep -rn "// local:" mods/roundup-*` lists them all. Expect exactly these:

- `roundup-tabs/main.js`, the bar's root `h_flex`: right padding from `props()?.pr ?? 10` instead of
  `.px(10)`, because `my-main` puts the skillshare and claude-context toggles right of the bar.
- `roundup-tabs/main.js`, the Changes panel button: labelled `"Git"` with icon
  `mods/my-changes/branch.svg`, because that panel is `my-changes`.

Record any new local change here, and mark it with a `// local:` comment in the code.

### Updating

Roundup's own `scripts/sync.sh` and its "update with an agent" brief replace each mod folder
whole (`rsync --delete`), and so would erase the local changes. Update as a three-way merge instead:

1. Clone the new release tag into a new, empty folder in a scratch location.
2. For each mod in the table: diff upstream from the recorded commit to the new tag
   (`git diff <commit> <tag> -- mods/<mod>`), and apply that diff to the live mod.
3. Pairs stay byte-identical: `open-file.js` and `paths.js` in `roundup-files` and
   `roundup-preview`, and `close.js` and `menu.js` in `roundup-tabs` and `roundup-pane`.
4. If the new release makes these mods use another `roundup-*` mod or a new key, add it and record
   it in the table.
5. Done when every `// local:` change listed above is still present and `herdr-app check` passes
   for each `roundup-*` mod. `herdr-app status` must also show no errors.
6. Record the new commit above, then run `~/repos/dotfiles/herdr/sync.sh sync`.
