/* Diagrams for the harness-engineering course.
   Hand-drawn SVG on purpose: no runtime, no dependency, and they inherit the
   colour scheme through CSS variables. Reference one from markdown with
   :::figure[Caption]{id="subsystems"} */

const S = {
  box: { fill: "var(--paper)", stroke: "var(--rule-2)", strokeWidth: 1.5 },
  accent: { fill: "var(--accent-soft)", stroke: "var(--accent)", strokeWidth: 1.5 },
  good: { fill: "var(--accent-2-soft, #e7f4ef)", stroke: "var(--accent-2, #1f7a5c)", strokeWidth: 1.5 },
  ghost: { fill: "none", stroke: "var(--rule-2)", strokeWidth: 1.5, strokeDasharray: "5 4" },
  text: { fill: "var(--ink)", fontFamily: "var(--sans)", fontSize: 13 },
  small: { fill: "var(--dim)", fontFamily: "var(--sans)", fontSize: 11 },
  mono: { fill: "var(--faint)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.08em" },
};

function Box({
  x, y, w, h, label, sub, style = S.box, radius = 8,
}: {
  x: number; y: number; w: number; h: number; label: string; sub?: string;
  style?: Record<string, unknown>; radius?: number;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={radius} {...style} />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 2 : h / 2 + 4)} textAnchor="middle" {...S.text}>
        {label}
      </text>
      {sub ? (
        <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" {...S.small}>
          {sub}
        </text>
      ) : null}
    </g>
  );
}

function Arrow({ d, label, lx, ly, colour = "var(--rule-2)" }: { d: string; label?: string; lx?: number; ly?: number; colour?: string }) {
  return (
    <g>
      <path d={d} fill="none" stroke={colour} strokeWidth="1.5" markerEnd="url(#arw)" />
      {label ? (
        <text x={lx} y={ly} textAnchor="middle" {...S.small}>
          {label}
        </text>
      ) : null}
    </g>
  );
}

const Defs = () => (
  <defs>
    <marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--rule-2)" />
    </marker>
  </defs>
);

/* ---------------------------------------------------------------- */
const FIGURES: Record<string, { w: number; h: number; node: React.ReactNode }> = {
  /* 1. the five subsystems */
  subsystems: {
    w: 720,
    h: 250,
    node: (
      <>
        <rect x={8} y={10} width={704} height={196} rx={12} fill="none" stroke="var(--rule)" strokeDasharray="6 5" />
        <text x={24} y={32} {...S.mono}>
          THE HARNESS — EVERYTHING OUTSIDE THE MODEL WEIGHTS
        </text>
        <Box x={28} y={50} w={124} h={70} label="Instructions" sub="AGENTS.md · docs" />
        <Box x={166} y={50} w={124} h={70} label="Tools" sub="shell · tests · lint" />
        <Box x={304} y={50} w={124} h={70} label="Environment" sub="init.sh · lockfile" />
        <Box x={442} y={50} w={124} h={70} label="State" sub="feature_list · log" />
        <Box x={580} y={50} w={116} h={70} label="Feedback" sub="tests · traces" />
        <text x={28} y={146} {...S.small}>
          A prompt file is one artefact inside the first box.
        </text>
        <text x={28} y={168} {...S.small}>
          Reliability is bounded by the weakest box, not the average.
        </text>
        <text x={28} y={190} {...S.small}>
          Remove one at a time to find out which are load-bearing today.
        </text>
        <rect x={196} y={222} width={328} height={22} rx={11} fill="var(--accent-soft)" stroke="var(--accent)" />
        <text x={360} y={237} textAnchor="middle" {...S.mono} style={{ fill: "var(--accent)" }}>
          THE MODEL SITS INSIDE ALL OF IT
        </text>
      </>
    ),
  },

  /* 2. two sessions over time */
  timeline: {
    w: 720,
    h: 260,
    node: (
      <>
        <Defs />
        <text x={8} y={20} {...S.mono}>
          BARE — NO STATE, NO INIT PHASE
        </text>
        <rect x={8} y={30} width={130} height={30} rx={6} {...S.ghost} />
        <text x={73} y={49} textAnchor="middle" {...S.small}>
          explore 8m
        </text>
        <rect x={142} y={30} width={180} height={30} rx={6} {...S.box} />
        <text x={232} y={49} textAnchor="middle" {...S.small}>
          implement 40%
        </text>
        <rect x={326} y={30} width={150} height={30} rx={6} {...S.ghost} />
        <text x={401} y={49} textAnchor="middle" {...S.small}>
          re-explore 15m
        </text>
        <rect x={480} y={30} width={170} height={30} rx={6} {...S.box} />
        <text x={565} y={49} textAnchor="middle" {...S.small}>
          work, different approach
        </text>
        <text x={660} y={20} {...S.small}>
          unfinished
        </text>

        <text x={8} y={104} {...S.mono}>
          HARNESSED — INIT PHASE, WRITTEN HANDOFF
        </text>
        <rect x={8} y={114} width={64} height={30} rx={6} {...S.good} />
        <text x={40} y={133} textAnchor="middle" {...S.small}>
          init 6m
        </text>
        <rect x={76} y={114} width={170} height={30} rx={6} {...S.box} />
        <text x={161} y={133} textAnchor="middle" {...S.small}>
          one feature
        </text>
        <rect x={250} y={114} width={54} height={30} rx={6} {...S.good} />
        <text x={277} y={133} textAnchor="middle" {...S.small}>
          hand off
        </text>
        <rect x={308} y={114} width={54} height={30} rx={6} {...S.good} />
        <text x={335} y={133} textAnchor="middle" {...S.small}>
          rehydrate
        </text>
        <rect x={366} y={114} width={180} height={30} rx={6} {...S.box} />
        <text x={456} y={133} textAnchor="middle" {...S.small}>
          one feature, verified
        </text>
        <rect x={550} y={114} width={110} height={30} rx={6} {...S.good} />
        <text x={605} y={133} textAnchor="middle" {...S.small}>
          verified
        </text>
        <text x={666} y={104} {...S.small}>
          done
        </text>

        <line x1={8} y1={176} x2={712} y2={176} stroke="var(--rule)" />
        <text x={8} y={198} {...S.small}>
          Grey blocks are minutes the next session pays again. Green blocks are what you get back by writing state down.
        </text>
        <text x={8} y={220} {...S.small}>
          Same model, same task. The difference is whether the session left anything behind.
        </text>
        <text x={8} y={244} {...S.mono}>
          ILLUSTRATIVE — MEASURE YOUR OWN SESSIONS, DO NOT QUOTE THESE NUMBERS
        </text>
      </>
    ),
  },

  /* 3. context budget */
  budget: {
    w: 720,
    h: 210,
    node: (
      <>
        <text x={8} y={18} {...S.mono}>
          ONE 200K WINDOW, TWO INSTRUCTION STRATEGIES
        </text>

        <text x={8} y={48} {...S.small}>
          one giant AGENTS.md — 600 lines
        </text>
        <rect x={8} y={58} width={704} height={30} rx={5} fill="var(--accent-soft)" stroke="var(--accent)" />
        <rect x={158} y={58} width={290} height={30} rx={0} fill="var(--tint)" stroke="var(--rule)" />
        <rect x={448} y={58} width={150} height={30} rx={0} fill="var(--tint-2, #fafafc)" stroke="var(--rule)" />
        <text x={82} y={78} textAnchor="middle" {...S.small} style={{ fill: "var(--accent)" }}>
          rules 18k
        </text>
        <text x={303} y={78} textAnchor="middle" {...S.small}>
          source files 29k
        </text>
        <text x={523} y={78} textAnchor="middle" {...S.small}>
          tool output 30k
        </text>

        <text x={8} y={122} {...S.small}>
          entry file + routed topic docs — 140 lines
        </text>
        <rect x={8} y={132} width={52} height={30} rx={5} fill="var(--accent-soft)" stroke="var(--accent)" />
        <rect x={60} y={132} width={388} height={30} rx={0} fill="var(--tint)" stroke="var(--rule)" />
        <rect x={448} y={132} width={150} height={30} rx={0} fill="var(--tint-2, #fafafc)" stroke="var(--rule)" />
        <text x={34} y={152} textAnchor="middle" {...S.small} style={{ fill: "var(--accent)" }}>
          4k
        </text>
        <text x={254} y={152} textAnchor="middle" {...S.small}>
          source files 29k
        </text>
        <text x={523} y={152} textAnchor="middle" {...S.small}>
          tool output 30k
        </text>

        <line x1={598} y1={58} x2={598} y2={162} stroke="var(--rule-2)" strokeDasharray="4 4" />
        <text x={604} y={104} {...S.mono}>
          MORE ROOM
        </text>
        <text x={604} y={120} {...S.mono}>
          TO THINK
        </text>
        <text x={8} y={190} {...S.small}>
          Same rules, loaded when the task needs them. Position matters too — the middle of a long file is the least reliable place for a hard constraint.
        </text>
      </>
    ),
  },

  /* 4. verification layers */
  layers: {
    w: 720,
    h: 250,
    node: (
      <>
        <Defs />
        <text x={8} y={18} {...S.mono}>
          THREE GATES, EACH CATCHING A DIFFERENT CLASS OF DEFECT
        </text>

        <Box x={8} y={36} w={150} h={54} label="1 · lint + types" sub="well-formed?" />
        <Arrow d="M 158 63 L 196 63" />
        <Box x={198} y={36} w={150} h={54} label="2 · unit suite" sub="units behave?" />
        <Arrow d="M 348 63 L 386 63" />
        <Box x={388} y={36} w={160} h={54} label="3 · full flow" sub="system works?" style={S.accent} />
        <Arrow d="M 548 63 L 586 63" />
        <Box x={588} y={36} w={116} h={54} label="evidence" sub="recorded" style={S.good} />

        <text x={8} y={118} {...S.small}>
          What gate 3 catches that 1 and 2 cannot:
        </text>
        <Box x={8} y={130} w={168} h={40} label="interface mismatch" style={S.box} />
        <Box x={184} y={130} w={168} h={40} label="state propagation" style={S.box} />
        <Box x={360} y={130} w={168} h={40} label="resource lifecycle" style={S.box} />
        <Box x={536} y={130} w={168} h={40} label="environment config" style={S.box} />

        <text x={8} y={200} {...S.small}>
          A green unit suite means every part is fine on its own. It says nothing about whether the parts meet.
        </text>
        <text x={8} y={222} {...S.small}>
          Stop at gate 2 and you have automated exactly the gap the agent is worst at.
        </text>
        <text x={8} y={244} {...S.mono}>
          GATE 3 IS THE ONLY ONE THAT CAN SAY "THE USER CAN ACTUALLY DO THIS"
        </text>
      </>
    ),
  },

  /* 5. loop vs graph */
  loopgraph: {
    w: 720,
    h: 260,
    node: (
      <>
        <Defs />
        <text x={8} y={18} {...S.mono}>
          WHEN A LOOP HAS TO BECOME A GRAPH
        </text>

        <Box x={24} y={44} w={132} h={56} label="loop" sub="goal · verify · stop" style={S.good} />
        <path d="M 156 60 C 200 54 200 90 156 84" fill="none" stroke="var(--accent-2, #1f7a5c)" strokeWidth="1.5" markerEnd="url(#arw)" />
        <text x={24} y={122} {...S.small}>
          one node, one context,
        </text>
        <text x={24} y={138} {...S.small}>
          cheapest thing to debug
        </text>

        <line x1={240} y1={36} x2={240} y2={230} stroke="var(--rule)" />

        <Box x={268} y={44} w={96} h={40} label="plan" />
        <Box x={388} y={30} w={96} h={36} label="worker" />
        <Box x={388} y={92} w={96} h={36} label="worker" />
        <Box x={504} y={44} w={96} h={40} label="check" style={S.accent} />
        <Box x={620} y={44} w={80} h={40} label="merge" style={S.good} />
        <Arrow d="M 364 60 C 378 58 378 48 388 48" />
        <Arrow d="M 364 68 C 378 72 378 110 388 110" />
        <Arrow d="M 484 48 C 496 48 496 60 504 60" />
        <Arrow d="M 484 110 C 496 110 496 72 504 72" />
        <Arrow d="M 600 64 L 620 64" />
        <path d="M 552 44 C 552 20 436 20 436 30" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arw)" />
        <text x={494} y={16} textAnchor="middle" {...S.small}>
          reject
        </text>

        <text x={268} y={152} {...S.small}>
          parallel work, a separate checker,
        </text>
        <text x={268} y={168} {...S.small}>
          and a rollback path — at the cost of
        </text>
        <text x={268} y={184} {...S.small}>
          two failure paths to reason about.
        </text>
        <text x={8} y={232} {...S.mono}>
          ADD A NODE ONLY WHEN THE LOOP PROVABLY CANNOT EXPRESS THE STEP
        </text>
      </>
    ),
  },
};

export const FIGURE_IDS = Object.keys(FIGURES);

export default function Figure({ id }: { id: string }) {
  const fig = FIGURES[id];
  if (!fig) {
    return (
      <p className="fig-missing">
        No diagram registered for <code>{id}</code>.
      </p>
    );
  }
  return (
    <svg
      className="fig-svg"
      viewBox={`0 0 ${fig.w} ${fig.h}`}
      role="img"
      aria-label={id}
      preserveAspectRatio="xMidYMid meet"
    >
      {fig.node}
    </svg>
  );
}
