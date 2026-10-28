"use client";

import { useEffect, useState } from "react";

export const THEMES = [
  { id: "atlas", label: "Atlas", swatch: "#6d28d9" },
  { id: "oxblood", label: "Oxblood", swatch: "#8c2f39" },
  { id: "ink", label: "Ink", swatch: "#24405c" },
  { id: "moss", label: "Moss", swatch: "#3f6212" },
  { id: "cobalt", label: "Cobalt", swatch: "#1e40af" },
  { id: "rose", label: "Rose", swatch: "#9d174d" },
  { id: "charcoal", label: "Charcoal", swatch: "#7c5c1a" },
] as const;

export const STORAGE_KEY = "tutorial-theme";

export default function ThemePicker() {
  const [theme, setTheme] = useState<string>("atlas");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) {
      setTheme(saved);
      document.documentElement.dataset.theme = saved;
    }
  }, []);

  function pick(id: string) {
    setTheme(id);
    document.documentElement.dataset.theme = id;
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode */
    }
  }

  return (
    <div className="themes">
      <span className="lbl">scheme</span>
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          aria-label={`${t.label} colour scheme`}
          aria-pressed={theme === t.id}
          onClick={() => pick(t.id)}
          style={{ ["--swatch" as string]: t.swatch } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
