"use client";

import { useState } from "react";

type Props = {
  /** cost of acting "yes" on a bad case (false positive), default 120000 */
  fp?: string;
  /** cost of acting "no" on a good case (false negative), default 24000 */
  fn?: string;
  /** cost of sending a case to review, default 900 */
  review?: string;
  /** action names, comma-separated: no,review,yes */
  actions?: string;
  currency?: string;
};

const LO = 1;
const HI = 6;
const toSlider = (v: number) => Math.round(((Math.log10(Math.max(10, v)) - LO) / (HI - LO)) * 1000);
const fromSlider = (s: number) => {
  const v = Math.pow(10, LO + (s / 1000) * (HI - LO));
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
};

export default function ThresholdLab({ fp, fn, review, actions, currency = "₹" }: Props) {
  const [cFP, setFP] = useState(Number(fp) || 120000);
  const [cFN, setFN] = useState(Number(fn) || 24000);
  const [cR, setR] = useState(Number(review) || 900);
  const [p, setP] = useState(0.7);
  const [no, rev, yes] = (actions ?? "decline,review,approve").split(",").map((s) => s.trim());

  const money = (v: number) => currency + Math.round(v).toLocaleString("en-IN");
  const pStar = cFP / (cFP + cFN);
  const lo = cR / cFN;
  const hi = 1 - cR / cFP;
  const hasBand = lo < hi;
  const cuts = hasBand ? [lo, hi] : [pStar, pStar];

  const costs = [
    { a: no, v: cFN * p },
    { a: rev, v: cR },
    { a: yes, v: cFP * (1 - p) },
  ];
  const best = costs.reduce((m, c) => (c.v < m.v ? c : m));

  const rows: [string, number, (v: number) => void][] = [
    [`${yes} a bad case`, cFP, setFP],
    [`${no} a good case`, cFN, setFN],
    [`one ${rev}`, cR, setR],
  ];

  return (
    <>
      <p className="lead">
        Drag the three costs. The model only supplies p = P(good); everything on this card is arithmetic you can do
        before training anything.
      </p>
      <div className="sc">
        {rows.map(([label, value, set], i) => (
          <div className="sc-item" key={label}>
            <label htmlFor={`tl-${i}`}>Cost: {label}</label>
            <input
              id={`tl-${i}`}
              type="range"
              min={0}
              max={1000}
              value={toSlider(value)}
              onChange={(e) => set(fromSlider(Number(e.target.value)))}
            />
            <em>{money(value)}</em>
          </div>
        ))}
        <div className="sc-item">
          <label htmlFor="tl-p">Model says p =</label>
          <input id="tl-p" type="range" min={0} max={100} value={Math.round(p * 100)} onChange={(e) => setP(Number(e.target.value) / 100)} />
          <em>{p.toFixed(2)}</em>
        </div>
      </div>

      <div className="tl-strip" aria-label="Optimal action by probability">
        <div style={{ width: `${cuts[0] * 100}%`, background: "var(--c3)" }}>{cuts[0] > 0.08 ? no : ""}</div>
        {hasBand ? (
          <div style={{ width: `${(cuts[1] - cuts[0]) * 100}%`, background: "var(--c2)" }}>
            {cuts[1] - cuts[0] > 0.08 ? rev : ""}
          </div>
        ) : null}
        <div style={{ width: `${(1 - cuts[1]) * 100}%`, background: "var(--c1)" }}>{1 - cuts[1] > 0.08 ? yes : ""}</div>
        <span className="tl-pin" style={{ left: `${p * 100}%` }} />
      </div>
      <div className="tl-axis">
        <span>p = 0</span>
        <span>p = 1</span>
      </div>

      <div className="readout">
        <span className="big">{pStar.toFixed(3)}</span>
        <span className="of">{yes.toUpperCase()} THRESHOLD</span>
        <p>
          {hasBand ? (
            <>
              <b>
                {rev} band {lo.toFixed(3)} – {hi.toFixed(3)}
              </b>{" "}
              covers {((hi - lo) * 100).toFixed(0)}% of the probability range. At p = {p.toFixed(2)} the cheapest action is{" "}
              <b>{best.a}</b> ({money(best.v)} expected).
            </>
          ) : (
            <>
              <b>No {rev} band:</b> a {rev} costs more than the expected loss it prevents everywhere. At p = {p.toFixed(2)} the
              cheapest action is <b>{best.a}</b> ({money(best.v)} expected).
            </>
          )}
        </p>
      </div>
    </>
  );
}
