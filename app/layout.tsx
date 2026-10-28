import type { Metadata } from "next";
import "./globals.css";
import TopBar from "@/components/TopBar";
import ChatDock from "@/components/ChatDock";
import { getCourse, getDocs, exerciseCount } from "@/lib/content";

export function generateMetadata(): Metadata {
  const course = getCourse();
  return {
    title: `${course.title} — reference`,
    description: course.subtitle ?? "A reference-style tutorial.",
  };
}

const STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

const THEME_SCRIPT = `try{var t=localStorage.getItem('tutorial-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const course = getCourse();
  const docs = getDocs();

  return (
    <html lang="en" data-theme="oxblood" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <TopBar title={course.title} version={course.version} exerciseCount={exerciseCount()} />
        {children}
        <footer className="site">
          {docs.length} sections · {exerciseCount()} exercises
          {course.credit ? (
            <>
              {" · "}
              based on{" "}
              <a href={course.creditUrl} target="_blank" rel="noreferrer">
                {course.credit}
              </a>
            </>
          ) : null}{" "}
          · content lives in <code>content/*.md</code>
          {STATIC_EXPORT ? " · static build: the assistant is visible but disabled here" : ""}
        </footer>
        <ChatDock disabled={STATIC_EXPORT} />
      </body>
    </html>
  );
}
