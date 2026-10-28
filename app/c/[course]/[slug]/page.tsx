import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SectionBody from "@/components/SectionBody";
import ContentsNav from "@/components/ContentsNav";
import MenuToggle from "@/components/MenuToggle";
import { countExercises, getCourse, getCourses, getDoc, getDocs, neighbours } from "@/lib/content";

type Params = { course: string; slug: string };

export function generateStaticParams(): Params[] {
  return getCourses().flatMap((course) =>
    getDocs(course.slug).map((doc) => ({ course: course.slug, slug: doc.slug })),
  );
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const doc = getDoc(params.course, params.slug);
  return { title: doc ? `${doc.title} — §${doc.section}` : "Not found" };
}

export default function SectionPage({ params }: { params: Params }) {
  const course = getCourse(params.course);
  const doc = getDoc(params.course, params.slug);
  if (!course || !doc) notFound();

  const docs = getDocs(course.slug);
  const { prev, next } = neighbours(course.slug, doc.slug);
  const exercises = countExercises(doc.body);

  const navDocs = docs.map((d) => ({
    slug: d.slug,
    section: d.section,
    title: d.title,
    abstract: d.abstract,
    time: d.time,
    headings: d.headings,
    exercises: countExercises(d.body),
  }));

  return (
    <div className="shell">
      <nav className="idx" aria-label="Contents">
        <ContentsNav
          docs={navDocs}
          current={doc.slug}
          course={course.slug}
          courseTitle={course.title}
          totalExercises={course.exercises}
        />
      </nav>

      <main className="doc">
        <div className="crumbrow">
          <MenuToggle />
          <span className="path">
            <Link href="/">Library</Link>
            <span className="sep">/</span>
            <Link href={`/c/${course.slug}`}>{course.title}</Link>
            <span className="sep">/</span>
            <span className="here">§{doc.section}</span>
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
            <Link href={`/c/${course.slug}/${prev.slug}`}>
              <small>Previous</small>§{prev.section} · {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/c/${course.slug}/${next.slug}`} className="next">
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
