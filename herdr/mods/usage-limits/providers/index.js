import claude from "./claude.js";
import codex from "./codex.js";
import gemini from "./gemini.js";

// Order here is the order in the status bar and the settings popup.
export const PROVIDERS = [claude, codex, gemini];
