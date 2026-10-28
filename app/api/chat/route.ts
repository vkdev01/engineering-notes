import { NextResponse } from "next/server";
import { getCourse } from "@/lib/content";
import { contextBlock, retrieve } from "@/lib/retrieval";
import { slugify } from "@/lib/content";
import { hasKey, sarvamChat, type ChatMessage } from "@/lib/sarvam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Incoming = { messages?: { role: string; content: string }[] };

export async function POST(req: Request) {
  let body: Incoming | null = null;
  try {
    body = (await req.json()) as Incoming;
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
  }

  const history = (body?.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8);

  const question = history.filter((m) => m.role === "user").pop()?.content?.slice(0, 2000) ?? "";
  if (!question) {
    return NextResponse.json({ error: "bad_request", message: "No question supplied." }, { status: 400 });
  }

  const chunks = retrieve(question, 4);
  const sources = chunks.map((c) => ({
    section: c.section,
    title: c.sectionTitle,
    heading: c.heading,
    slug: c.slug,
    id: slugify(c.heading),
  }));

  if (!hasKey()) {
    return NextResponse.json(
      {
        error: "missing_key",
        message: "SARVAM_API_KEY is not configured on the server.",
        sources,
      },
      { status: 503 },
    );
  }

  const course = getCourse();
  const system = [
    `You are the teaching assistant for "${course.title}".`,
    "Answer ONLY from the context below. It is the tutorial the reader is looking at.",
    "Cite the section you used inline, like (§2.2), whenever you state a fact from it.",
    "If the context does not cover the question, say so plainly and name the closest section — never invent content.",
    "Be concise: 2–5 short sentences, plain prose, no headings. Use backticks for code identifiers.",
    "",
    "CONTEXT:",
    contextBlock(chunks),
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) })),
  ];

  const result = await sarvamChat(messages);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.status === 503 ? "missing_key" : "upstream",
        message: result.message,
        sources,
      },
      { status: result.status === 503 ? 503 : 502 },
    );
  }

  return NextResponse.json({ answer: result.content, sources });
}
