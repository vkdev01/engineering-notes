import fs from "fs";
import path from "path";
import matter from "gray-matter";

export type Heading = { text: string; id: string };

export type Doc = {
  slug: string;
  section: string;
  title: string;
  kicker?: string;
  abstract?: string;
  status?: string;
  time?: string;
  order: number;
  body: string;
  headings: Heading[];
};

export type Course = {
  title: string;
  subtitle?: string;
  version?: string;
  credit?: string;
  creditUrl?: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content");

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/** Pull `##` / `###` headings out of raw markdown, ignoring fenced code. */
function extractHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(##)\s+(.+?)\s*$/.exec(line);
    if (m) {
      const text = m[2].replace(/[*_`]/g, "");
      out.push({ text, id: slugify(text) });
    }
  }
  return out;
}

export function getCourse(): Course {
  const file = path.join(CONTENT_DIR, "course.json");
  if (!fs.existsSync(file)) return { title: "Tutorial" };
  return JSON.parse(fs.readFileSync(file, "utf8")) as Course;
}

let cache: Doc[] | null = null;

export function getDocs(): Doc[] {
  if (cache) return cache;
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const docs: Doc[] = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
      const { data, content } = matter(raw);
      const slug = file.replace(/\.md$/, "");
      return {
        slug,
        section: String(data.section ?? slug.slice(0, 2)),
        title: String(data.title ?? slug),
        kicker: data.kicker ? String(data.kicker) : undefined,
        abstract: data.abstract ? String(data.abstract) : undefined,
        status: data.status ? String(data.status) : undefined,
        time: data.time ? String(data.time) : undefined,
        order: Number(data.order ?? 0),
        body: content,
        headings: extractHeadings(content),
      } satisfies Doc;
    })
    .sort((a, b) => a.order - b.order);

  cache = docs;
  return docs;
}

export function getDoc(slug: string): Doc | undefined {
  return getDocs().find((d) => d.slug === slug);
}

export function neighbours(slug: string) {
  const docs = getDocs();
  const i = docs.findIndex((d) => d.slug === slug);
  return {
    prev: i > 0 ? docs[i - 1] : undefined,
    next: i >= 0 && i < docs.length - 1 ? docs[i + 1] : undefined,
  };
}

/** How many `:::exercise` directives the course mounts in total. */
export function exerciseCount(): number {
  return getDocs().reduce((n, doc) => n + (doc.body.match(/^:::exercise/gm)?.length ?? 0), 0);
}
