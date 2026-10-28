import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { countExercises, getCourse, getCourses, getDocs } from "@/lib/content";

type Params = { course: string };

export function generateStaticParams(): Params[] {
  return getCourses().map((c) => ({ course: c.slug }));
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const course = getCourse(params.course);
  return { title: course ? `${course.title} — course` : "Not found" };
}

export default function CoursePage({ params }: { params: Params }) {
  const course = getCourse(params.course);
  if (!course) notFound();
  const docs = getDocs(course.slug);

  return (
    <div className="shell">
      <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
        <div className="crumbrow" style={{ paddingTop: 30, marginBottom: 0 }}>
          <span className="path">
            <Link href="/">Library</Link>
            <span className="sep">/</span>
            <span className="here">{course.title}</span>
          </span>
        </div>

        <section className="hero" style={{ paddingTop: 24 }}>
          <div className="meta">{course.version ?? "Course"}</div>
          <h1>{course.title}</h1>
          {course.subtitle ? <p className="sub">{course.subtitle}</p> : null}
          <div className="stats">
            <div>
              <b>{course.sections}</b> sections
            </div>
            <div>
              <b>{course.exercises}</b> exercises
            </div>
            <div>
              <b>{course.minutes || "—"}</b> minutes of reading
            </div>
          </div>
        </section>

        <section className="catalogue">
          <div className="catalogue-head">
            <h2>Contents</h2>
            <span>read in order, or jump to what you need</span>
          </div>
          <div className="cards">
            {docs.map((doc) => {
              const n = countExercises(doc.body);
              return (
                <Link className={`card${n ? " ex-card" : ""}`} href={`/c/${course.slug}/${doc.slug}`} key={doc.slug}>
                  <div className="card-top">
                    <span className="card-num">§{doc.section}</span>
                    <span className="card-time">
                      {doc.time ?? ""}
                      {n ? ` · ${n} exercise${n > 1 ? "s" : ""}` : ""}
                    </span>
                  </div>
                  <h3 className="card-title">{doc.title}</h3>
                  {doc.abstract ? <p className="card-desc">{doc.abstract}</p> : null}
                  <span className="card-foot">
                    Open the section <span className="arrow">→</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        {course.credit ? (
          <p style={{ fontSize: 14, color: "var(--faint)", paddingBottom: 40 }}>
            Based on{" "}
            <a href={course.creditUrl} target="_blank" rel="noreferrer">
              {course.credit}
            </a>
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}
