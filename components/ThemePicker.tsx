"use client";

import { useEffect, useRef, useState } from "react";

export const THEMES = [
  { id: "atlas", label: "Violet", swatch: "#6d28d9" },
  { id: "ink", label: "Navy", swatch: "#1f4e79" },
  { id: "moss", label: "Moss", swatch: "#3f6212" },
  { id: "cobalt", label: "Cobalt", swatch: "#1d4ed8" },
  { id: "rose", label: "Rose", swatch: "#a61e4d" },
  { id: "bronze", label: "Bronze", swatch: "#8a5a00" },
  { id: "wine", label: "Wine", swatch: "#9d2f3d" },
] as const;

export const STORAGE_KEY = "tutorial-theme";

/** Older builds stored different ids; map them so nobody loses their choice. */
const ALIASES: Record<string, string> = {
  charcoal: "bronze",
  oxblood: "wine",
};

export default function ThemePicker() {
  const [theme, setTheme] = useState<string>("atlas");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const id = saved ? (ALIASES[saved] ?? saved) : "atlas";
    if (THEMES.some((t) => t.id === id)) {
      setTheme(id);
      document.documentElement.dataset.theme = id;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(id: string) {
    setTheme(id);
    document.documentElement.dataset.theme = id;
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode */
    }
  }

  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div className="theme-menu" ref={boxRef}>
      <button
        type="button"
        className="theme-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Colour scheme: ${active.label}`}
        title={`Colour scheme: ${active.label}`}
        style={{ ["--dot" as string]: active.swatch } as React.CSSProperties}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 1.8a6.2 6.2 0 0 0 0 12.4z" fill="currentColor" opacity="0.9" />
        </svg>
      </button>

      {open ? (
        <div className="theme-pop" role="menu" aria-label="Accent colour">
          <div className="theme-pop-head">Accent</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === theme}
              className="theme-item"
              onClick={() => pick(t.id)}
            >
              <span className="theme-dot" style={{ background: t.swatch }} />
              <span className="theme-name">{t.label}</span>
              {t.id === theme ? (
                <svg className="theme-check" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
