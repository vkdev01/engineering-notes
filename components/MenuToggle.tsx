"use client";

import { useEffect, useState } from "react";

const KEY = "tutorial-menu";

export default function MenuToggle() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "hidden") {
      setHidden(true);
      document.body.dataset.menu = "hidden";
    }
  }, []);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    document.body.dataset.menu = next ? "hidden" : "";
    try {
      window.localStorage.setItem(KEY, next ? "hidden" : "shown");
    } catch {
      /* ignore */
    }
  }

  return (
    <button type="button" className="menu" onClick={toggle} aria-pressed={hidden}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      {hidden ? "Show menu" : "Hide menu"}
    </button>
  );
}
