# Spec-sheet tutorial template

A content-driven Next.js template for technical tutorials and references. Course sidebar
with search and nested topics, one reading column, seven light colour schemes, interactive
exercises mounted from markdown, and an AI assistant that answers from your content using
the Sarvam API.

The layout follows the shape of [engineering-atlas.in](https://engineering-atlas.in/):
white canvas, a wide left sidebar of numbered sections with the active one highlighted and
its topics nested underneath, breadcrumbs above a large heading, a stat row, and a
"by the end of this section you can" card driven by frontmatter.

Everything you write lives in `content/*.md`. The app is generic: change the markdown, the
course title, and you have a different tutorial.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # optional: add SARVAM_API_KEY for the chat
npm run dev                    # http://localhost:3000
```

Build and run production:

```bash
npm run build
npm run start
```

Node 20+ required. Built and verified on Next.js 14.2.35.

---

## Content model

```
content/
  course.json                  course-level metadata
  01-why-agents-fail.md        one file per section
  02-what-a-harness-is.md
  ...
```

### `course.json`

```json
{
  "title": "Harness Engineering",
  "subtitle": "One sentence that appears under the title.",
  "version": "Reference 1.0",
  "credit": "Learn Harness Engineering (MIT)",
  "creditUrl": "https://github.com/…"
}
```

### Section frontmatter

```yaml
---
section: "2"          # the § number shown in the sidebar and the breadcrumb
title: "What a harness is"
kicker: "Definition"  # shown in the eyebrow: "Section 2 · Definition"
abstract: "…"         # the large standfirst under the H1
time: "10 min"        # shown in the card, the stat row and the sidebar
order: 2              # sort order; also drives prev/next
outcomes:             # optional; renders the "by the end you can" card
  - "Define the five subsystems of a harness"
  - "Score a real repository from 0 to 4 on each subsystem"
---
```

The filename is the URL: `content/03-repo-as-source-of-truth.md` → `/read/03-repo-as-source-of-truth`.

### Directives

Four block directives, each closed by a line containing only `:::`:

```markdown
:::note[Note 2.1.a — measurement]
Body text. Standard markdown works here.
:::

:::warn[Common error 2.2.a]
Rendered with the accent border.
:::

:::pull
A large serif pull quote.
:::

:::exercise[Exercise 02.1 · Score your own harness]{id="scorecard" labels="Instructions,Tools" scale="4"}
:::
```

Anything else is normal GitHub-flavoured markdown: headings, tables, lists, code fences,
links, blockquotes. `##` headings are automatically given ids and listed in the right-hand
"On this page" rail.

---

## Exercises

Exercises are React components registered by id. Three ship with the template:

| id | props | what it does |
| --- | --- | --- |
| `scorecard` | `labels`, `scale`, `hints`, `unit` | Sliders per criterion, reports the **minimum** and a verdict |
| `budget` | `window`, `perLine`, `perFile`, `tool`, `lines`, `files` | Context-window budget bars that react to two sliders |
| `checklist` | `items` (semicolon-separated), `grades` | Yes/No list that grades the result |

All props are strings, passed straight from the directive.

### Adding your own

1. Create `components/exercises/MyThing.tsx` — a client component that renders inside the
   exercise frame (do not render your own border):

```tsx
"use client";
export default function MyThing({ target = "3" }: { target?: string }) {
  return <div className="ex-body">…</div>;
}
```

2. Register it in `components/exercises/registry.tsx`:

```tsx
import MyThing from "./MyThing";
export const EXERCISES = { …, mything: MyThing };
```

3. Use it: `:::exercise[Try it]{id="mything" target="5"}`

Reusable CSS classes: `.sc` / `.sc-item` (slider rows), `.readout` (the result line),
`.budget` + `.legend`, `.verdict`, `.console`, `.ex-head`.

---

## Colour schemes

Seven light schemes, switched by the swatches in the top bar and remembered in
`localStorage` under `tutorial-theme`:

`atlas` (default, violet) · `oxblood` · `ink` · `moss` · `cobalt` · `rose` · `charcoal`

Each is one block of CSS variables at the top of `app/globals.css`:

```css
[data-theme="moss"] {
  --bg: #f5f6ef; --paper: #ffffff; --tint: #ecefe1;
  --ink: #15170f; --ink-2: #3a3f2c; --dim: #6a7059; --faint: #9aa088;
  --rule: #dde1cf; --rule-2: #c5cbb2;
  --accent: #3f6212; --accent-soft: #eaf3da;
  --accent-2: #5b4a1f; --accent-2-soft: #efe9d9;
}
```

To add a scheme: copy a block, change the hex values, add it to `THEMES` in
`components/ThemePicker.tsx`. To change the default, edit `data-theme` on the `<html>`
element in `app/layout.tsx`.

---

## The AI assistant

A floating **Ask the docs** panel. Answers are grounded in your markdown only.

**How a question is answered**

1. `POST /api/chat` receives the conversation.
2. `lib/retrieval.ts` scores every `##`-level chunk with BM25 and returns the top 4,
   padding with section intros when a short query only matches one clause.
3. The chunks are put in a system prompt that instructs the model to answer only from
   them, cite sections as `(§2.2)`, and admit when something is not covered.
4. `lib/sarvam.ts` calls `POST https://api.sarvam.ai/v1/chat/completions` with the
   `api-subscription-key` header.
5. The reply is returned with the source list, rendered as links to the exact clause.

**Configuration** (`.env.local`, server-side only — the key is never sent to the browser):

```bash
SARVAM_API_KEY=your-key            # https://dashboard.sarvam.ai
SARVAM_MODEL=sarvam-105b           # default
SARVAM_BASE_URL=https://api.sarvam.ai
```

Without a key the site still runs: the chat panel returns the retrieved passages and a
note explaining how to set the key, so you can see the retrieval working before you pay
for anything.

**Where it lives.** The trigger sits in the top bar (`ChatButton`), not as a floating bubble.
Clicking it opens `ChatPanel`, a full-height dock on the right edge: on screens wider than
1040px the page gives up exactly that width so the article is never covered, and below 900px
it becomes a full-screen sheet behind a scrim with the body scroll locked. Escape closes it,
and the two components talk through a single custom event, so the trigger can be moved
anywhere without touching the panel.

**In the static (GitHub Pages) build** the trigger is still rendered, but the panel opens with
the composer disabled and a note explaining that this build has no server. That is
deliberate: hiding it made the deployed site look like a different product. The panel is
wired to `disabled={STATIC_EXPORT}` in `app/layout.tsx`.

**Tuning**

- Retrieval depth and chunking: `lib/retrieval.ts` (`retrieve(query, k)`, `contextBlock`).
- Prompt and guardrails: `app/api/chat/route.ts`.
- Model, temperature, `max_tokens`, timeout: `lib/sarvam.ts`.
- To swap keyword search for embeddings, replace `retrieve()` — it is the only function
  the route calls.

---

## GitHub Pages (static build)

The repo ships a workflow (`.github/workflows/pages.yml`) that builds a static export and
publishes it to Pages at `https://<user>.github.io/spec-tutorial-template/`.

```bash
GITHUB_PAGES=1 NEXT_PUBLIC_STATIC_EXPORT=1 npm run build   # → out/
```

In Pages mode `next.config.mjs` sets `output: "export"`, `trailingSlash` and a `basePath`
of `/spec-tutorial-template`, so links and `_next` assets resolve under the project path.
The workflow moves `app/api` out of the way before exporting, because a route handler
cannot be exported — the Pages site is the tutorial **without** the chat. `ChatDock` is
not rendered in this mode and the footer says so.

The chat still works in the normal build (`npm run build && npm start`), which is what you
deploy to Vercel or any Node host.

## Replit

The repo carries a `.replit` file, so importing it runs the dev server on `0.0.0.0:3000`
and the preview works immediately. Add `SARVAM_API_KEY` under Secrets to enable the
assistant; without it the panel opens and explains that the key is missing.

Note that Replit's *Agent* (the "build me an app" flow) requires an active subscription,
but importing a public GitHub repo into a workspace does not.

## Deploying

The chat needs a server, so a static host (GitHub Pages, plain S3) will not work — the
page will render, but `/api/chat` will 404.

- **Vercel** — import the repo, add `SARVAM_API_KEY` as an environment variable. Zero config.
- **Replit / Fly / Railway / a VPS** — `npm run build && npm run start` behind a port.
- **Docker** — any `node:20-slim` base, copy the project, `npm ci`, build, start.

Set `SARVAM_API_KEY` in the host's environment, never in the repo.

---

## Structure

```
app/
  layout.tsx              shell, theme bootstrap, top bar, footer, chat dock
  page.tsx                landing page (hero + contents)
  read/[slug]/page.tsx    the three-column section view (statically generated)
  api/chat/route.ts       retrieval + Sarvam proxy
  globals.css             design system and the six schemes
components/
  TopBar.tsx  ThemePicker.tsx  SectionBody.tsx  ChatDock.tsx
  exercises/              Scorecard, ContextBudget, Checklist, registry
lib/
  content.ts              read + parse markdown, headings, prev/next
  markdown.ts             markdown → segments (html, callouts, exercises)
  retrieval.ts            chunking and BM25
  sarvam.ts               Sarvam chat client
content/                  your tutorial
```

---

## Notes

- Pinned to Next 14.2.35 (the patched 14.x line). Upgrading to Next 15+ requires making
  `params` a `Promise` in `app/read/[slug]/page.tsx` and its `generateMetadata`.
- Fonts load from Google Fonts via `@import` in `globals.css`, so there is no build-time
  font fetch. Swap for `next/font` if you want them self-hosted.
- The retrieval is intentionally dependency-free. For a large corpus, move to embeddings
  and a vector store — nothing else in the app needs to change.

## Licence

MIT.
