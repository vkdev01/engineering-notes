import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import sql from "highlight.js/lib/languages/sql";
import ini from "highlight.js/lib/languages/ini";
import makefile from "highlight.js/lib/languages/makefile";
import diff from "highlight.js/lib/languages/diff";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("plaintext", plaintext);

const ALIASES: Record<string, string> = {
  py: "python",
  python3: "python",
  sh: "bash",
  zsh: "bash",
  console: "shell",
  yml: "yaml",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  docker: "dockerfile",
  toml: "ini",
  text: "plaintext",
  txt: "plaintext",
  output: "plaintext",
};

const LABELS: Record<string, string> = {
  python: "Python",
  bash: "Shell",
  shell: "Console",
  json: "JSON",
  yaml: "YAML",
  typescript: "TypeScript",
  javascript: "JavaScript",
  dockerfile: "Dockerfile",
  sql: "SQL",
  ini: "Config",
  makefile: "Makefile",
  diff: "Diff",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Highlight a code block. Unknown languages are escaped and shown as plain text. */
export function highlight(code: string, lang: string): { html: string; label: string; language: string } {
  const key = ALIASES[lang] ?? lang;
  if (key && key !== "plaintext" && hljs.getLanguage(key)) {
    return { html: hljs.highlight(code, { language: key, ignoreIllegals: true }).value, label: LABELS[key] ?? key, language: key };
  }
  const label = lang === "output" ? "Output" : lang && lang !== "text" && lang !== "plaintext" ? lang : "Text";
  return { html: escapeHtml(code), label, language: "plaintext" };
}

export { escapeHtml };
