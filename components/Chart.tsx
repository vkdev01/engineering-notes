/* Charts from markdown.

   :::chart[Caption]{type="line" x="P(good)" y="expected cost" marks="0.833:threshold"}
   p, approve, review, decline
   0, 120000, 900, 0
   1, 0, 900, 24000
   :::

   Server-rendered SVG with no runtime; every colour is a theme variable, so charts follow
   the scheme picker. See README → "Charts" for the full option list. */

type Props = { caption?: string; props: Record<string, string>; data: string };

type Table = { header: string[]; rows: (string | number | null)[][] };

const W = 760;
const MARGIN = { r: 22, t: 18, b: 50 };

function parse(data: string): Table {
  const lines = data
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return { header: [], rows: [] };
  const sep = lines[0].includes("|") ? "|" : lines[0].includes("\t") ? "\t" : ",";
  // split on the separator, honouring "double-quoted, cells"
  const split = (l: string) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of l.replace(/^\||\|$/g, "")) {
      if (ch === '"') quoted = !quoted;
      else if (ch === sep && !quoted) {
        cells.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  const header = split(lines[0]);
  const rows = lines
    .slice(1)
    .filter((l) => !/^\|?\s*:?-{3,}/.test(l))
    .map((l) =>
      split(l).map((c, i) => {
        if (c === "" || c === "-" || c.toLowerCase() === "na") return i === 0 ? c : null;
        const n = Number(c.replace(/_/g, ""));
        return Number.isFinite(n) ? n : c;
      }),
    );
  return { header, rows };
}

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

function linearTicks(lo: number, hi: number, count = 5): { lo: number; hi: number; ticks: number[] } {
  if (lo === hi) {
    hi = lo + 1;
    lo = lo - (lo === 0 ? 0 : 1);
  }
  const step = niceStep(hi - lo, count);
  const nlo = Math.floor(lo / step + 1e-9) * step;
  const nhi = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = nlo; v <= nhi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo: nlo, hi: nhi, ticks };
}

function logTicks(lo: number, hi: number): { lo: number; hi: number; ticks: number[] } {
  const a = Math.floor(Math.log10(lo));
  const b = Math.ceil(Math.log10(hi));
  const ticks: number[] = [];
  for (let e = a; e <= b; e++) {
    ticks.push(Math.pow(10, e));
    if (b - a <= 2 && e < b) ticks.push(2 * Math.pow(10, e), 5 * Math.pow(10, e));
  }
  return { lo: Math.pow(10, a), hi: Math.pow(10, b), ticks: ticks.sort((x, y) => x - y) };
}

function trim(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function makeFormat(kind: string | undefined, prefix = "", unit = "") {
  return (v: number): string => {
    let s: string;
    const a = Math.abs(v);
    switch (kind) {
      case "pct":
        s = trim(v * 100, a < 0.1 ? 1 : 0) + "%";
        break;
      case "int":
        s = Math.round(v).toLocaleString("en-US");
        break;
      case "dec1":
        s = v.toFixed(1);
        break;
      case "dec2":
        s = v.toFixed(2);
        break;
      case "dec3":
        s = v.toFixed(3);
        break;
      default:
        if (a >= 1e9) s = trim(v / 1e9, 1) + "B";
        else if (a >= 1e6) s = trim(v / 1e6, 1) + "M";
        else if (a >= 1e4) s = trim(v / 1e3, 1) + "k";
        else if (a >= 100 || a === 0) s = trim(v, 0);
        else if (a >= 1) s = trim(v, 2);
        else s = trim(v, a >= 0.01 ? 3 : 4);
    }
    return prefix + s + unit;
  };
}

function marksOf(spec: string | undefined): { at: number; label: string }[] {
  if (!spec) return [];
  return spec
    .split(";")
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => {
      const [at, ...label] = m.split(":");
      return { at: Number(at), label: label.join(":").trim() };
    })
    .filter((m) => Number.isFinite(m.at));
}

function bandsOf(spec: string | undefined): { a: number; b: number; label: string }[] {
  if (!spec) return [];
  return spec
    .split(";")
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => {
      const [a, b, ...label] = m.split(":");
      return { a: Number(a), b: Number(b), label: label.join(":").trim() };
    })
    .filter((m) => Number.isFinite(m.a) && Number.isFinite(m.b));
}

const colour = (i: number) => `var(--c${(i % 6) + 1})`;
const flag = (v: string | undefined) => v === "true" || v === "1" || v === "yes";

export default function Chart({ caption, props, data }: Props) {
  const { header, rows } = parse(data);
  if (header.length < 2 || !rows.length) {
    return (
      <div className="ann ann-warn">
        <b>Chart</b>
        <div>Needs a header row and at least one data row.</div>
      </div>
    );
  }

  const type = props.type ?? "line";
  const H = Number(props.height ?? 300);
  const series = header.slice(1);
  const dashed = new Set((props.dash ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const fmtY = makeFormat(props.yfmt, props.prefix ?? "", props.unit ?? "");
  const fmtX = makeFormat(props.xfmt, props.xprefix ?? "", props.xunit ?? "");

  const categorical = type === "bar" || rows.some((r) => typeof r[0] !== "number");
  const stacked = flag(props.stacked);
  const ylog = flag(props.ylog);
  const xlog = flag(props.xlog) && !categorical;

  /* ---- y domain */
  const values: number[] = [];
  for (const r of rows) {
    if (stacked) {
      values.push(r.slice(1).reduce<number>((s, v) => s + (typeof v === "number" ? v : 0), 0));
    } else {
      for (const v of r.slice(1)) if (typeof v === "number") values.push(v);
    }
  }
  for (const m of marksOf(props.hmarks)) values.push(m.at);
  let ylo = props.ymin !== undefined ? Number(props.ymin) : Math.min(0, ...values);
  let yhi = props.ymax !== undefined ? Number(props.ymax) : Math.max(...values);
  if (ylog) ylo = props.ymin !== undefined ? Number(props.ymin) : Math.min(...values.filter((v) => v > 0));
  const yt = ylog ? logTicks(ylo, yhi) : linearTicks(ylo, yhi, 5);
  if (props.ymin === undefined) ylo = yt.lo;
  if (props.ymax === undefined) yhi = yt.hi;
  const yTicks = yt.ticks.filter((t) => t >= ylo - 1e-12 && t <= yhi + 1e-12);

  // leave room for the widest tick label, plus the rotated axis title
  const widest = Math.max(...yTicks.map((t) => fmtY(t).length));
  const M = { ...MARGIN, l: Math.max(48, widest * 7 + 18) + (props.y ? 20 : 0) };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const Y = (v: number) =>
    ylog
      ? M.t + ph - ((Math.log10(v) - Math.log10(ylo)) / (Math.log10(yhi) - Math.log10(ylo))) * ph
      : M.t + ph - ((v - ylo) / (yhi - ylo || 1)) * ph;

  /* ---- x domain */
  let X: (v: number) => number;
  let xTicks: { v: number; label: string }[];
  let band = 0;
  if (categorical) {
    band = pw / rows.length;
    X = (i: number) => M.l + band * (i + 0.5);
    const every = Math.ceil(rows.length / 12);
    xTicks = rows.map((r, i) => ({ v: i, label: String(r[0]) })).filter((_, i) => i % every === 0);
  } else {
    const xs = rows.map((r) => r[0] as number);
    let xlo = props.xmin !== undefined ? Number(props.xmin) : Math.min(...xs);
    let xhi = props.xmax !== undefined ? Number(props.xmax) : Math.max(...xs);
    if (xlog) {
      const t = logTicks(xlo, xhi);
      xTicks = t.ticks.filter((v) => v >= xlo - 1e-12 && v <= xhi + 1e-12).map((v) => ({ v, label: fmtX(v) }));
      X = (v: number) => M.l + ((Math.log10(v) - Math.log10(xlo)) / (Math.log10(xhi) - Math.log10(xlo) || 1)) * pw;
    } else {
      const t = linearTicks(xlo, xhi, 6);
      xTicks = t.ticks.filter((v) => v >= xlo - 1e-12 && v <= xhi + 1e-12).map((v) => ({ v, label: fmtX(v) }));
      const lo = xlo;
      const hi = xhi;
      X = (v: number) => M.l + ((v - lo) / (hi - lo || 1)) * pw;
    }
  }

  const showPoints = props.points ? flag(props.points) : type === "scatter" || rows.length <= 14;
  const showLabels = props.labels ? flag(props.labels) : type === "bar" && rows.length * series.length <= 16;
  const base = Y(ylog ? ylo : Math.max(ylo, Math.min(0, yhi)));

  /* ---- marks */
  const vmarks = marksOf(props.marks);
  const hmarks = marksOf(props.hmarks);
  const bands = bandsOf(props.band);

  const legend = series.length > 1 || props.legend === "true";

  return (
    <figure className="fig chart" role="group" aria-label={caption ?? "chart"}>
      {legend ? (
        <div className="chart-legend">
          {series.map((s, i) => (
            <span key={s}>
              <i
                style={{ background: colour(i), color: colour(i) }}
                className={dashed.has(s) ? "dash" : type === "bar" ? "box" : undefined}
              />
              {s}
            </span>
          ))}
        </div>
      ) : null}
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption ?? "chart"} className="chart-svg">
          {/* bands */}
          {bands.map((b, i) => {
            if (categorical) return null;
            const x1 = Math.max(M.l, X(b.a));
            const x2 = Math.min(M.l + pw, X(b.b));
            return (
              <g key={`b${i}`}>
                <rect x={x1} y={M.t} width={Math.max(0, x2 - x1)} height={ph} fill="var(--accent-soft)" opacity="0.75" />
                {b.label ? (
                  <text x={(x1 + x2) / 2} y={M.t + 14} textAnchor="middle" className="chart-mark-label">
                    {b.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* grid + y axis */}
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.l} x2={M.l + pw} y1={Y(t)} y2={Y(t)} className="chart-grid" />
              <text x={M.l - 10} y={Y(t) + 4} textAnchor="end" className="chart-tick">
                {fmtY(t)}
              </text>
            </g>
          ))}
          <line x1={M.l} x2={M.l + pw} y1={M.t + ph} y2={M.t + ph} className="chart-axis" />

          {/* x axis */}
          {xTicks.map((t) => (
            <text key={`x${t.v}`} x={X(t.v)} y={M.t + ph + 20} textAnchor="middle" className="chart-tick">
              {t.label}
            </text>
          ))}
          {props.x ? (
            <text x={M.l + pw / 2} y={H - 8} textAnchor="middle" className="chart-axis-label">
              {props.x}
            </text>
          ) : null}
          {props.y ? (
            <text
              x={14}
              y={M.t + ph / 2}
              textAnchor="middle"
              transform={`rotate(-90 14 ${M.t + ph / 2})`}
              className="chart-axis-label"
            >
              {props.y}
            </text>
          ) : null}

          {/* y = x reference, for reliability diagrams */}
          {flag(props.diag) && !categorical ? (
            <line
              x1={X(Math.max(ylo, xTicks[0]?.v ?? 0))}
              y1={Y(Math.max(ylo, xTicks[0]?.v ?? 0))}
              x2={X(Math.min(yhi, xTicks[xTicks.length - 1]?.v ?? 1))}
              y2={Y(Math.min(yhi, xTicks[xTicks.length - 1]?.v ?? 1))}
              className="chart-ref"
            />
          ) : null}

          {/* data */}
          {type === "bar"
            ? rows.map((r, i) => {
                const n = series.length;
                const inner = band * 0.72;
                const bw = stacked ? inner : inner / n;
                let acc = 0;
                return (
                  <g key={`r${i}`}>
                    {series.map((s, j) => {
                      const v = r[j + 1];
                      if (typeof v !== "number") return null;
                      const x = stacked ? X(i) - inner / 2 : X(i) - inner / 2 + j * bw;
                      const y0 = stacked ? Y(acc) : base;
                      const y1 = stacked ? Y(acc + v) : Y(v);
                      acc += v;
                      const top = Math.min(y0, y1);
                      const h = Math.abs(y1 - y0);
                      return (
                        <g key={s}>
                          <rect x={x + 1} y={top} width={Math.max(1, bw - 2)} height={Math.max(0.5, h)} rx={3} fill={colour(j)}>
                            <title>{`${r[0]} · ${s}: ${fmtY(v)}`}</title>
                          </rect>
                          {showLabels && !stacked ? (
                            <text x={x + bw / 2} y={top - 6} textAnchor="middle" className="chart-value">
                              {fmtY(v)}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
                    {showLabels && stacked ? (
                      <text x={X(i)} y={Y(acc) - 6} textAnchor="middle" className="chart-value">
                        {fmtY(acc)}
                      </text>
                    ) : null}
                  </g>
                );
              })
            : series.map((s, j) => {
                const pts = rows
                  .map((r, i) => ({ x: categorical ? i : (r[0] as number), y: r[j + 1], label: r[0] }))
                  .filter((p): p is { x: number; y: number; label: string | number | null } => typeof p.y === "number")
                  .filter((p) => !ylog || p.y > 0);
                const d = pts.map((p, k) => `${k ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
                return (
                  <g key={s}>
                    {type === "area" && pts.length > 1 ? (
                      <path
                        d={`${d} L${X(pts[pts.length - 1].x).toFixed(1)},${base} L${X(pts[0].x).toFixed(1)},${base} Z`}
                        fill={colour(j)}
                        opacity="0.12"
                      />
                    ) : null}
                    {type !== "scatter" ? (
                      <path
                        d={d}
                        fill="none"
                        stroke={colour(j)}
                        strokeWidth="2.4"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        strokeDasharray={dashed.has(s) ? "6 5" : undefined}
                      />
                    ) : null}
                    {showPoints
                      ? pts.map((p, k) => (
                          <circle key={k} cx={X(p.x)} cy={Y(p.y)} r={type === "scatter" ? 4 : 3.2} fill="var(--paper)" stroke={colour(j)} strokeWidth="2">
                            <title>{`${s} · ${categorical ? p.label : fmtX(p.x)}: ${fmtY(p.y)}`}</title>
                          </circle>
                        ))
                      : null}
                  </g>
                );
              })}

          {/* reference marks */}
          {hmarks.map((m, i) => (
            <g key={`h${i}`}>
              <line x1={M.l} x2={M.l + pw} y1={Y(m.at)} y2={Y(m.at)} className="chart-mark" />
              {m.label ? (
                <text x={M.l + pw - 4} y={Y(m.at) - 6} textAnchor="end" className="chart-mark-label">
                  {m.label}
                </text>
              ) : null}
            </g>
          ))}
          {!categorical
            ? vmarks.map((m, i) => {
                const x = X(m.at);
                const right = x > M.l + pw * 0.7;
                return (
                  <g key={`v${i}`}>
                    <line x1={x} x2={x} y1={M.t} y2={M.t + ph} className="chart-mark" />
                    {m.label ? (
                      <text
                        x={right ? x - 6 : x + 6}
                        y={M.t + 14 + (bands.length ? 16 : 0) + i * 16}
                        textAnchor={right ? "end" : "start"}
                        className="chart-mark-label"
                      >
                        {m.label}
                      </text>
                    ) : null}
                  </g>
                );
              })
            : null}
        </svg>
      </div>
      {caption || props.note ? (
        <figcaption>
          {caption ? <span>{caption}</span> : null}
          {props.note ? <em>{props.note}</em> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
