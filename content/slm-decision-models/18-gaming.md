---
section: "18"
title: "Gaming"
kicker: "Use cases"
abstract: "Two game decisions priced in player experience: an in-chat toxicity filter (hide above P = 0.097) with its per-dialect fairness gap, and difficulty adaptation as a 3 × 3 quit-risk matrix — plus the frame budget that keeps every model off the render thread."
time: "13 min"
order: 18
outcomes:
  - "Derive the chat-filter cut point (0.097) from player-experience costs and compare it with a 0.5 default"
  - "Measure the false-hide gap between dialect groups and say what fixes it"
  - "Choose a difficulty action by expected quit risk and add seeded variety without breaking replays"
  - "Budget model calls against a 16.7 ms frame and a chat-throughput target"
---

A competitive online game carries about 20 million chat messages a day (illustrative), and its NPCs make thousands of tactical and pacing choices per match. Two proposals land together: an SLM chat filter to cut toxicity, and a model that adapts encounter difficulty to how the player is doing. Both are decisions with closed actions and real costs, but the costs are **player experience** — churn, frustration, unfairness — rather than rupees of loss, and the clock is a 16.7 ms frame or a chat message that must appear before the next one is typed.

:::key[First principle]
In games the cost matrix is denominated in player experience, and the frame budget is a hard wall. Price each mistake in expected churn or quit-risk points, derive the cut point, and keep every model call off the render thread: the model decides at decision points, asynchronously, and the game always has a default it can play without waiting.
:::

## 18.1 Where SLMs fit

| Decision | Actions | Latency budget | SLM role |
| --- | --- | --- | --- |
| Chat toxicity filter | show · hide (sender still sees it) | before display, ~100 ms (illustrative) | Encoder classifier on the message + recent context |
| Player sanctions | warn · mute · ban | hours | **Ranking only**: a human reviews and decides, with appeal |
| Difficulty adaptation | easier · same · harder | per encounter, seconds | Classifies player state from telemetry |
| NPC dialogue intent | greet · bargain · refuse · hint | ~100 ms per line | Classifies the player's line; writers' templates render the reply |
| Combat micro-decisions | stance per frame | < 1 ms | **None** — a tiny MLP or behaviour tree |

Content moderation in general is a "conditional" fit in the deep course's [domain-fit scoring](/c/practical-slm-decision-models/15-use-cases-and-domain-fit) (58.8/100): labels are contested and slang drifts. A per-message *hide* is the version that fits best because it is cheap, reversible and visible only to the sender's audience; sanctions are where the controls must be heaviest.

## 18.2 The chat filter: cost matrix and cut point

Price the cells per message in INR-equivalent player experience (illustrative — in practice estimate them from retention experiments):

| Action ↓ / outcome → | fair message | toxic message |
| --- | ---: | ---: |
| `show` | 0 | 30 (recipients' expected churn + report handling) |
| `hide` | 3 (sender frustrated, message lost) | 2 (offender keeps playing) |

Hide when its expected cost is lower, with $q = P(\text{toxic})$:

$$
30q > 3(1-q) + 2q \quad\Longrightarrow\quad q > t^* = \frac{3}{3 + 30 - 2} = \frac{3}{31} = 0.097 .
$$

:::example[Worked example · two messages]
- **q = 0.20** ("you're trash, uninstall"). Show: \(0.20 \times 30\) = 6.0. Hide: \(0.80 \times 3 + 0.20 \times 2\) = 2.8. **Hide.** A 20% chance of toxicity is enough: exposure costs ten times a false hide.
- **q = 0.05** ("that play was sick"). Show: 1.5. Hide: 2.95. **Show.** Gamer slang that merely sounds aggressive stays visible.

A default threshold of 0.5 would show the first message; the cost matrix says it should not.
:::

Throughput sizes the filter. At 20 million messages a day and an illustrative 3× peak factor, peak load is \(20 \times 10^6 / 86{,}400 \times 3\) ≈ 694 messages/s. A 66M-parameter encoder on a 32-token message needs about \(2 \times 66 \times 10^6 \times 32\) ≈ 4.2 GFLOP, so a server at an illustrative 1 TFLOP/s effective handles about 237 messages/s: three servers at peak before headroom ([§3](/c/slm-decision-models/03-slm-fundamentals) has the sizing rules).

## 18.3 The filter on a million messages, by dialect group

Simulate 1,000,000 messages, 3% toxic (illustrative). 85% are in the "standard" register the model was mostly trained on (score separation $d' = 2.8$, AUC 0.976); 15% use regional slang, dialect or code-switching, where the model reads intent less reliably ($d' = 1.8$, AUC 0.898). Probabilities are calibrated within each group.

```python run
import numpy as np

# In-game chat filter, per message; INR-equivalent player-experience costs (illustrative).
C_SHOW_TOXIC = 30.0     # recipients exposed: expected churn + report handling
C_HIDE_BENIGN = 3.0     # a fair message silently hidden: sender frustration
C_HIDE_TOXIC = 2.0      # hidden, but the offender keeps playing
T_STAR = C_HIDE_BENIGN / (C_HIDE_BENIGN + C_SHOW_TOXIC - C_HIDE_TOXIC)
GROUPS = {"standard chat": (0.85, 2.8), "slang/dialect": (0.15, 1.8)}   # (share, score separation d')
PREV = 0.03                                                            # illustrative toxic share
rng = np.random.default_rng(18)
N = 1_000_000
grp = rng.choice(list(GROUPS), N, p=[g[0] for g in GROUPS.values()])
d = np.array([GROUPS[g][1] for g in grp])
toxic = rng.random(N) < PREV
s = rng.normal(size=N) + d * toxic
lr = np.exp(d * s - d * d / 2)
q = PREV * lr / (PREV * lr + 1 - PREV)          # calibrated P(toxic) within each group


def stats(hide, m=slice(None)):
    h, t = hide[m], toxic[m]
    cost = np.where(h, np.where(t, C_HIDE_TOXIC, C_HIDE_BENIGN), np.where(t, C_SHOW_TOXIC, 0)).mean()
    return h.mean(), h[~t].mean(), (~h[t]).mean(), cost * 1000


print(f"hide when P(toxic) > {T_STAR:.4f}")
print(f"{'policy':22s} {'group':14s} {'hidden':>7s} {'fair hidden':>11s} {'toxic shown':>11s} {'INR/1k msg':>10s}")
for name, hide in (("show all", np.zeros(N, bool)), ("hide all", np.ones(N, bool)),
                   ("hide if q > 0.5", q > 0.5), ("hide if q > t*", q > T_STAR)):
    for g in ("all", *GROUPS):
        h, fh, ts, c = stats(hide, slice(None) if g == "all" else grp == g)
        print(f"{name:22s} {g:14s} {h:7.2%} {fh:11.2%} {ts:11.1%} {c:10.0f}")
        if name.startswith("show") or name.startswith("hide all"):
            break
```

```output
hide when P(toxic) > 0.0968
policy                 group           hidden fair hidden toxic shown INR/1k msg
show all               all              0.00%       0.00%      100.0%        896
hide all               all            100.00%     100.00%        0.0%       2970
hide if q > 0.5        all              1.87%       0.39%       50.1%        490
hide if q > 0.5        standard chat    2.08%       0.42%       43.8%        437
hide if q > 0.5        slang/dialect    0.68%       0.25%       85.4%        792
hide if q > t*         all              5.91%       3.65%       20.6%        338
hide if q > t*         standard chat    5.65%       3.27%       17.0%        296
hide if q > t*         slang/dialect    7.36%       5.75%       41.0%        576
```

- **The cost threshold beats the default by a third.** At $t^*$ the filter costs ₹338 per 1,000 messages against ₹490 at 0.5 (31% lower) and ₹896 with no filter (62% lower). It hides 5.91% of messages, including 3.65% of fair ones — the price of catching 79.4% of toxicity.
- **The weaker group loses twice.** Slang/dialect players have 5.75% of their fair messages hidden (1.76× the standard group's 3.27%) *and* see 41.0% of toxic messages get through (vs 17.0%). The same threshold is still cost-optimal for each group, because both are calibrated; the gap comes from the model reading them less well.
- **A different threshold per group is not the fix.** Lowering it for the slang group would hide even more of their fair messages. The remedy is labelled data in those registers, native-speaker annotators and a per-group gate in evaluation.

:::chart[Fair messages hidden and toxic messages shown, by group, as the hide threshold moves]{type="line" x="hide threshold on P(toxic)" y="share" xlog="true" yfmt="pct" ymin="0" marks="0.0968:t* = 3/31" dash="toxic shown standard,toxic shown slang" note="Synthetic, 1,000,000 messages, 3% toxic (illustrative). Slang/dialect is 15% of chat with a weaker score (AUC 0.898 vs 0.976)."}
threshold, fair hidden standard, fair hidden slang, toxic shown standard, toxic shown slang
0.01, 0.1581, 0.3934, 0.036, 0.063
0.013, 0.1364, 0.3375, 0.043, 0.086
0.017, 0.1164, 0.2848, 0.052, 0.111
0.0221, 0.0987, 0.2366, 0.065, 0.144
0.0288, 0.0829, 0.1935, 0.078, 0.180
0.0376, 0.0692, 0.1549, 0.093, 0.221
0.0489, 0.0571, 0.1209, 0.112, 0.268
0.0638, 0.0464, 0.0925, 0.132, 0.325
0.0831, 0.0373, 0.0686, 0.154, 0.375
0.108, 0.0296, 0.0498, 0.182, 0.434
0.141, 0.0230, 0.0350, 0.213, 0.499
0.184, 0.0174, 0.0234, 0.245, 0.569
0.24, 0.0129, 0.0151, 0.285, 0.641
0.312, 0.0092, 0.0087, 0.332, 0.718
0.407, 0.0062, 0.0045, 0.388, 0.793
0.53, 0.0037, 0.0020, 0.455, 0.872
0.691, 0.0017, 0.0006, 0.552, 0.932
0.9, 0.0004, 0.0000, 0.734, 0.988
:::

Controls specific to game chat:

- **Hide is not a sanction.** The sender still sees their message; nothing is muted or banned by the model. Mutes and bans are per player, built from many messages, ranked by the model and **decided by a person** with an appeal path.
- **Severe categories bypass the threshold.** Credible threats, self-harm and anything touching child safety go to deterministic matching and mandatory human (and, where required, legal) escalation — never to a cost trade-off on one score.
- **Adversarial drift is the norm.** Players probe filters with spacing, leetspeak and new slang within days of a patch. Track the hide rate per day and per language, sample hidden and shown messages for review weekly, and re-label from appeals.
- **Per-group gates in evaluation.** Ship only if each named group's false-hide rate and toxic-shown rate are within an agreed margin of the overall, with intervals ([§14](/c/slm-decision-models/14-notebook-evaluation) shows the slice table).

## 18.4 Difficulty adaptation: a 3 × 3 quit-risk matrix

Dynamic difficulty is a multi-class decision. A model reads telemetry (deaths, retries, time-to-clear, chat sentiment) and outputs $P(\text{frustrated}), P(\text{engaged}), P(\text{bored})$. Price each (action, state) cell in **percentage points of session-quit probability** (illustrative; estimate from A/B tests):

| Action ↓ / state → | frustrated | engaged | bored |
| --- | ---: | ---: | ---: |
| `easier` | 0 | 2 | 5 |
| `same` | 6 | 0 | 3 |
| `harder` | 12 | 3 | 0 |

Pick the action with the lowest expected quit risk, $\arg\min_a \sum_s C_{a,s} P(s)$. The matrix is deliberately asymmetric: making a frustrated player's game harder (12) is far worse than easing an engaged player's (2).

The run block below does the arithmetic for three players, shows why no model call fits inside a frame, and adds **variety without losing reproducibility**: when two actions are within 0.5 pp, pick between them with an RNG seeded per encounter, so encounters feel different but any one replays exactly.

```python run
import numpy as np

# 1) Frame budget: why the model never runs inside the frame (illustrative CPU: 1 TFLOP/s effective).
FPS, AI_SHARE, FLOPS = 60, 0.12, 1e12
frame_ms = 1000 / FPS
ai_ms = frame_ms * AI_SHARE                          # share of the frame the AI system may spend
for name, params, tokens in (("66M encoder, 64-token state", 66e6, 64), ("MLP on 40 features", 20e3, 1)):
    call_ms = 2 * params * tokens / FLOPS * 1e3
    print(f"{name:28s} {call_ms * 1e3:9.2f} us/call = {call_ms / ai_ms:7.1%} of a {ai_ms:.1f} ms AI budget")
npcs, every_s, call_ms = 40, 2.0, 2 * 66e6 * 64 / FLOPS * 1e3
print(f"async: {npcs} NPCs deciding every {every_s:.0f} s -> {npcs / every_s:.0f} calls/s "
      f"= {npcs / every_s * call_ms / 10:.1f}% of one worker core")

# 2) Difficulty adaptation: expected session-quit risk (percentage points) per action and player state.
STATES = ("frustrated", "engaged", "bored")
ACTIONS = ("easier", "same", "harder")
QUIT_PP = np.array([[0, 2, 5],      # easier: patronises an engaged player, bores a bored one more
                    [6, 0, 3],      # same
                    [12, 3, 0]])    # harder: worst for a frustrated player
for p in ([0.30, 0.50, 0.20], [0.10, 0.60, 0.30], [0.05, 0.35, 0.60]):
    e = QUIT_PP @ np.array(p)
    print(f"P(state) = {p} -> expected quit pp " +
          ", ".join(f"{a} {v:.2f}" for a, v in zip(ACTIONS, e)) + f"  => {ACTIONS[e.argmin()]}")

# 3) Variety without losing reproducibility: sample among near-tied actions, seeded per encounter.
def choose(e, seed, slack=0.5):
    ok = np.flatnonzero(e <= e.min() + slack)        # actions within 0.5 pp of the best
    return ACTIONS[np.random.default_rng(seed).choice(ok)]
e = QUIT_PP @ np.array([0.25, 0.55, 0.20])          # easier and same tie at 2.10 pp
print("seeded picks for encounters 1-8:", [choose(e, seed) for seed in range(1, 9)])
print("replay of encounter 3:", choose(e, 3))
```

```output
66M encoder, 64-token state    8448.00 us/call =  422.4% of a 2.0 ms AI budget
MLP on 40 features                0.04 us/call =    0.0% of a 2.0 ms AI budget
async: 40 NPCs deciding every 2 s -> 20 calls/s = 16.9% of one worker core
P(state) = [0.3, 0.5, 0.2] -> expected quit pp easier 2.00, same 2.40, harder 5.10  => easier
P(state) = [0.1, 0.6, 0.3] -> expected quit pp easier 2.70, same 1.50, harder 3.00  => same
P(state) = [0.05, 0.35, 0.6] -> expected quit pp easier 3.70, same 2.10, harder 1.65  => harder
seeded picks for encounters 1-8: ['easier', 'same', 'same', 'same', 'same', 'easier', 'same', 'same']
replay of encounter 3: same
```

- **One player at 30% frustrated gets `easier`**, even though "engaged" is the most likely state: the 12-point cost of hardening a frustrated player's game dominates.
- **A 66M encoder call is 4.2× the whole AI budget of a frame** (2.0 ms = 12% of 16.7 ms, illustrative). It cannot run per frame. Run it on a worker thread at decision points — 40 NPCs deciding every 2 s cost 16.9% of one core — and let the frame read the last decision. The 40-feature MLP's 0.04 µs is FLOPs only; in practice call overhead dominates, and it still fits per frame.
- **Seeded variety is debuggable variety.** Encounters 1 and 6 ease off, the rest hold steady, and encounter 3 replays identically. Store the seed with the match record so a bug report reproduces.

:::warn[Never block the frame on a model]
If the decision is late, the NPC plays its default behaviour tree and the result is applied on the next decision point. A model timeout must never stall rendering, and a missing difficulty decision means "same", not "harder".
:::

## 18.5 Drift, testing and governance

| Signal | What it catches | Action |
| --- | --- | --- |
| Hide rate per day, language and region | new slang, evasion, a meme that trips the filter | sample and re-label; hotfix phrase rules |
| Appeal overturn rate on hidden messages | false hides concentrated in a group | per-group data collection; gate in evaluation |
| Action shares per difficulty decision | policy collapsing to one action after a retune | check entropy of the action distribution in simulation |
| Win rate and quit rate per encounter band | difficulty matrix mispriced | re-estimate quit costs with an A/B test |
| p99 decision latency under match load | worker saturation | add workers; lengthen the decision interval |

- **Simulation harness.** Replay 10,000 synthetic encounters per build; assert win rates stay in the designed band and no action's share drops to zero.
- **Character and lore safety by construction.** The model chooses an action id; writers own every line the player reads. If text must be generated, restrict it to an approved vocabulary and log the seed.
- **Age ratings and minors.** Games with young players carry stricter duties for chat and data; route those decisions through the platform's trust-and-safety and legal owners before launch.

## 18.6 Check yourself

:::qa[Players report that false hides are more annoying than you priced: the cost of hiding a fair message rises from 3 to 6. What is the new threshold?]
$t^* = 6/(6 + 30 - 2) = 6/34 = 0.176$. From the chart, the standard group's false-hide rate falls from about 3.3% to under 2%, and toxic-shown rises from 17% to about 24%. The filter becomes more permissive because hiding got more expensive.
:::

:::qa[Why not give the slang/dialect group a higher threshold so fewer of their fair messages are hidden?]
Because their probabilities are calibrated, the same $t^*$ is already cost-optimal for them; raising it trades fewer false hides for even more toxicity shown to their own audience (already 41%). The disparity is a model-quality gap: fix it with data and annotators from that register, and gate releases on per-group rates.
:::

:::qa[P(state) = (0.20, 0.50, 0.30). Which difficulty action wins?]
Easier: \(0.5 \times 2 + 0.3 \times 5\) = 2.5. Same: \(0.2 \times 6 + 0.3 \times 3\) = 2.1. Harder: \(0.2 \times 12 + 0.5 \times 3\) = 3.9. **Same** — and since easier is within 0.5 pp, the seeded sampler may pick either.
:::

Next: [Education](/c/slm-decision-models/19-education).
