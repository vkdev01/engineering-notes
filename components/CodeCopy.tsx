"use client";

import { useEffect } from "react";

/** One delegated listener for every code block's Copy button. */
export default function CodeCopy() {
  useEffect(() => {
    const onClick = async (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".code-copy");
      if (!btn) return;
      const code = btn.parentElement?.querySelector("pre code");
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent ?? "");
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Press ⌘C";
      }
      window.setTimeout(() => (btn.textContent = "Copy"), 1400);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
