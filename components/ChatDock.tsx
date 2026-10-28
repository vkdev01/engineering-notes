"use client";

import { useEffect, useRef, useState } from "react";

type Source = { section: string; title: string; heading: string; slug: string; id: string };

type Msg = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: string;
};

const SUGGESTIONS = [
  "What is a harness, exactly?",
  "Why does a 600-line AGENTS.md hurt?",
  "What belongs in the repo?",
];

/** Escape first, then apply a tiny subset of markdown. Keeps model output inert. */
function render(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export default function ChatDock() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, open, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = [...messages, { role: "user" as const, content: q }];
    setMessages(history);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history
            .filter((m) => !m.error)
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = (await res.json()) as {
        answer?: string;
        sources?: Source[];
        error?: string;
        message?: string;
      };

      if (!res.ok || !data.answer) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "",
            sources: data.sources,
            error:
              data.error === "missing_key"
                ? "No Sarvam key is configured. Add SARVAM_API_KEY to .env.local and restart. The passages below are what the retriever found for your question."
                : data.message || "The chat backend is unavailable right now.",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.answer as string, sources: data.sources },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", error: "Could not reach the server." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="chat-fab" onClick={() => setOpen(true)}>
        <span className="dot" />
        Ask the docs
      </button>
    );
  }

  return (
    <section className="chat" aria-label="Ask the docs">
      <div className="chat-head">
        <span>Ask the docs</span>
        <span className="spacer" />
        <button type="button" onClick={() => setMessages([])} title="Clear conversation">
          clear
        </button>
        <button type="button" onClick={() => setOpen(false)} title="Close" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 ? (
          <div className="msg bot">
            <div className="who">assistant</div>
            <div className="body">
              <p>
                Answers come only from this tutorial’s content, with links to the sections they were drawn from. Ask
                about anything on the page.
              </p>
            </div>
          </div>
        ) : null}

        {messages.map((m, i) => (
          <div className={`msg ${m.role === "user" ? "user" : "bot"}`} key={i}>
            <div className="who">{m.role === "user" ? "you" : "assistant"}</div>
            {m.content ? <div className="body" dangerouslySetInnerHTML={{ __html: render(m.content) }} /> : null}
            {m.error ? <div className="err">{m.error}</div> : null}
            {m.sources?.length ? (
              <div className="sources">
                <span className="lbl">from</span>
                {m.sources.map((s) => (
                  <a key={s.id} href={`/read/${s.slug}#${s.id}`}>
                    §{s.section} · {s.heading}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {busy ? (
          <div className="msg bot">
            <div className="who">assistant</div>
            <div className="body" style={{ color: "var(--faint)" }}>
              <p>searching the tutorial…</p>
            </div>
          </div>
        ) : null}
      </div>

      {messages.length === 0 ? (
        <div className="chat-sugg">
          {SUGGESTIONS.map((s) => (
            <button type="button" key={s} onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="chat-note">grounded in this site · sarvam-105b</div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the material…"
          aria-label="Your question"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Ask
        </button>
      </form>
    </section>
  );
}
