import type { Metadata } from "next";
import fs from "fs";
import path from "path";
import "./globals.css";
import TopBar from "@/components/TopBar";
import ChatPanel from "@/components/ChatPanel";
import { totals } from "@/lib/content";

type Site = { title: string; tagline?: string; description?: string };

function site(): Site {
  const file = path.join(process.cwd(), "content", "site.json");
  if (!fs.existsSync(file)) return { title: "Engineering Notes" };
  return JSON.parse(fs.readFileSync(file, "utf8")) as Site;
}

export function generateMetadata(): Metadata {
  const meta = site();
  return { title: `${meta.title} — reference`, description: meta.description ?? meta.tagline ?? "" };
}

const STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

const THEME_SCRIPT = `try{var t=localStorage.getItem('tutorial-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = site();
  const t = totals();

  return (
    <html lang="en" data-theme="atlas" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <TopBar title={meta.title} version={meta.tagline} exerciseCount={t.exercises} />
        {children}
        <footer className="site">
          {t.courses} courses · {t.sections} sections · {t.exercises} exercises · content lives in{" "}
          <code>content/&lt;course&gt;/*.md</code>
          {STATIC_EXPORT ? " · static build: the assistant is visible but disabled here" : ""}
        </footer>
        <ChatPanel disabled={STATIC_EXPORT} />
      </body>
    </html>
  );
}
