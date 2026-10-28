import { getDocs } from "./content";
import { toPlain } from "./markdown";

export type Chunk = {
  id: string;
  slug: string;
  section: string;
  sectionTitle: string;
  heading: string;
  text: string;
};

const STOP = new Set(
  "the a an and or of to in is are was were be been for on at by with from that this these those it its as not no but if then than so such into over under about can could should would may might will just also very more most much many any some what which who whom how why when where do does did done has have had you your we our they their i me my".split(
    " ",
  ),
);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

type Index = { chunks: Chunk[]; df: Map<string, number> };

let index: Index | null = null;

export function getChunks(): Chunk[] {
  return build().chunks;
}

function build(): Index {
  if (index) return index;
  const chunks: Chunk[] = [];
  const df = new Map<string, number>();

  for (const doc of getDocs()) {
    const parts = doc.body.split(/^##\s+/m);
    parts.forEach((part, i) => {
      const firstLine = part.split("\n")[0].replace(/[*_`]/g, "").trim();
      const heading = i === 0 ? doc.title : firstLine || doc.title;
      const text = toPlain(i === 0 ? part : part.slice(firstLine.length));
      if (text.length < 40) return;
      chunks.push({
        id: `${doc.slug}#${i}`,
        slug: doc.slug,
        section: doc.section,
        sectionTitle: doc.title,
        heading,
        text,
      });
    });
  }

  for (const chunk of chunks) {
    for (const term of Array.from(new Set(tokenize(chunk.heading + " " + chunk.text)))) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  index = { chunks, df };
  return index;
}

/** BM25 over the section chunks, plus a bonus for matches in the heading. */
export function retrieve(query: string, k = 4): Chunk[] {
  const { chunks, df } = build();
  const terms = tokenize(query);
  if (!terms.length) return chunks.slice(0, k);

  const N = chunks.length || 1;
  const k1 = 1.5;
  const b = 0.75;

  const prepared = chunks.map((chunk) => {
    const words = tokenize(chunk.text);
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    return { chunk, counts, length: words.length };
  });
  const avgdl = prepared.reduce((sum, p) => sum + p.length, 0) / (prepared.length || 1) || 1;

  const scored = prepared.map(({ chunk, counts, length }) => {
    let score = 0;
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      if (!tf) continue;
      const dfi = df.get(term) ?? 1;
      const idf = Math.log(1 + (N - dfi + 0.5) / (dfi + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * length) / avgdl)));
      const heading = chunk.heading.toLowerCase();
      if (heading.includes(term)) score += idf * 1.4;
      if (chunk.sectionTitle.toLowerCase().includes(term)) score += idf * 0.5;
    }
    return { chunk, score };
  });

  const picked = scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k)
    .map((s) => s.chunk);

  // Short queries often match a single clause. Add the section intros for the
  // sections we matched so the model gets section-level context too.
  if (picked.length < k) {
    const intros: Chunk[] = [];
    for (const hit of picked) {
      const intro = chunks.find((c) => c.slug === hit.slug && c.heading === c.sectionTitle);
      if (intro && !picked.some((p) => p.id === intro.id) && !intros.some((i) => i.id === intro.id)) {
        intros.push(intro);
      }
      if (picked.length + intros.length >= k) break;
    }
    if (!picked.length) {
      for (const c of chunks) {
        if (c.heading === c.sectionTitle && intros.length < k) intros.push(c);
      }
    }
    return [...picked, ...intros].slice(0, k);
  }

  return picked;
}

export function contextBlock(chunks: Chunk[], limit = 1600): string {
  let out = "";
  for (const c of chunks) {
    const piece = `\n---\n[§${c.section} ${c.sectionTitle} — ${c.heading}]\n${c.text.slice(0, limit)}\n`;
    if (out.length + piece.length > 7000) break;
    out += piece;
  }
  return out.trim();
}
