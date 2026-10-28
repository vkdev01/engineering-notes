import fs from "fs";
import path from "path";
import matter from "gray-matter";

export type Heading = { text: string; id: string };

export type Course = {
  /** folder name under content/ — also the URL segment */
  slug: string;
  title: string;
  subtitle?: string;
  version?: string;
  status?: string;
  credit?: string;
  creditUrl?: string;
  order: number;
  /** number of sections, filled in by getCourses() */
  sections: number;
  exercises: number;
  minutes: number;
};

export type Doc = {
  slug: string;
  course: string;
  section: string;
  title: string;
  kicker?: string;
  abstract?: string;
  status?: string;
  time?: string;
  order: number;
  outcomes?: string[];
  body: string;
  headings: Heading[];
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

/** Pull `##` headings out of raw markdown, ignoring fenced code. */
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

function courseDirs(): string[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(CONTENT_DIR, name, "course.json")));
}

const docCache = new Map<string, Doc[]>();

export function countExercises(body: string): number {
  return body.match(/^:::exercise/gm)?.length ?? 0;
}

export function getDocs(courseSlug: string): Doc[] {
  const cached = docCache.get(courseSlug);
  if (cached) return cached;

  const dir = path.join(CONTENT_DIR, courseSlug);
  if (!fs.existsSync(dir)) return [];

  const docs: Doc[] = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { data, content } = matter(raw);
      const slug = file.replace(/\.md$/, "");
      return {
        slug,
        course: courseSlug,
        section: String(data.section ?? slug.slice(0, 2)),
        title: String(data.title ?? slug),
        kicker: data.kicker ? String(data.kicker) : undefined,
        abstract: data.abstract ? String(data.abstract) : undefined,
        status: data.status ? String(data.status) : undefined,
        time: data.time ? String(data.time) : undefined,
        order: Number(data.order ?? 0),
        outcomes: Array.isArray(data.outcomes) ? data.outcomes.map(String) : undefined,
        body: content,
        headings: extractHeadings(content),
      } satisfies Doc;
    })
    .sort((a, b) => a.order - b.order);

  docCache.set(courseSlug, docs);
  return docs;
}

export function getCourses(): Course[] {
  return courseDirs()
    .map((slug) => {
      const meta = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, slug, "course.json"), "utf8"));
      const docs = getDocs(slug);
      return {
        slug,
        title: String(meta.title ?? slug),
        subtitle: meta.subtitle ? String(meta.subtitle) : undefined,
        version: meta.version ? String(meta.version) : undefined,
        status: meta.status ? String(meta.status) : undefined,
        credit: meta.credit ? String(meta.credit) : undefined,
        creditUrl: meta.creditUrl ? String(meta.creditUrl) : undefined,
        order: Number(meta.order ?? 999),
        sections: docs.length,
        exercises: docs.reduce((n, d) => n + countExercises(d.body), 0),
        minutes: docs.reduce((n, d) => n + (parseInt(d.time ?? "0", 10) || 0), 0),
      } satisfies Course;
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getCourse(slug: string): Course | undefined {
  return getCourses().find((c) => c.slug === slug);
}

export function getDoc(courseSlug: string, slug: string): Doc | undefined {
  return getDocs(courseSlug).find((d) => d.slug === slug);
}

export function neighbours(courseSlug: string, slug: string) {
  const docs = getDocs(courseSlug);
  const i = docs.findIndex((d) => d.slug === slug);
  return {
    prev: i > 0 ? docs[i - 1] : undefined,
    next: i >= 0 && i < docs.length - 1 ? docs[i + 1] : undefined,
  };
}

/** Every doc across every course — used by the assistant's index. */
export function allDocs(): { course: Course; doc: Doc }[] {
  return getCourses().flatMap((course) =>
    getDocs(course.slug).map((doc) => ({ course, doc })),
  );
}

export function totals() {
  const courses = getCourses();
  return {
    courses: courses.length,
    sections: courses.reduce((n, c) => n + c.sections, 0),
    exercises: courses.reduce((n, c) => n + c.exercises, 0),
    minutes: courses.reduce((n, c) => n + c.minutes, 0),
  };
}
