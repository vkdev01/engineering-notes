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

  /* 6. triage tree */
  triage: {
    w: 720,
    h: 300,
    node: (
      <>
        <Defs />
        <Box x={272} y={12} w={176} h={44} label="session went wrong" style={S.accent} />
        <Arrow d="M 320 56 C 300 80 200 84 170 104" />
        <Arrow d="M 360 56 L 360 104" />
        <Arrow d="M 400 56 C 420 80 520 84 550 104" />

        <Box x={84} y={106} w={172} h={46} label="wrong output" sub="it built the wrong thing" />
        <Box x={274} y={106} w={172} h={46} label="no output" sub="it stalled or looped" />
        <Box x={464} y={106} w={172} h={46} label="slow output" sub="it took all day" />

        <text x={170} y={176} textAnchor="middle" {...S.mono}>INSTRUCTIONS · SCOPE</text>
        <text x={360} y={176} textAnchor="middle" {...S.mono}>ENVIRONMENT · STATE</text>
        <text x={550} y={176} textAnchor="middle" {...S.mono}>INSTRUCTIONS · TOOLS</text>

        <text x={170} y={198} textAnchor="middle" {...S.small}>spec unclear? scope missing?</text>
        <text x={360} y={198} textAnchor="middle" {...S.small}>tests red? state lost?</text>
        <text x={550} y={198} textAnchor="middle" {...S.small}>file too long? no route?</text>

        <line x1={16} y1={222} x2={704} y2={222} stroke="var(--rule)" />
        <text x={16} y={244} {...S.small}>And the one that is not a harness problem: the task is beyond the model. Three runs, good harness, same failure.</text>
        <text x={16} y={266} {...S.small}>Then it is a capability gap and more scaffolding will not close it.</text>
        <text x={16} y={290} {...S.mono}>ATTRIBUTE FIRST, CHANGE SECOND</text>
      </>
    ),
  },

  /* 7. the rule-growth loop */
  bloat: {
    w: 720,
    h: 250,
    node: (
      <>
        <Defs />
        <Box x={20} y={30} w={150} h={48} label="incident" />
        <Arrow d="M 170 54 L 208 54" />
        <Box x={210} y={30} w={150} h={48} label="add a rule" />
        <Arrow d="M 360 54 L 398 54" />
        <Box x={400} y={30} w={150} h={48} label="file grows" style={S.accent} />
        <Arrow d="M 550 54 L 588 54" />
        <Box x={590} y={30} w={112} h={48} label="mid-file rule missed" style={S.accent} />
        <path d="M 646 78 C 646 118 96 118 96 78" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#arw)" />
        <text x={370} y={112} textAnchor="middle" {...S.small}>and the next incident adds another rule</text>

        <line x1={20} y1={140} x2={702} y2={140} stroke="var(--rule)" />
        <text x={20} y={162} {...S.small}>The loop is stable and it always feels reasonable: each individual rule was justified by a real failure.</text>
        <text x={20} y={184} {...S.small}>The break is to route: invariants at the top, detail in topic docs, and delete rules with no incident behind them.</text>
        <text x={20} y={214} {...S.mono}>A RULE YOU CANNOT POINT AT A FAILURE FOR IS A TAX ON EVERY SESSION</text>
        <text x={20} y={238} {...S.mono}>AUDIT QUARTERLY · DELETE BEFORE YOU ADD</text>
      </>
    ),
  },

  /* 8. handoff map */
  handoff: {
    w: 720,
    h: 262,
    node: (
      <>
        <Defs />
        <text x={16} y={20} {...S.mono}>WHAT A SESSION LEAVES BEHIND</text>

        <Box x={16} y={34} w={160} h={44} label="feature_list.json" sub="what is done" />
        <Box x={16} y={90} w={160} h={44} label="progress.md" sub="what happened" />
        <Box x={16} y={146} w={160} h={44} label="decision notes" sub="why, not just what" />
        <Box x={16} y={202} w={160} h={44} label="git checkpoint" sub="exact state" />

        <Arrow d="M 176 56 C 250 56 250 90 300 110" />
        <Arrow d="M 176 112 C 240 112 250 110 300 114" />
        <Arrow d="M 176 168 C 240 168 250 130 300 120" />
        <Arrow d="M 176 224 C 250 224 250 150 300 126" />

        <Box x={304} y={84} w={170} h={70} label="next session" sub="starts on work" style={S.good} />
        <Arrow d="M 474 119 L 512 119" />
        <Box x={516} y={84} w={188} h={70} label="no re-exploration" sub="no re-litigating" style={S.good} />

        <text x={16} y={252} {...S.small}>Four artefacts, none of them a chat transcript: the next session reads the repository and nothing else.</text>
      </>
    ),
  },

  /* 9. clean exit flow */
  exitflow: {
    w: 720,
    h: 300,
    node: (
      <>
        <Defs />
        <Box x={20} y={16} w={140} h={40} label="work done" />
        <Arrow d="M 160 36 L 196 36" />
        <Box x={198} y={16} w={120} h={40} label="build passes?" />
        <Arrow d="M 318 36 L 354 36" label="yes" lx={336} ly={28} />
        <Box x={356} y={16} w={120} h={40} label="tests pass?" />
        <Arrow d="M 476 36 L 512 36" label="yes" lx={494} ly={28} />
        <Box x={514} y={16} w={130} h={40} label="record evidence" />

        <path d="M 258 56 C 258 92 200 92 200 120" fill="none" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#arw)" />
        <path d="M 416 56 C 416 92 360 92 360 120" fill="none" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#arw)" />
        <Box x={264} y={122} w={190} h={40} label="fix before you exit" style={S.accent} />
        <text x={470} y={104} {...S.small}>a session that ends red is a debt</text>

        <Arrow d="M 579 56 L 579 92" />
        <Box x={514} y={94} w={130} h={40} label="cleanup temp" />
        <Arrow d="M 579 134 L 579 170" />
        <Box x={490} y={172} w={178} h={40} label="cold clone starts?" />
        <Arrow d="M 668 192 L 700 192" />
        <text x={676} y={182} {...S.mono}>SHIP</text>

        <line x1={20} y1={236} x2={700} y2={236} stroke="var(--rule)" />
        <text x={20} y={258} {...S.small}>Six checks, in order. The first two are cheap; the last is the only one that proves the environment survived.</text>
        <text x={20} y={282} {...S.mono}>RUN IT AS A SCRIPT, NOT AS A CHECKLIST SOMEONE REMEMBERS</text>
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
