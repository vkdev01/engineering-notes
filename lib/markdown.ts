import { Marked } from "marked";
import type { TokenizerAndRendererExtension } from "marked";
import katex from "katex";
import { slugify } from "./content";
import { escapeHtml, highlight } from "./highlight";

export type CalloutVariant = "note" | "warn" | "tip" | "example" | "key";

export type Segment =
  | { kind: "html"; html: string }
  | { kind: "callout"; variant: CalloutVariant; title?: string; children: Segment[] }
  | { kind: "pull"; children: Segment[] }
  | { kind: "exercise"; id: string; label?: string; props: Record<string, string> }
  | { kind: "figure"; id: string; caption?: string; note?: string }
  | { kind: "qa"; question: string; variant: "qa" | "details"; children: Segment[] }
  | { kind: "mermaid"; code: string; caption?: string }
  | { kind: "chart"; caption?: string; props: Record<string, string>; data: string };

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/* ---------------------------------------------------------------- math */

function tex(src: string, displayMode: boolean): string {
  return katex.renderToString(src.trim(), {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    output: "htmlAndMathml",
  });
}

const blockMath: TokenizerAndRendererExtension = {
  name: "blockMath",
  level: "block",
  start(src) {
    const m = /^ {0,3}(?:\$\$|\\\[)/m.exec(src);
    return m ? m.index : undefined;
  },
  tokenizer(src) {
    const m = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/.exec(src);
    if (!m) return undefined;
    return { type: "blockMath", raw: m[0], text: m[1] ?? m[2] ?? "" };
  },
  renderer(token) {
    return `<div class="math-block">${tex(String(token.text), true)}</div>\n`;
  },
};

// `$` only opens math when followed by a non-space, non-digit — so "$500" stays currency.
const INLINE_RULES: [RegExp, boolean][] = [
  [/^\\\(([\s\S]+?)\\\)/, false],
  [/^\\\[([\s\S]+?)\\\]/, true],
  [/^\$\$([\s\S]+?)\$\$/, true],
  [/^\$(?![\s$\d])((?:\\.|[^$\\\n])+?)(?<=\S)\$(?!\d)/, false],
];

const inlineMath: TokenizerAndRendererExtension = {
  name: "inlineMath",
  level: "inline",
  start(src) {
    const i = src.search(/\\[([]|(?<!\\)\$/);
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    for (const [re, display] of INLINE_RULES) {
      const m = re.exec(src);
      if (m) return { type: "inlineMath", raw: m[0], text: m[1], display };
    }
    return undefined;
  },
  renderer(token) {
    const html = tex(String(token.text), Boolean(token.display));
    return token.display ? `<span class="math-display">${html}</span>` : html;
  },
};

/* ---------------------------------------------------------------- marked */

const md = new Marked({ gfm: true, breaks: false });
md.use({
  extensions: [blockMath, inlineMath],
  renderer: {
    code(code: string, infostring: string | undefined) {
      const [lang = "", ...meta] = (infostring ?? "").trim().split(/\s+/);
      const l = lang.toLowerCase();
      if (l === "math" || l === "latex" || l === "tex") {
        return `<div class="math-block">${tex(code, true)}</div>\n`;
      }
      const body = code.replace(/\n+$/, "");
      const { html, label, language } = highlight(body, l);
      const plain = language === "plaintext" && l !== "output";
      const cls = ["code", l === "output" ? "code-out" : "", plain ? "code-plain" : ""].filter(Boolean).join(" ");
      const tag = meta.includes("run") ? `<span class="code-tag">runnable</span>` : "";
      const head = plain
        ? ""
        : `<div class="code-head"><span class="code-lang">${escapeHtml(label)}</span>${tag}</div>`;
      return (
        `<div class="${cls}">${head}` +
        `<button type="button" class="code-copy" aria-label="Copy code">Copy</button>` +
        `<pre><code class="hljs language-${language}">${html}</code></pre></div>\n`
      );
    },
    heading(text: string, level: number, raw: string) {
      if (level !== 2 && level !== 3) return `<h${level}>${text}</h${level}>\n`;
      const id = slugify(raw);
      return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${level}>\n`;
    },
  },
});

function post(html: string): string {
  let out = html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>")
    .replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener noreferrer"');
  if (BASE) {
    out = out.replace(/href="(\/(?!\/)[^"]*)"/g, (m, p: string) => (p.startsWith(BASE + "/") ? m : `href="${BASE}${p}"`));
  }
  return out;
}

export function renderMarkdown(text: string): string {
  return post(md.parse(text) as string);
}

/* ---------------------------------------------------------------- directives */

function parseProps(raw: string): Record<string, string> {
  const props: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) props[m[1]] = m[2] ?? m[3] ?? "";
  return props;
}

const OPEN = /^:::([a-z-]+)\s*(?:\[(.*?)\](?=\s*(?:\{|$)))?\s*(?:\{(.*)\})?\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^`\s]*)/;

function closesFence(line: string, marker: string): boolean {
  return new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(line);
}

const CALLOUTS: Record<string, CalloutVariant> = {
  note: "note",
  info: "note",
  warn: "warn",
  warning: "warn",
  danger: "warn",
  tip: "tip",
  example: "example",
  key: "key",
  principle: "key",
};

function toSegment(type: string, label: string | undefined, props: Record<string, string>, inner: string): Segment {
  if (type === "exercise") return { kind: "exercise", id: props.id ?? "scorecard", label, props };
  if (type === "figure") return { kind: "figure", id: props.id ?? "", caption: label, note: props.note };
  if (type === "mermaid") return { kind: "mermaid", code: inner, caption: label };
  if (type === "chart") return { kind: "chart", caption: label, props, data: inner };
  if (type === "qa" || type === "details") {
    return { kind: "qa", variant: type, question: label ?? "Details", children: toSegments(inner) };
  }
  if (type === "pull") return { kind: "pull", children: toSegments(inner) };
  const variant = CALLOUTS[type];
  if (variant) return { kind: "callout", variant, title: label, children: toSegments(inner) };
  return { kind: "html", html: renderMarkdown(inner) };
}

/**
 * Markdown → renderable segments.
 *
 * Block directives open with `:::name[Label]{key="value"}` on a line of their own and close
 * with a bare `:::`. They nest, and `:::` inside fenced code is ignored.
 *
 *   note | info · warn | danger · tip · example · key | principle   callouts
 *   pull                                   pull quote
 *   qa[Question] · details[Title]          collapsible
 *   exercise[Label]{id="scorecard"}        React exercise from the registry
 *   figure[Caption]{id="subsystems"}       hand-drawn SVG from Figures.tsx
 *   mermaid[Caption]                       mermaid diagram (```mermaid also works)
 *   chart[Caption]{type="line" …}          CSV data → themed SVG chart
 *
 * Math: $…$, \(…\) inline; $$…$$, \[…\] or ```math for display.
 */
export function toSegments(markdown: string): Segment[] {
  const lines = markdown.split("\n");
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (text) segments.push({ kind: "html", html: renderMarkdown(text) });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence) {
      buffer.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    const f = FENCE.exec(line);
    if (f) {
      if (f[2].toLowerCase() === "mermaid") {
        flush();
        const body: string[] = [];
        for (i++; i < lines.length && !closesFence(lines[i], f[1]); i++) body.push(lines[i]);
        segments.push({ kind: "mermaid", code: body.join("\n").trim() });
        continue;
      }
      fence = f[1];
      buffer.push(line);
      continue;
    }

    const open = OPEN.exec(line.trim());
    if (!open) {
      buffer.push(line);
      continue;
    }

    flush();
    const body: string[] = [];
    let depth = 1;
    let inner: string | null = null;
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (inner) {
        body.push(l);
        if (closesFence(l, inner)) inner = null;
        continue;
      }
      const fo = FENCE.exec(l);
      if (fo) {
        inner = fo[1];
        body.push(l);
        continue;
      }
      const t = l.trim();
      if (t === ":::") {
        if (--depth === 0) break;
      } else if (OPEN.test(t)) {
        depth++;
      }
      body.push(l);
    }
    segments.push(toSegment(open[1], open[2], parseProps(open[3] ?? ""), body.join("\n").trim()));
  }
  flush();
  return segments;
}

/** Plain text version of a markdown body — used for retrieval. */
export function toPlain(markdown: string): string {
  return markdown
    .replace(/^:::(chart|mermaid)[\s\S]*?^:::\s*$/gm, " ")
    .replace(/^:::.*$/gm, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/\\[()[\]]|\$\$/g, " ")
    .replace(/[#>*`_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
