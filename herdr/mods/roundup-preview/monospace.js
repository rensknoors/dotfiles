// local: the whole file. Syntax colors from the Monospace theme (Google IDX), the same palette
// as mods/git-diff/highlight.js (copied: a mod can't import another mod's files).
import { theme, settings } from "herdr";

const PALETTES = {
  dark: {
    fg: "#d9dfe7", comment: "#7f8d9f", constant: "#92a9ff", entity: "#bd9cfe", tag: "#77d5a3",
    keyword: "#fd8da3", string: "#77d5a3", property: "#85cdf1", variable: "#ffd395", type: "#92a9ff",
    heading: "#92a9ff", lineNumber: "#475365",
  },
  light: {
    fg: "#1f2939", comment: "#637083", constant: "#264dcb", entity: "#6f4cde", tag: "#007b49",
    keyword: "#c43058", string: "#007b49", property: "#0075a2", variable: "#d07826", type: "#264dcb",
    heading: "#264dcb", lineNumber: "#bfc7d2",
  },
};

/** The light or dark palette, as git-diff picks it: the appearance, else the background's lightness. */
export function palette() {
  const dark = settings().dark;
  if (typeof dark === "boolean") return dark ? PALETTES.dark : PALETTES.light;
  const hex = theme().background ?? "#000000", n = parseInt(hex.slice(1, 7), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 128 ? PALETTES.dark : PALETTES.light;
}

/** EditorState's `syntax` map in the Monospace colors, Markdown keys included. */
export function editorSyntax() {
  const p = palette();
  return {
    keyword: p.keyword, string: p.string, "string.escape": p.constant, comment: p.comment,
    function: p.entity, type: p.type, number: p.constant, constant: p.constant, boolean: p.constant,
    variable: p.fg, operator: p.fg, punctuation: p.fg,
    heading: p.heading, strong: p.fg, code: p.constant, quote: p.string, list: p.variable, link: p.string,
  };
}
