// Syntax colors from the Monospace theme (Google IDX), as shipped in the
// keksiqc.idx-monospace-theme VS Code extension (monospace-dark/-light.json).
export const PALETTES = {
  dark: {
    fg: "#d9dfe7", comment: "#7f8d9f", constant: "#92a9ff", entity: "#bd9cfe", tag: "#77d5a3",
    keyword: "#fd8da3", string: "#77d5a3", property: "#85cdf1", variable: "#ffd395", type: "#92a9ff",
    heading: "#92a9ff", range: "#bd9cfe", lineNumber: "#475365",
    inserted: "#17975f40", removed: "#df404740",
    added: "#17b877", deleted: "#f76769", modified: "#708fff",
  },
  light: {
    fg: "#1f2939", comment: "#637083", constant: "#264dcb", entity: "#6f4cde", tag: "#007b49",
    keyword: "#c43058", string: "#007b49", property: "#0075a2", variable: "#d07826", type: "#264dcb",
    heading: "#264dcb", range: "#6f4cde", lineNumber: "#bfc7d2",
    inserted: "#daf8e4", removed: "#ffe5e4",
    added: "#17975f", deleted: "#df4047", modified: "#5173f1",
  },
};

const words = (s) => new Set(s.split(" "));
const C_LIKE = "if else for while do switch case default break continue return goto try catch finally throw new delete";
const KEYWORDS = {
  js: words(`${C_LIKE} var let const function class extends implements interface type enum import export from as of in instanceof typeof void yield async await static get set public private protected readonly abstract declare namespace module keyof infer satisfies with debugger super`),
  py: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"),
  rs: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return static struct trait type unsafe use where while"),
  go: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
  sh: words("if then else elif fi for while until do done case esac in function return local export source alias unset set shift exit break continue readonly declare typeset"),
  c: words(`${C_LIKE} auto char const double enum extern float int long register short signed sizeof static struct typedef union unsigned void volatile include define ifdef ifndef endif pragma class namespace template typename using virtual public private protected override final`),
  java: words(`${C_LIKE} abstract assert boolean byte char class double enum extends final float implements import instanceof int interface long native package private protected public short static strictfp super synchronized transient void volatile val var fun object when is in data sealed override open internal lateinit companion`),
  rb: words("alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return then undef unless until when while yield require require_relative include extend attr_accessor attr_reader"),
  lua: words("and break do else elseif end for function goto if in local not or repeat return then until while"),
  sql: words("select from where insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset as and or not in is null distinct union all case when then else end primary key foreign references default"),
  css: words("important media import supports keyframes font-face"),
  none: new Set(),
};
const CONSTANTS = words("true false null undefined None True False nil NaN Infinity this self Self super");

// ext -> [keywords, line comment, block comments, string quotes, flags]
function langFor(path) {
  const name = path.split("/").pop().toLowerCase(), ext = name.includes(".") ? name.split(".").pop() : name;
  const js = { kw: KEYWORDS.js, line: ["//"], block: [["/*", "*/"]], quotes: "\"'`" };
  const map = {
    js, mjs: js, cjs: js, ts: js, mts: js, cts: js, jsx: { ...js, tags: true }, tsx: { ...js, tags: true },
    vue: { ...js, tags: true, block: [["/*", "*/"], ["<!--", "-->"]] }, svelte: { ...js, tags: true, block: [["/*", "*/"], ["<!--", "-->"]] },
    py: { kw: KEYWORDS.py, line: ["#"], block: [['"""', '"""', "string"], ["'''", "'''", "string"]], quotes: "\"'", decorators: true },
    rs: { kw: KEYWORDS.rs, line: ["//"], block: [["/*", "*/"]], quotes: "\"" },
    go: { kw: KEYWORDS.go, line: ["//"], block: [["/*", "*/"]], quotes: "\"'`" },
    c: { kw: KEYWORDS.c, line: ["//"], block: [["/*", "*/"]], quotes: "\"'" },
    h: { kw: KEYWORDS.c, line: ["//"], block: [["/*", "*/"]], quotes: "\"'" },
    cpp: { kw: KEYWORDS.c, line: ["//"], block: [["/*", "*/"]], quotes: "\"'" },
    hpp: { kw: KEYWORDS.c, line: ["//"], block: [["/*", "*/"]], quotes: "\"'" },
    cs: { kw: KEYWORDS.java, line: ["//"], block: [["/*", "*/"]], quotes: "\"'" },
    java: { kw: KEYWORDS.java, line: ["//"], block: [["/*", "*/"]], quotes: "\"'", decorators: true },
    kt: { kw: KEYWORDS.java, line: ["//"], block: [["/*", "*/"]], quotes: "\"'", decorators: true },
    swift: { kw: KEYWORDS.java, line: ["//"], block: [["/*", "*/"]], quotes: "\"", decorators: true },
    rb: { kw: KEYWORDS.rb, line: ["#"], block: [], quotes: "\"'" },
    lua: { kw: KEYWORDS.lua, line: ["--"], block: [["--[[", "]]"]], quotes: "\"'" },
    sql: { kw: KEYWORDS.sql, line: ["--"], block: [["/*", "*/"]], quotes: "\"'", nocase: true },
    sh: { kw: KEYWORDS.sh, line: ["#"], block: [], quotes: "\"'", vars: true },
    bash: { kw: KEYWORDS.sh, line: ["#"], block: [], quotes: "\"'", vars: true },
    zsh: { kw: KEYWORDS.sh, line: ["#"], block: [], quotes: "\"'", vars: true },
    fish: { kw: KEYWORDS.sh, line: ["#"], block: [], quotes: "\"'", vars: true },
    zshrc: { kw: KEYWORDS.sh, line: ["#"], block: [], quotes: "\"'", vars: true },
    bashrc: { kw: KEYWORDS.sh, line: ["#"], block: [], quotes: "\"'", vars: true },
    zprofile: { kw: KEYWORDS.sh, line: ["#"], block: [], quotes: "\"'", vars: true },
    dockerfile: { kw: words("FROM RUN CMD COPY ADD ENV ARG WORKDIR EXPOSE ENTRYPOINT USER VOLUME LABEL AS"), line: ["#"], block: [], quotes: "\"'", vars: true },
    makefile: { kw: KEYWORDS.none, line: ["#"], block: [], quotes: "\"'", vars: true },
    json: { kw: KEYWORDS.none, line: ["//"], block: [["/*", "*/"]], quotes: "\"", keys: true },
    jsonc: { kw: KEYWORDS.none, line: ["//"], block: [["/*", "*/"]], quotes: "\"", keys: true },
    yaml: { kw: KEYWORDS.none, line: ["#"], block: [], quotes: "\"'", keys: true, bareKeys: true },
    yml: { kw: KEYWORDS.none, line: ["#"], block: [], quotes: "\"'", keys: true, bareKeys: true },
    toml: { kw: KEYWORDS.none, line: ["#"], block: [], quotes: "\"'", keys: true, bareKeys: true },
    ini: { kw: KEYWORDS.none, line: [";", "#"], block: [], quotes: "\"'", bareKeys: true },
    css: { kw: KEYWORDS.css, line: [], block: [["/*", "*/"]], quotes: "\"'", css: true },
    scss: { kw: KEYWORDS.css, line: ["//"], block: [["/*", "*/"]], quotes: "\"'", css: true, vars: true },
    less: { kw: KEYWORDS.css, line: ["//"], block: [["/*", "*/"]], quotes: "\"'", css: true },
    html: { kw: KEYWORDS.none, line: [], block: [["<!--", "-->"]], quotes: "\"'", tags: true, markup: true },
    xml: { kw: KEYWORDS.none, line: [], block: [["<!--", "-->"]], quotes: "\"'", tags: true, markup: true },
    svg: { kw: KEYWORDS.none, line: [], block: [["<!--", "-->"]], quotes: "\"'", tags: true, markup: true },
    md: { markdown: true }, mdx: { markdown: true }, markdown: { markdown: true },
  };
  return map[ext] ?? map[name] ?? { kw: KEYWORDS.none, line: ["#", "//"], block: [["/*", "*/"]], quotes: "\"'" };
}

const IDENT = /[A-Za-z_][\w$]*/y, NUMBER = /(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/y;

function markdown(text, p) {
  if (/^\s{0,3}#{1,6}\s/.test(text)) return [{ text, color: p.heading, bold: true }];
  if (/^\s*>/.test(text)) return [{ text, color: p.string }];
  const spans = [], re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]*\]\([^)]*\))|(^\s*(?:[-*+]|\d+\.)\s)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), color: p.fg });
    spans.push({ text: m[0], color: m[1] ? p.constant : m[2] ? p.fg : m[3] ? p.string : p.variable, bold: Boolean(m[2]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), color: p.fg });
  return spans;
}

/** Splits one line into colored spans; `state` carries an open block comment/string across lines. */
export function highlight(text, lang, p, state) {
  if (lang.markdown) return markdown(text, p);
  const spans = [], push = (t, color, bold) => {
    const last = spans[spans.length - 1];
    if (last && last.color === color && !last.bold && !bold) last.text += t; else spans.push({ text: t, color, bold });
  };
  let i = 0, n = text.length, prevSig = "";
  while (i < n) {
    if (state.open) {
      const end = text.indexOf(state.open[1], i);
      const stop = end < 0 ? n : end + state.open[1].length;
      push(text.slice(i, stop), state.open[2] === "string" ? p.string : p.comment);
      i = stop; if (end >= 0) state.open = null; continue;
    }
    const rest = text.slice(i), c = text[i];
    const block = lang.block.find(([s]) => rest.startsWith(s));
    if (block) { state.open = block; push(block[0], block[2] === "string" ? p.string : p.comment); i += block[0].length; continue; }
    if (lang.line.some((s) => rest.startsWith(s) && (s !== "#" || !lang.vars || i === 0 || /\s/.test(text[i - 1])))) { push(rest, p.comment); break; }
    if (lang.quotes.includes(c)) {
      let j = i + 1;
      while (j < n && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      j = Math.min(j + 1, n);
      const isKey = lang.keys && /^\s*:/.test(text.slice(j));
      push(text.slice(i, j), isKey ? p.property : p.string); i = j; prevSig = c; continue;
    }
    if (lang.vars && c === "$" && /[\w{(@#?*!]/.test(text[i + 1] ?? "")) {
      const m = /^\$(?:\{[^}]*\}|\(|[\w@#?*!]+)/.exec(rest);
      push(m[0], p.variable); i += m[0].length; continue;
    }
    if (lang.decorators && c === "@" && /[A-Za-z_]/.test(text[i + 1] ?? "")) {
      const m = /^@[\w.]+/.exec(rest); push(m[0], p.keyword); i += m[0].length; continue;
    }
    if (lang.tags && c === "<" && /[A-Za-z/!]/.test(text[i + 1] ?? "") && (lang.markup || !/[\w)\]]/.test(prevSig))) {
      const m = /^<\/?([A-Za-z][\w.:-]*)/.exec(rest);
      if (m) { push(m[0].slice(0, m[0].length - m[1].length), p.fg); push(m[1], /^[A-Z]/.test(m[1]) ? p.type : p.tag); i += m[0].length; prevSig = "<"; continue; }
    }
    NUMBER.lastIndex = i;
    if (/\d/.test(c) && !/[\w$]/.test(text[i - 1] ?? "") && NUMBER.test(text)) {
      push(text.slice(i, NUMBER.lastIndex), p.constant); i = NUMBER.lastIndex; prevSig = "0"; continue;
    }
    IDENT.lastIndex = i;
    if (/[A-Za-z_]/.test(c) && !/[\w$]/.test(text[i - 1] ?? "") && IDENT.test(text)) {
      let end = IDENT.lastIndex;
      if (lang.css) while (end < n && /[\w-]/.test(text[end])) end++;
      const word = text.slice(i, end), after = text.slice(end);
      const kw = lang.nocase ? lang.kw.has(word.toLowerCase()) : lang.kw.has(word);
      let color = p.fg;
      if (lang.bareKeys && /^\s*[:=]/.test(after) && /^\s*$/.test(text.slice(0, i).replace(/^\s*-\s/, ""))) color = p.property;
      else if (lang.css) color = /^\s*:/.test(after) && !/^\s*:\s*[a-z-]+\s*[{,(]/.test(after) ? p.property : prevSig === "@" ? p.keyword : p.fg;
      else if (lang.markup) color = /^\s*=/.test(after) ? p.entity : p.fg;
      else if (prevSig === "." && !kw) color = /^\s*\(/.test(after) ? p.entity : p.fg;
      else if (kw) color = p.keyword;
      else if (CONSTANTS.has(word)) color = p.constant;
      else if (/^\s*\(/.test(after) || /^\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/.test(after)) color = p.entity;
      else if (/^[A-Z][A-Z0-9_]+$/.test(word)) color = p.constant;
      else if (/^[A-Z]/.test(word)) color = p.type;
      push(word, color); i = end; prevSig = "a"; continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    push(c, p.fg); i++;
  }
  return spans;
}

export { langFor };
