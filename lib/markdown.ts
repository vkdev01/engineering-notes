import { marked } from "marked";
import { slugify } from "./content";

export type Segment =
  | { kind: "html"; html: string }
  | { kind: "callout"; variant: "note" | "warn" | "pull"; title?: string; html: string }
  | { kind: "exercise"; id: string; label?: string; props: Record<string, string> };

marked.setOptions({ gfm: true, breaks: false });

/** Add ids to h2/h3 so the right-hand rail and chat citations can link to them. */
function withHeadingIds(html: string): string {
  return html.replace(/<h([23])>(.*?)<\/h\1>/g, (_m, level, inner) => {
    const text = String(inner).replace(/<[^>]+>/g, "");
    return `<h${level} id="${slugify(text)}">${inner}</h${level}>`;
  });
}

function parseProps(raw: string): Record<string, string> {
  const props: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    props[m[1] ?? m[3]] = m[2] ?? m[4] ?? "";
  }
  return props;
}

const OPEN = /^:::([a-z-]+)\s*(?:\[([^\]]*)\])?\s*(?:\{([^}]*)\})?\s*$/;

/**
 * Markdown → renderable segments.
 *
 * Supported directives (a line of its own, closed by a line of `:::`):
 *   :::note[Title]      — annotation callout
 *   :::warn[Title]      — warning callout
 *   :::pull             — pull quote
 *   :::exercise[Label]{id="scorecard"}  — mounts a React exercise from the registry
 */
export function toSegments(markdown: string): Segment[] {
  const lines = markdown.split("\n");
  const segments: Segment[] = [];
  let buffer: string[] = [];

  const flushHtml = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (!text) return;
    segments.push({ kind: "html", html: withHeadingIds(marked.parse(text) as string) });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = OPEN.exec(line.trim());
    if (open) {
      flushHtml();
      const type = open[1];
      const label = open[2];
      const props = parseProps(open[3] ?? "");

      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ":::") {
        body.push(lines[i]);
        i++;
      }
      const inner = body.join("\n").trim();

      if (type === "exercise") {
        segments.push({ kind: "exercise", id: props.id ?? "scorecard", label, props });
      } else if (type === "note" || type === "warn") {
        segments.push({
          kind: "callout",
          variant: type,
          title: label,
          html: marked.parse(inner) as string,
        });
      } else if (type === "pull") {
        segments.push({ kind: "callout", variant: "pull", title: label, html: inner });
      } else {
        segments.push({ kind: "html", html: withHeadingIds(marked.parse(inner) as string) });
      }
      continue;
    }
    buffer.push(line);
  }
  flushHtml();
  return segments;
}

/** Plain text version of a markdown body — used for retrieval. */
export function toPlain(markdown: string): string {
  return markdown
    .replace(/^:::.*$/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/[#>*`_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
