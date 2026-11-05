import { toSegments, type Segment } from "@/lib/markdown";
import { EXERCISES } from "./exercises/registry";
import Figure from "./figures/Figures";
import Mermaid from "./Mermaid";
import Chart from "./Chart";
import CodeCopy from "./CodeCopy";

const DEFAULT_TITLES: Record<string, string> = {
  note: "Note",
  warn: "Watch out",
  tip: "Tip",
  example: "Worked example",
  key: "First principle",
};

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case "html":
            return <div key={i} className="md" dangerouslySetInnerHTML={{ __html: seg.html }} />;

          case "pull":
            return (
              <blockquote className="pull" key={i}>
                <Segments segments={seg.children} />
              </blockquote>
            );

          case "callout":
            return (
              <aside className={`ann ann-${seg.variant}`} key={i}>
                <b>{seg.title ?? DEFAULT_TITLES[seg.variant]}</b>
                <Segments segments={seg.children} />
              </aside>
            );

          case "figure":
            return (
              <figure className="fig" key={i}>
                <Figure id={seg.id} />
                {seg.caption ? (
                  <figcaption>
                    <span>{seg.caption}</span>
                    {seg.note ? <em>{seg.note}</em> : null}
                  </figcaption>
                ) : null}
              </figure>
            );

          case "chart":
            return <Chart key={i} caption={seg.caption} props={seg.props} data={seg.data} />;

          case "mermaid":
            return <Mermaid key={i} code={seg.code} caption={seg.caption} />;

          case "qa":
            return (
              <details className={`qa${seg.variant === "details" ? " qa-details" : ""}`} key={i}>
                <summary>
                  <span className="q-mark">{seg.variant === "details" ? "+" : "Q"}</span>
                  {seg.question}
                </summary>
                <div className="qa-body">
                  <Segments segments={seg.children} />
                </div>
              </details>
            );

          case "exercise": {
            const Exercise = EXERCISES[seg.id];
            if (!Exercise) {
              return (
                <aside className="ann ann-warn" key={i}>
                  <b>Unknown exercise</b>
                  No component is registered for <code>{seg.id}</code>. Add it to{" "}
                  <code>components/exercises/registry.tsx</code>.
                </aside>
              );
            }
            return (
              <div className="ex" key={i}>
                <div className="ex-head">
                  <span className="accent">{seg.label ?? "Exercise"}</span>
                  <span className="spacer" />
                  <span className="live">interactive</span>
                </div>
                <div className="ex-body">
                  <Exercise {...seg.props} />
                </div>
              </div>
            );
          }
        }
      })}
    </>
  );
}

export default function SectionBody({ markdown }: { markdown: string }) {
  return (
    <div className="prose">
      <Segments segments={toSegments(markdown)} />
      <CodeCopy />
    </div>
  );
}
