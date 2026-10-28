import { toSegments } from "@/lib/markdown";
import { EXERCISES } from "./exercises/registry";

export default function SectionBody({ markdown }: { markdown: string }) {
  const segments = toSegments(markdown);

  return (
    <div className="prose">
      {segments.map((seg, i) => {
        if (seg.kind === "html") {
          return <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />;
        }

        if (seg.kind === "callout") {
          if (seg.variant === "pull") {
            return (
              <blockquote className="pull" key={i}>
                {seg.html}
              </blockquote>
            );
          }
          return (
            <div className={`ann${seg.variant === "warn" ? " warn" : ""}`} key={i}>
              {seg.title ? <b>{seg.title}</b> : null}
              <div dangerouslySetInnerHTML={{ __html: seg.html }} />
            </div>
          );
        }

        const Exercise = EXERCISES[seg.id];
        if (!Exercise) {
          return (
            <div className="ann warn" key={i}>
              <b>Unknown exercise</b>
              No component is registered for <code>{seg.id}</code>. Add it to{" "}
              <code>components/exercises/registry.tsx</code>.
            </div>
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
      })}
    </div>
  );
}
