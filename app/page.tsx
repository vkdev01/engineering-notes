import Link from "next/link";
import { getCourse, getDocs } from "@/lib/content";

function exerciseCount(body: string): number {
  return body.match(/^:::exercise/gm)?.length ?? 0;
}

export default function Home() {
  const course = getCourse();
  const docs = getDocs();
  const exercises = docs.reduce((n, d) => n + exerciseCount(d.body), 0);
  const minutes = docs.reduce((n, d) => n + (parseInt(d.time ?? "0", 10) || 0), 0);

  return (
    <div className="shell">
      <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
        <section className="hero">
          <div className="meta">{course.version ?? "Reference"}</div>
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
              <b>{minutes || "—"}</b> minutes of reading
            </div>
          </div>
        </section>

        <section className="catalogue" id="contents">
          <div className="catalogue-head">
            <h2>Contents</h2>
            <span>read in order, or jump to what you need</span>
          </div>
          <div className="cards">
            {docs.map((doc) => {
              const n = exerciseCount(doc.body);
              return (
                <Link className={`card${n ? " ex-card" : ""}`} href={`/read/${doc.slug}`} key={doc.slug}>
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
      </div>
    </div>
  );
}
