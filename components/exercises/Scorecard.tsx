"use client";

import { useMemo, useState } from "react";

type Props = {
  /** Comma-separated criterion names. Falls back to the harness five. */
  labels?: string;
  /** Top of the scale, default 4. */
  scale?: string;
  /** Optional per-criterion hint, comma-separated, same order. */
  hints?: string;
  /** Label for the total, e.g. "harness". */
  unit?: string;
};

const DEFAULT_LABELS = ["Instructions", "Tools", "Environment", "State", "Feedback"];

export default function Scorecard({ labels, scale, hints, unit }: Props) {
  const items = useMemo(
    () =>
      (labels ? labels.split(",").map((s) => s.trim()) : DEFAULT_LABELS).map((name, i) => ({
        name,
        hint: hints ? (hints.split(",")[i] ?? "").trim() : "",
      })),
    [labels, hints],
  );
  const max = Math.max(1, Number(scale) || 4);
  const [values, setValues] = useState<number[]>(() => items.map(() => Math.ceil(max / 2)));

  const total = values.reduce((a, b) => a + b, 0);
  const cap = items.length * max;
  const min = Math.min(...values);
  const weakest = items[values.indexOf(min)]?.name ?? "";

  let verdict: React.ReactNode;
  if (total === cap) {
    verdict = (
      <>
        <b>Nothing below {max}.</b> Now audit: remove one criterion at a time and see which removal actually hurts.
      </>
    );
  } else if (min <= Math.floor(max / 4) + 0) {
    verdict = (
      <>
        <b>Minimum = {min} ({weakest.toLowerCase()}).</b> This is your ceiling — nothing else you add will show up in
        session quality until it is fixed.
      </>
    );
  } else if (min === Math.ceil(max / 2)) {
    verdict = (
      <>
        <b>Minimum = {min} ({weakest.toLowerCase()}).</b> Mostly works, then fails without an attributable cause.
      </>
    );
  } else {
    verdict = (
      <>
        <b>Minimum = {min} ({weakest.toLowerCase()}).</b> Solid. The next marginal gain is in verification depth.
      </>
    );
  }

  return (
    <>
      <div className="sc">
        {items.map((item, i) => (
          <div className="sc-item" key={item.name}>
            <label htmlFor={`sc-${i}`} title={item.hint || undefined}>
              {item.name}
            </label>
            <input
              id={`sc-${i}`}
              type="range"
              min={0}
              max={max}
              step={1}
              value={values[i]}
              onChange={(e) => {
                const next = [...values];
                next[i] = Number(e.target.value);
                setValues(next);
              }}
            />
            <em>
              {values[i]} / {max}
            </em>
          </div>
        ))}
      </div>
      <div className="readout">
        <span className="big">{total}</span>
        <span className="of">
          / {cap} {unit ? unit.toUpperCase() : "TOTAL"}
        </span>
        <p>{verdict}</p>
      </div>
    </>
  );
}
