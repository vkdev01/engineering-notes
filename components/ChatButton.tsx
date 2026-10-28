"use client";

import { OPEN_EVENT } from "./ChatPanel";

export default function ChatButton() {
  return (
    <button
      type="button"
      className="chat-trigger"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
      title="Ask the docs"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span>Ask the docs</span>
    </button>
  );
}
