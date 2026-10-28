"use client";

import { useMemo, useState } from "react";

type Props = {
  /** Semicolon-separated checklist items. */
  items?: string;
  /** Optional comma-separated grade thresholds, high to low, e.g. "6,5,3,1". */
  grades?: string;
};

const DEFAULT_ITEMS = [
  "The build passed when the session ended",
  "All tests passed, including pre-existing ones",
  "Verification ran in CI, not just locally",
  "Feature state and progress were written down",
  "Temp files and debug output were removed",
  "A cold clone still starts via the standard path",
];

const DEFAULT_GRADES = ["A", "B", "C", "D", "F"];

export default function Checklist({ items, grades }: Props) {
  const list = useMemo(
    () => (items ? items.split(";").map((s) => s.trim()).filter(Boolean) : DEFAULT_ITEMS),
    [items],
  );
  const marks = useMemo(
    () => (grades ? grades.split(",").map((s) => s.trim()) : DEFAULT_GRADES),
    [grades],
  );
  const [state, setState] = useState<Record<number, boolean>>({});

  const answered = Object.keys(state).length;
  const yes = Object.values(state).filter(Boolean).length;

  const gradeIndex = (() => {
    if (answered < list.length) return -1;
    const ratio = yes / list.length;
    const idx = Math.min(marks.length - 1, Math.floor((1 - ratio) * marks.length));
    return yes === list.length ? 0 : idx;
  })();

  return (
    <>
      {list.map((item, i) => (
        <div
          key={item}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) auto",
            gap: 10,
            alignItems: "center",
            padding: "8px 0",
            borderBottom: "1px solid var(--rule)",
            fontFamily: "var(--sans)",
            fontSize: 12.5,
            color: state[i] === undefined ? "var(--ink-2)" : state[i] ? "var(--ink)" : "var(--dim)",
          }}
        >
          <span>
            {state[i] === true ? "✓ " : state[i] === false ? "✕ " : "· "}
            {item}
          </span>
          <span style={{ display: "flex", gap: 5 }}>
            {[true, false].map((val) => (
              <button
                key={String(val)}
                type="button"
                onClick={() => setState((s) => ({ ...s, [i]: val }))}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 9,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  padding: "4px 7px",
                  cursor: "pointer",
                  borderRadius: 2,
                  border: `1px solid ${state[i] === val ? "var(--accent)" : "var(--rule-2)"}`,
                  background: state[i] === val ? "var(--accent)" : "transparent",
                  color: state[i] === val ? "var(--paper)" : "var(--faint)",
                }}
              >
                {val ? "Yes" : "No"}
              </button>
            ))}
          </span>
        </div>
      ))}
      <div className="readout">
        <span className="big">{answered ? yes : "—"}</span>
        <span className="of">
          / {list.length} {gradeIndex >= 0 ? `· GRADE ${marks[gradeIndex]}` : ""}
        </span>
        <p>
          {answered < list.length ? (
            <>Answer all {list.length} to grade the handoff.</>
          ) : yes === list.length ? (
            <>
              <b>Grade {marks[0]}.</b> The next session can start working immediately.
            </>
          ) : (
            <>
              <b>Grade {marks[gradeIndex]}.</b> Every missing line is paid for again at the start of the next session.
            </>
          )}
        </p>
      </div>
    </>
  );
}
