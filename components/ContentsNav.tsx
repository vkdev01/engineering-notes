"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type NavDoc = {
  slug: string;
  section: string;
  title: string;
  abstract?: string;
  time?: string;
  headings: { text: string; id: string }[];
  exercises: number;
};

export default function ContentsNav({
  docs,
  current,
  course,
  courseTitle,
  totalExercises,
}: {
  docs: NavDoc[];
  current: string;
  course: string;
  courseTitle: string;
  totalExercises: number;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) =>
      `${d.title} ${d.abstract ?? ""} ${d.headings.map((h) => h.text).join(" ")}`.toLowerCase().includes(q),
    );
  }, [docs, query]);

  const first = docs[0];

  return (
    <>
      <div className="kicker">{courseTitle}</div>

      <label className="search">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${docs.length} sections…`}
          aria-label="Search sections"
        />
      </label>

      {first ? (
        <Link className="cta" href={`/c/${course}/${first.slug}`}>
          <div className="row">
            <span className="ic">§</span>
            <span>
              <span className="t">Read it in order</span>
              <span className="s">
                {docs.length} sections · {totalExercises} exercises
              </span>
            </span>
            <span className="arw">→</span>
          </div>
        </Link>
      ) : null}

      <div className="group">Sections</div>
      <ol>
        {filtered.map((doc) => (
          <li key={doc.slug} className={doc.slug === current ? "on" : undefined}>
            <Link className="item" href={`/c/${course}/${doc.slug}`}>
              <span className="n">§{doc.section}</span>
              <span>{doc.title}</span>
            </Link>
            {doc.slug === current && doc.headings.length ? (
              <ul className="sub">
                {doc.headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`}>{h.text}</a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>

      {!filtered.length ? <p className="empty">Nothing matches “{query}”.</p> : null}

      <div className="foot">
        {docs.length} sections · {totalExercises} exercises
      </div>
    </>
  );
}
