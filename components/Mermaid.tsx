"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a mermaid diagram from source.
 *
 * mermaid is ~1 MB, so it is loaded from a CDN on demand — only pages that contain a
 * diagram pay for it, and the browser caches it after the first one. If the script cannot
 * be fetched (offline, blocked), the source is shown instead so nothing is lost.
 */

let loader: Promise<any> | null = null;

function loadMermaid(): Promise<any> {
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.mermaid) return resolve(w.mermaid);
    const s = document.createElement("script");
    s.type = "module";
    s.textContent = `
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      window.mermaid = mermaid;
      window.dispatchEvent(new Event("mermaid-ready"));
    `;
    s.onerror = () => reject(new Error("mermaid script failed"));
    document.head.appendChild(s);
    const t = setTimeout(() => reject(new Error("mermaid timeout")), 12000);
    window.addEventListener(
      "mermaid-ready",
      () => {
        clearTimeout(t);
        resolve((window as any).mermaid);
      },
      { once: true },
    );
  });
  return loader;
}

function scheme() {
  // Theme vars may be color-mix(); mermaid only parses plain colours, so resolve to hex.
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", {
    willReadFrequently: true,
  });
  const v = (name: string, fallback: string) => {
    probe.style.color = `var(${name}, ${fallback})`;
    const resolved = getComputedStyle(probe).color;
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fallback;
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  const out = {
    background: v("--paper", "#ffffff"),
    primaryColor: v("--tint", "#f6f6f9"),
    primaryTextColor: v("--ink", "#101114"),
    primaryBorderColor: v("--rule-2", "#d6d6e0"),
    lineColor: v("--dim", "#5c6069"),
    secondaryColor: v("--accent-soft", "#f2ecfe"),
    tertiaryColor: v("--accent-2-soft", "#fafafc"),
    clusterBkg: v("--tint-2", "#fafafc"),
    clusterBorder: v("--rule-2", "#d6d6e0"),
    edgeLabelBackground: v("--tint-2", "#fafafc"),
    noteBkgColor: v("--accent-soft", "#f2ecfe"),
    noteBorderColor: v("--accent", "#6d28d9"),
    noteTextColor: v("--ink", "#101114"),
    actorBkg: v("--tint", "#f6f6f9"),
    actorBorder: v("--rule-2", "#d6d6e0"),
    signalColor: v("--ink-2", "#33363c"),
    pie1: v("--c1", "#6d28d9"),
    pie2: v("--c2", "#0e7490"),
    pie3: v("--c3", "#c2410c"),
    pie4: v("--c4", "#8b8f98"),
    pie5: v("--c5", "#b794f4"),
    pie6: v("--c6", "#7cc4d6"),
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--sans").trim() || "system-ui",
    fontSize: "14px",
  };
  probe.remove();
  return out;
}

/**
 * Mermaid rejects unquoted labels containing ( ) { } — e.g. `M[Model: P(y|x)]`.
 * Quote any node label that has them, so authors can write natural text.
 */
export function sanitize(src: string): string {
  return src
    .split("\n")
    .map((line) =>
      line.replace(/(\b[A-Za-z][\w-]*)(\[|\{)(?!["\[{(/\\])([^\]}\n"]*?[(){}<>;#&][^\]}\n"]*?)(\]|\})/g, (m, id, open, text, close) =>
        (open === "[" && close === "]") || (open === "{" && close === "}")
          ? `${id}${open}"${text.replace(/"/g, "#quot;")}"${close}`
          : m,
      ),
    )
    .join("\n");
}

let counter = 0;

export default function Mermaid({ code, caption }: { code: string; caption?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | undefined>(undefined);

  // re-draw when the colour scheme changes
  useEffect(() => {
    const el = document.documentElement;
    setTheme(el.dataset.theme);
    const obs = new MutationObserver(() => setTheme(el.dataset.theme));
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (theme === undefined) return;
    let cancelled = false;

    async function draw() {
      try {
        const mermaid = await loadMermaid();
        if (cancelled || !ref.current) return;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: scheme(),
          securityLevel: "strict",
          suppressErrorRendering: true,
          flowchart: { htmlLabels: true, curve: "basis" },
        });
        const id = `mmd-${counter++}`;
        const { svg } = await mermaid.render(id, sanitize(code));
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setFailed(e instanceof Error ? e.message.split("\n")[0] : "render failed");
      }
    }

    void draw();
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (failed) {
    return (
      <figure className="fig mermaid-fallback">
        <pre>{code}</pre>
        <figcaption>
          {caption ? <span>{caption}</span> : null}
          <em>diagram could not be drawn: {failed}</em>
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="fig mermaid-fig">
      <div className="mermaid-out" ref={ref} aria-label={caption ?? "diagram"} />
      {caption ? (
        <figcaption>
          <span>{caption}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
