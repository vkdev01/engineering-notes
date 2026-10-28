import Link from "next/link";
import { getCourse, getDocs } from "@/lib/content";

export default function Home() {
  const course = getCourse();
  const docs = getDocs();
  const exercises = docs.reduce((n, d) => n + (d.body.match(/^:::exercise/gm)?.length ?? 0), 0);

  return (
    <div className="shell">
      <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
        <section className="hero">
          <div className="meta">
            {course.version ?? "Reference"} · {docs.length} sections
          </div>
          <h1>{course.title}</h1>
          {course.subtitle ? <p className="sub">{course.subtitle}</p> : null}
          <div className="stats">
            <div>
              <b>{docs.length}</b> sections
            </div>
            <div>
              <b>{exercises}</b> exercises
            </div>
            <div>
              <b>{course.version ?? "1.0"}</b> version
            </div>
          </div>
        </section>

        <section className="toc" id="contents">
          <h2>Contents</h2>
          <ol>
            {docs.map((doc) => (
              <li key={doc.slug}>
                <Link href={`/read/${doc.slug}`}>
                  <span className="n">§{doc.section}</span>
                  <span className="t">
                    {doc.title}
                    {doc.abstract ? <span className="d">{doc.abstract}</span> : null}
                  </span>
                  <span className="k">{doc.time ?? ""}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
