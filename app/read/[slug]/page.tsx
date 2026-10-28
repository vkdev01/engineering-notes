import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SectionBody from "@/components/SectionBody";
import ContentsNav from "@/components/ContentsNav";
import MenuToggle from "@/components/MenuToggle";
import { getCourse, getDoc, getDocs, neighbours } from "@/lib/content";

type Params = { slug: string };

function count(body: string) {
  return body.match(/^:::exercise/gm)?.length ?? 0;
}

export function generateStaticParams(): Params[] {
  return getDocs().map((doc) => ({ slug: doc.slug }));
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const doc = getDoc(params.slug);
  return { title: doc ? `${doc.title} — §${doc.section}` : "Not found" };
}

export default function SectionPage({ params }: { params: Params }) {
  const doc = getDoc(params.slug);
  if (!doc) notFound();

  const course = getCourse();
  const docs = getDocs();
  const { prev, next } = neighbours(doc.slug);
  const exercises = count(doc.body);
  const total = docs.reduce((n, d) => n + count(d.body), 0);

  const navDocs = docs.map((d) => ({
    slug: d.slug,
    section: d.section,
    title: d.title,
    abstract: d.abstract,
    time: d.time,
    headings: d.headings,
    exercises: count(d.body),
  }));

  return (
    <div className="shell">
      <nav className="idx" aria-label="Contents">
        <ContentsNav docs={navDocs} current={doc.slug} courseTitle={course.title} totalExercises={total} />
      </nav>

      <main className="doc">
        <div className="crumbrow">
          <MenuToggle />
          <span className="path">
            <Link href="/">Home</Link>
            <span className="sep">/</span>
            <span>§{doc.section}</span>
            <span className="sep">/</span>
            <span className="here">{doc.title}</span>
          </span>
        </div>

        <div className="sechead">
          <div className="eyebrow">
            Section {doc.section}
            {doc.kicker ? ` · ${doc.kicker}` : ""}
          </div>
          <h1>{doc.title}</h1>
          {doc.abstract ? <p className="abstract">{doc.abstract}</p> : null}
        </div>

        <div className="statrow">
          <span>
            <b>{doc.headings.length}</b> topics
          </span>
          <span>
            <b>{exercises}</b> {exercises === 1 ? "exercise" : "exercises"}
          </span>
          <span>
            <b>{doc.time ?? "—"}</b> reading
          </span>
        </div>

        {doc.outcomes?.length ? (
          <section className="outcomes">
            <h2>By the end of this section you can</h2>
            <ul>
              {doc.outcomes.map((o) => (
                <li key={o}>
                  <span className="tick" aria-hidden="true">
                    ✓
                  </span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <SectionBody markdown={doc.body} />

        <div className="pager">
          {prev ? (
            <Link href={`/read/${prev.slug}`}>
              <small>Previous</small>§{prev.section} · {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/read/${next.slug}`} className="next">
              <small>Next</small>§{next.section} · {next.title}
            </Link>
          ) : (
            <span />
          )}
        </div>
      </main>
    </div>
  );
}
