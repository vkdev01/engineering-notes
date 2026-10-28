"use client";

import { useState } from "react";

type Props = {
  /** Context window in tokens. */
  window?: string;
  /** Approximate tokens per line of instructions. */
  perLine?: string;
  /** Approximate tokens per source file. */
  perFile?: string;
  /** Tokens consumed by tool output. */
  tool?: string;
  lines?: string;
  files?: string;
};

export default function ContextBudget(props: Props) {
  const WIN = Number(props.window) || 200_000;
  const PER_LINE = Number(props.perLine) || 30;
  const PER_FILE = Number(props.perFile) || 1200;
  const TOOL = Number(props.tool) || 30_000;

  const [lines, setLines] = useState(Number(props.lines) || 600);
  const [files, setFiles] = useState(Number(props.files) || 24);

  const instr = lines * PER_LINE;
  const src = files * PER_FILE;
  const used = instr + src + TOOL;
  const free = WIN - used;

  const segments = [
    { key: "Instructions", value: instr, colour: "var(--accent)" },
    { key: "Source files", value: src, colour: "var(--accent-2)" },
    { key: "Tool output", value: TOOL, colour: "#a16207" },
    { key: free >= 0 ? "Left for reasoning" : "OVERFLOW", value: Math.abs(free), colour: free >= 0 ? "#3f6212" : "#a5281b" },
  ];
  const total = segments.reduce((a, s) => a + s.value, 0);
  const pct = (instr / WIN) * 100;

  return (
    <>
      <p className="lead">
        A {Math.round(WIN / 1000)}k window, a task that needs real source files, and tool output you cannot avoid.
      </p>
      <div className="budget">
        {segments.map((s) => {
          const width = (s.value / total) * 100;
          return (
            <div key={s.key} style={{ width: `${width}%`, background: s.colour }}>
              {width > 13 ? `${Math.round(width)}%` : ""}
            </div>
          );
        })}
      </div>
      <div className="legend">
        {segments.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.colour }} />
            {s.key} · {Math.round(s.value / 1000)}k
          </span>
        ))}
      </div>

      <div className="sc" style={{ gap: 14 }}>
        <div>
          <div className="sc-item" style={{ gridTemplateColumns: "1fr auto" }}>
            <label htmlFor="cb-lines">Instruction file</label>
            <em>{lines} lines</em>
          </div>
          <input
            id="cb-lines"
            type="range"
            min={20}
            max={600}
            step={10}
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
          />
        </div>
        <div>
          <div className="sc-item" style={{ gridTemplateColumns: "1fr auto" }}>
            <label htmlFor="cb-files">Source files the task needs</label>
            <em>{files}</em>
          </div>
          <input
            id="cb-files"
            type="range"
            min={2}
            max={60}
            step={1}
            value={files}
            onChange={(e) => setFiles(Number(e.target.value))}
          />
        </div>
      </div>

      <div className={`verdict${free < 0 || pct > 8 ? " fail" : ""}`}>
        {free < 0 ? (
          <>
            <b>Over budget before you start.</b> The agent will skim instead of read, and its “done” gets even less
            trustworthy.
          </>
        ) : pct > 8 ? (
          <>
            <b>Instruction bloat.</b> {pct.toFixed(0)}% of the window is gone before any code is read — the range where
            rules start crowding out reasoning.
          </>
        ) : (
          <>
            <b>Healthy.</b> {pct.toFixed(1)}% on instructions, {Math.round(free / 1000)}k left for reasoning and
            verification.
          </>
        )}
      </div>
    </>
  );
}
