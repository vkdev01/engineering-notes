import Link from "next/link";
import fs from "fs";
import path from "path";
import { getCourses, totals } from "@/lib/content";

function site() {
  const file = path.join(process.cwd(), "content", "site.json");
  if (!fs.existsSync(file)) return { title: "Engineering Notes", tagline: "", description: "" };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export default function Home() {
  const courses = getCourses();
  const t = totals();
  const meta = site();

  return (
    <div className="shell">
      <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
        <section className="hero">
          <div className="meta">Library</div>
          <h1>{meta.title}</h1>
          {meta.tagline ? <p className="sub">{meta.tagline}</p> : null}
          <div className="stats">
            <div>
              <b>{t.courses}</b> courses
            </div>
            <div>
              <b>{t.sections}</b> sections
            </div>
            <div>
              <b>{t.exercises}</b> exercises
            </div>
          </div>
        </section>

        <section className="catalogue" id="contents">
          <div className="catalogue-head">
            <h2>Courses</h2>
            <span>each one is a folder of markdown files</span>
          </div>
          <div className="cards">
            {courses.map((course) => (
              <Link className="card" href={`/c/${course.slug}`} key={course.slug}>
                <div className="card-top">
                  <span className="card-num">{course.sections} sections</span>
                  <span className="card-time">
                    {course.status ? `${course.status} · ` : ""}
                    {course.version ?? ""}
                  </span>
                </div>
                <h3 className="card-title">{course.title}</h3>
                {course.subtitle ? <p className="card-desc">{course.subtitle}</p> : null}
                <span className="card-foot">
                  Open the course <span className="arrow">→</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
