import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SectionBody from "@/components/SectionBody";
import { getDoc, getDocs, neighbours } from "@/lib/content";

type Params = { slug: string };

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

  const docs = getDocs();
  const index = docs.findIndex((d) => d.slug === doc.slug);
  const { prev, next } = neighbours(doc.slug);
  const exercises = doc.body.match(/^:::exercise/gm)?.length ?? 0;

  return (
    <div className="shell">
      <nav className="idx" aria-label="Contents">
        <h4>Contents</h4>
        <ol>
          {docs.map((d) => (
            <li key={d.slug} className={d.slug === doc.slug ? "on" : undefined}>
              <Link href={`/read/${d.slug}`}>
                <span className="n">§{d.section}</span>
                <span>{d.title}</span>
              </Link>
            </li>
          ))}
        </ol>
        <div className="foot">
          {docs.length} sections · {exercises > 0 ? `${exercises} exercise${exercises > 1 ? "s" : ""} here` : "no exercises"}
        </div>
      </nav>

      <main className="doc">
        <div className="sechead">
          <div className="meta">
            <span>
              Section §{doc.section}
              {doc.kicker ? ` · ${doc.kicker}` : ""}
              {exercises ? ` · ${exercises} exercise${exercises > 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <h1>{doc.title}</h1>
          {doc.abstract ? <p className="abstract">{doc.abstract}</p> : null}
        </div>

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

      <aside className="rail" aria-label="On this page">
        <h4>On this page</h4>
        <div className="box">
          <ul>
            {doc.headings.length ? (
              doc.headings.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`}>{h.text}</a>
                </li>
              ))
            ) : (
              <li>Single section</li>
            )}
          </ul>
        </div>
        <h4>Status</h4>
        <div className="box">
          <div className="kv">
            <span>Section</span>
            <b>
              {index + 1} of {docs.length}
            </b>
          </div>
          <div className="kv">
            <span>Exercises</span>
            <b>{exercises}</b>
          </div>
          <div className="kv">
            <span>Reading time</span>
            <b>{doc.time ?? "—"}</b>
          </div>
        </div>
        <h4>Margin</h4>
        <div className="box">
          <p className="note">
            Every section is a markdown file in <code>content/</code>. Edit the file, save, and the page rebuilds.
          </p>
        </div>
      </aside>
    </div>
  );
}
