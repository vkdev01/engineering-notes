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
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs";
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
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--paper", "#ffffff"),
    primaryColor: v("--tint", "#f6f6f9"),
    primaryTextColor: v("--ink", "#101114"),
    primaryBorderColor: v("--rule-2", "#d6d6e0"),
    lineColor: v("--dim", "#5c6069"),
    secondaryColor: v("--accent-soft", "#f2ecfe"),
    tertiaryColor: v("--tint-2", "#fafafc"),
    fontFamily: v("--sans", "system-ui"),
    fontSize: "14px",
  };
}

let counter = 0;

export default function Mermaid({ code, caption }: { code: string; caption?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function draw() {
      try {
        const mermaid = await loadMermaid();
        if (cancelled || !ref.current) return;
        mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: scheme(), securityLevel: "loose" });
        const id = `mmd-${counter++}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    draw();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return (
      <figure className="fig mermaid-fallback">
        <pre>{code}</pre>
        {caption ? <figcaption><span>{caption}</span></figcaption> : null}
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
