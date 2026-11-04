---
section: "4"
title: "Decision theory"
kicker: "Theory"
abstract: "Why a probability beats a label, how the cost matrix fixes the threshold before you train anything, why abstention is an action rather than a cop-out, and how to attribute the loss when the decision is wrong."
time: "18 min"
order: 4
outcomes:
  - "Explain why accuracy is the wrong objective for a decision"
  - "Derive the threshold and the abstain band from a cost matrix"
  - "Attribute regret to belief error or to a capacity constraint"
---

There is a specific reason decision theory belongs in an engineering guide rather than a footnote: **it moves work from the model to the arithmetic.** A team that has a cost matrix can ship a defensible system with a mediocre model. A team without one will spend a quarter improving accuracy and be unable to say whether the product got better.

This section is the concept, the derivation, and the pictures. The code follows, and it exists to compute the numbers rather than to be the argument.

## 4.1 A decision is a comparison of futures

Formally, a decision model picks an action that minimises expected cost, where the expectation is over outcomes you cannot observe:

```text
a* = argmin over a  of  Σ over outcomes o  of  P(o | x) · cost(a, o)
```

Three things follow from that one line, and each one changes how you build.

**You need a distribution, not a label.** A classifier that says "bad" has thrown away the information the argmax needs. Two cases can both be labelled "bad" while one has P(bad) = 0.51 and the other P(bad) = 0.99 — and under an asymmetric cost matrix they deserve different actions. This is why calibration (§2) is not a polish step: it is what makes the probability usable.

**The threshold is derived, not tuned.** For two actions the crossing point is a ratio of costs, computed in §4.2 before any model exists. Tuning a threshold on validation data optimises a proxy; deriving it optimises the thing you actually pay for.

**Abstention is an action with a price.** A review that costs money is competing with approve and decline on the same arithmetic. It is not a safety blanket bolted on afterwards, and it is not free.

:::mermaid[The decision triangle: what the model supplies and what the business supplies]
flowchart TB
  M[Model: P(outcome given observation)] --> E[Expected cost of each action]
  B[Business: cost matrix] --> E
  C[Operations: abstain budget] --> E
  E --> A[Action from a closed set]
  A --> L[Logged decision: action, probability, reason, version]
  L -.->|production misses| M
:::

Read the diagram as an ownership map. The model supplies one arrow — the probability. Everything else is a decision someone in the business has to make, and pretending otherwise is how ML teams end up owning outcomes they cannot control.

## 4.2 The cost matrix fixes the threshold

With two outcomes every action's expected cost is a straight line in `p = P(good)`. The cheapest line wins its interval, and the crossing points are where two lines meet — a ratio of costs, nothing more.

<svg viewBox="0 0 760 320" role="img" aria-label="Each action is a straight line in P(good); the cheapest line wins its interval" style="width:100%;height:auto;font-family:var(--sans,system-ui);font-size:11px">
<rect x="0" y="0" width="760" height="320" fill="transparent"/>
<line x1="62" y1="274.0" x2="610" y2="274.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="278.0" text-anchor="end" fill="var(--dim,#5c6472)">0</text>
<line x1="62" y1="226.0" x2="610" y2="226.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="230.0" text-anchor="end" fill="var(--dim,#5c6472)">25k</text>
<line x1="62" y1="178.0" x2="610" y2="178.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="182.0" text-anchor="end" fill="var(--dim,#5c6472)">50k</text>
<line x1="62" y1="130.0" x2="610" y2="130.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="134.0" text-anchor="end" fill="var(--dim,#5c6472)">75k</text>
<line x1="62" y1="82.0" x2="610" y2="82.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="86.0" text-anchor="end" fill="var(--dim,#5c6472)">100k</text>
<line x1="62" y1="34.0" x2="610" y2="34.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="38.0" text-anchor="end" fill="var(--dim,#5c6472)">125k</text>
<line x1="62.0" y1="274" x2="62.0" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="62.0" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.00</text>
<line x1="171.6" y1="274" x2="171.6" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="171.6" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.20</text>
<line x1="281.2" y1="274" x2="281.2" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="281.2" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.40</text>
<line x1="390.8" y1="274" x2="390.8" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="390.8" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.60</text>
<line x1="500.4" y1="274" x2="500.4" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="500.4" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.80</text>
<line x1="610.0" y1="274" x2="610.0" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="610.0" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">1.00</text>
<line x1="62" y1="274" x2="610" y2="274" stroke="var(--rule-2,#c5cbb2)" stroke-width="1.2"/>
<line x1="62" y1="274" x2="62" y2="34" stroke="var(--rule-2,#c5cbb2)" stroke-width="1.2"/>
<polyline points="62.0,43.6 64.7,44.8 67.5,45.9 70.2,47.1 73.0,48.2 75.7,49.4 78.4,50.5 81.2,51.7 83.9,52.8 86.7,54.0 89.4,55.1 92.1,56.3 94.9,57.4 97.6,58.6 100.4,59.7 103.1,60.9 105.8,62.0 108.6,63.2 111.3,64.3 114.1,65.5 116.8,66.6 119.5,67.8 122.3,68.9 125.0,70.1 127.8,71.2 130.5,72.4 133.2,73.6 136.0,74.7 138.7,75.9 141.5,77.0 144.2,78.2 146.9,79.3 149.7,80.5 152.4,81.6 155.2,82.8 157.9,83.9 160.6,85.1 163.4,86.2 166.1,87.4 168.9,88.5 171.6,89.7 174.3,90.8 177.1,92.0 179.8,93.1 182.6,94.3 185.3,95.4 188.0,96.6 190.8,97.7 193.5,98.9 196.3,100.0 199.0,101.2 201.7,102.4 204.5,103.5 207.2,104.7 210.0,105.8 212.7,107.0 215.4,108.1 218.2,109.3 220.9,110.4 223.7,111.6 226.4,112.7 229.1,113.9 231.9,115.0 234.6,116.2 237.4,117.3 240.1,118.5 242.8,119.6 245.6,120.8 248.3,121.9 251.1,123.1 253.8,124.2 256.5,125.4 259.3,126.5 262.0,127.7 264.8,128.8 267.5,130.0 270.2,131.2 273.0,132.3 275.7,133.5 278.5,134.6 281.2,135.8 283.9,136.9 286.7,138.1 289.4,139.2 292.2,140.4 294.9,141.5 297.6,142.7 300.4,143.8 303.1,145.0 305.9,146.1 308.6,147.3 311.3,148.4 314.1,149.6 316.8,150.7 319.6,151.9 322.3,153.0 325.0,154.2 327.8,155.3 330.5,156.5 333.3,157.6 336.0,158.8 338.7,160.0 341.5,161.1 344.2,162.3 347.0,163.4 349.7,164.6 352.4,165.7 355.2,166.9 357.9,168.0 360.7,169.2 363.4,170.3 366.1,171.5 368.9,172.6 371.6,173.8 374.4,174.9 377.1,176.1 379.8,177.2 382.6,178.4 385.3,179.5 388.1,180.7 390.8,181.8 393.5,183.0 396.3,184.1 399.0,185.3 401.8,186.4 404.5,187.6 407.2,188.8 410.0,189.9 412.7,191.1 415.5,192.2 418.2,193.4 420.9,194.5 423.7,195.7 426.4,196.8 429.2,198.0 431.9,199.1 434.6,200.3 437.4,201.4 440.1,202.6 442.9,203.7 445.6,204.9 448.3,206.0 451.1,207.2 453.8,208.3 456.6,209.5 459.3,210.6 462.0,211.8 464.8,212.9 467.5,214.1 470.3,215.2 473.0,216.4 475.7,217.6 478.5,218.7 481.2,219.9 484.0,221.0 486.7,222.2 489.4,223.3 492.2,224.5 494.9,225.6 497.7,226.8 500.4,227.9 503.1,229.1 505.9,230.2 508.6,231.4 511.4,232.5 514.1,233.7 516.8,234.8 519.6,236.0 522.3,237.1 525.1,238.3 527.8,239.4 530.5,240.6 533.3,241.7 536.0,242.9 538.8,244.0 541.5,245.2 544.2,246.4 547.0,247.5 549.7,248.7 552.5,249.8 555.2,251.0 557.9,252.1 560.7,253.3 563.4,254.4 566.2,255.6 568.9,256.7 571.6,257.9 574.4,259.0 577.1,260.2 579.9,261.3 582.6,262.5 585.3,263.6 588.1,264.8 590.8,265.9 593.6,267.1 596.3,268.2 599.0,269.4 601.8,270.5 604.5,271.7 607.3,272.8 610.0,274.0" fill="none" stroke="var(--accent,#6d28d9)" stroke-width="2.2"/>
<polyline points="62.0,272.3 64.7,272.3 67.5,272.3 70.2,272.3 73.0,272.3 75.7,272.3 78.4,272.3 81.2,272.3 83.9,272.3 86.7,272.3 89.4,272.3 92.1,272.3 94.9,272.3 97.6,272.3 100.4,272.3 103.1,272.3 105.8,272.3 108.6,272.3 111.3,272.3 114.1,272.3 116.8,272.3 119.5,272.3 122.3,272.3 125.0,272.3 127.8,272.3 130.5,272.3 133.2,272.3 136.0,272.3 138.7,272.3 141.5,272.3 144.2,272.3 146.9,272.3 149.7,272.3 152.4,272.3 155.2,272.3 157.9,272.3 160.6,272.3 163.4,272.3 166.1,272.3 168.9,272.3 171.6,272.3 174.3,272.3 177.1,272.3 179.8,272.3 182.6,272.3 185.3,272.3 188.0,272.3 190.8,272.3 193.5,272.3 196.3,272.3 199.0,272.3 201.7,272.3 204.5,272.3 207.2,272.3 210.0,272.3 212.7,272.3 215.4,272.3 218.2,272.3 220.9,272.3 223.7,272.3 226.4,272.3 229.1,272.3 231.9,272.3 234.6,272.3 237.4,272.3 240.1,272.3 242.8,272.3 245.6,272.3 248.3,272.3 251.1,272.3 253.8,272.3 256.5,272.3 259.3,272.3 262.0,272.3 264.8,272.3 267.5,272.3 270.2,272.3 273.0,272.3 275.7,272.3 278.5,272.3 281.2,272.3 283.9,272.3 286.7,272.3 289.4,272.3 292.2,272.3 294.9,272.3 297.6,272.3 300.4,272.3 303.1,272.3 305.9,272.3 308.6,272.3 311.3,272.3 314.1,272.3 316.8,272.3 319.6,272.3 322.3,272.3 325.0,272.3 327.8,272.3 330.5,272.3 333.3,272.3 336.0,272.3 338.7,272.3 341.5,272.3 344.2,272.3 347.0,272.3 349.7,272.3 352.4,272.3 355.2,272.3 357.9,272.3 360.7,272.3 363.4,272.3 366.1,272.3 368.9,272.3 371.6,272.3 374.4,272.3 377.1,272.3 379.8,272.3 382.6,272.3 385.3,272.3 388.1,272.3 390.8,272.3 393.5,272.3 396.3,272.3 399.0,272.3 401.8,272.3 404.5,272.3 407.2,272.3 410.0,272.3 412.7,272.3 415.5,272.3 418.2,272.3 420.9,272.3 423.7,272.3 426.4,272.3 429.2,272.3 431.9,272.3 434.6,272.3 437.4,272.3 440.1,272.3 442.9,272.3 445.6,272.3 448.3,272.3 451.1,272.3 453.8,272.3 456.6,272.3 459.3,272.3 462.0,272.3 464.8,272.3 467.5,272.3 470.3,272.3 473.0,272.3 475.7,272.3 478.5,272.3 481.2,272.3 484.0,272.3 486.7,272.3 489.4,272.3 492.2,272.3 494.9,272.3 497.7,272.3 500.4,272.3 503.1,272.3 505.9,272.3 508.6,272.3 511.4,272.3 514.1,272.3 516.8,272.3 519.6,272.3 522.3,272.3 525.1,272.3 527.8,272.3 530.5,272.3 533.3,272.3 536.0,272.3 538.8,272.3 541.5,272.3 544.2,272.3 547.0,272.3 549.7,272.3 552.5,272.3 555.2,272.3 557.9,272.3 560.7,272.3 563.4,272.3 566.2,272.3 568.9,272.3 571.6,272.3 574.4,272.3 577.1,272.3 579.9,272.3 582.6,272.3 585.3,272.3 588.1,272.3 590.8,272.3 593.6,272.3 596.3,272.3 599.0,272.3 601.8,272.3 604.5,272.3 607.3,272.3 610.0,272.3" fill="none" stroke="var(--accent-2,#8a5a00)" stroke-width="2.2"/>
<polyline points="62.0,274.0 64.7,273.8 67.5,273.5 70.2,273.3 73.0,273.1 75.7,272.8 78.4,272.6 81.2,272.4 83.9,272.2 86.7,271.9 89.4,271.7 92.1,271.5 94.9,271.2 97.6,271.0 100.4,270.8 103.1,270.5 105.8,270.3 108.6,270.1 111.3,269.9 114.1,269.6 116.8,269.4 119.5,269.2 122.3,268.9 125.0,268.7 127.8,268.5 130.5,268.2 133.2,268.0 136.0,267.8 138.7,267.5 141.5,267.3 144.2,267.1 146.9,266.9 149.7,266.6 152.4,266.4 155.2,266.2 157.9,265.9 160.6,265.7 163.4,265.5 166.1,265.2 168.9,265.0 171.6,264.8 174.3,264.6 177.1,264.3 179.8,264.1 182.6,263.9 185.3,263.6 188.0,263.4 190.8,263.2 193.5,262.9 196.3,262.7 199.0,262.5 201.7,262.2 204.5,262.0 207.2,261.8 210.0,261.6 212.7,261.3 215.4,261.1 218.2,260.9 220.9,260.6 223.7,260.4 226.4,260.2 229.1,259.9 231.9,259.7 234.6,259.5 237.4,259.3 240.1,259.0 242.8,258.8 245.6,258.6 248.3,258.3 251.1,258.1 253.8,257.9 256.5,257.6 259.3,257.4 262.0,257.2 264.8,257.0 267.5,256.7 270.2,256.5 273.0,256.3 275.7,256.0 278.5,255.8 281.2,255.6 283.9,255.3 286.7,255.1 289.4,254.9 292.2,254.6 294.9,254.4 297.6,254.2 300.4,254.0 303.1,253.7 305.9,253.5 308.6,253.3 311.3,253.0 314.1,252.8 316.8,252.6 319.6,252.3 322.3,252.1 325.0,251.9 327.8,251.7 330.5,251.4 333.3,251.2 336.0,251.0 338.7,250.7 341.5,250.5 344.2,250.3 347.0,250.0 349.7,249.8 352.4,249.6 355.2,249.3 357.9,249.1 360.7,248.9 363.4,248.7 366.1,248.4 368.9,248.2 371.6,248.0 374.4,247.7 377.1,247.5 379.8,247.3 382.6,247.0 385.3,246.8 388.1,246.6 390.8,246.4 393.5,246.1 396.3,245.9 399.0,245.7 401.8,245.4 404.5,245.2 407.2,245.0 410.0,244.7 412.7,244.5 415.5,244.3 418.2,244.0 420.9,243.8 423.7,243.6 426.4,243.4 429.2,243.1 431.9,242.9 434.6,242.7 437.4,242.4 440.1,242.2 442.9,242.0 445.6,241.7 448.3,241.5 451.1,241.3 453.8,241.1 456.6,240.8 459.3,240.6 462.0,240.4 464.8,240.1 467.5,239.9 470.3,239.7 473.0,239.4 475.7,239.2 478.5,239.0 481.2,238.7 484.0,238.5 486.7,238.3 489.4,238.1 492.2,237.8 494.9,237.6 497.7,237.4 500.4,237.1 503.1,236.9 505.9,236.7 508.6,236.4 511.4,236.2 514.1,236.0 516.8,235.8 519.6,235.5 522.3,235.3 525.1,235.1 527.8,234.8 530.5,234.6 533.3,234.4 536.0,234.1 538.8,233.9 541.5,233.7 544.2,233.4 547.0,233.2 549.7,233.0 552.5,232.8 555.2,232.5 557.9,232.3 560.7,232.1 563.4,231.8 566.2,231.6 568.9,231.4 571.6,231.1 574.4,230.9 577.1,230.7 579.9,230.5 582.6,230.2 585.3,230.0 588.1,229.8 590.8,229.5 593.6,229.3 596.3,229.1 599.0,228.8 601.8,228.6 604.5,228.4 607.3,228.2 610.0,227.9" fill="none" stroke="var(--dim,#6a7059)" stroke-width="2.2" stroke-dasharray="5 4"/>
<text x="336" y="312" text-anchor="middle" fill="var(--ink-2,#3a3f2c)">P(good) — the model's probability the case is good</text>
<text x="14" y="154" text-anchor="middle" fill="var(--ink-2,#3a3f2c)" transform="rotate(-90 14 154)">expected cost (INR)</text>
<text x="62" y="18" fill="var(--ink,#15170f)" font-size="12.5" font-weight="600">Each action is a straight line in P(good); the cheapest line wins its interval</text>
<line x1="624" y1="42" x2="644" y2="42" stroke="var(--accent,#6d28d9)" stroke-width="2.4"/>
<text x="650" y="46" fill="var(--ink-2,#3a3f2c)">auto_approve</text>
<line x1="624" y1="62" x2="644" y2="62" stroke="var(--accent-2,#8a5a00)" stroke-width="2.4"/>
<text x="650" y="66" fill="var(--ink-2,#3a3f2c)">manual_review</text>
<line x1="624" y1="82" x2="644" y2="82" stroke="var(--dim,#6a7059)" stroke-width="2.4" stroke-dasharray="5 4"/>
<text x="650" y="86" fill="var(--ink-2,#3a3f2c)">decline</text>
</svg>

The picture is the whole argument of this section. `auto_approve` falls as the case gets better, `decline` rises as it gets worse, and `manual_review` is flat because it costs the same either way. Where they cross is the threshold:

```text
approve rather than decline  ⟺  p · c(decline, good)  >  (1 − p) · c(approve, bad)
                             ⟺  p  >  c(approve, bad) / ( c(approve, bad) + c(decline, good) )
```

With the numbers in this course — 120,000 for a bad approval against 24,000 of lost margin on a good one — that ratio is 0.833. A team that ships the default 0.5 is not being 40% more cautious; it is approving cases it has itself declared unaffordable.

Note what the review line does to that picture: it is so cheap (900) that it undercuts both sloped lines across almost the entire range. That is the next section's problem.

## 4.3 Abstention is an action, and it can eat the product

`manual_review` is never the cheapest action *if you knew the outcome* — knowing the outcome, you would approve or decline. It is still correct to keep it, because the model never knows the outcome; it knows a probability. An action that is dominated under certainty but optimal over a range of probabilities is exactly what an escalation path is.

The failure mode is the opposite of what teams expect. A cheap review makes abstention optimal almost everywhere, and the arithmetic then hands you a product that routes four cases in five to a human:

| What you changed | What happens | Why |
| --- | --- | --- |
| Review costs 900, mistakes cost 120,000 | 82% abstain rate | Review undercuts both decisions across the band |
| Review cost raised to 25,000 | Band narrows to a usable width | The reviewer is priced like the resource they are |
| Review cost left alone, cap set at 25% | Cost per case rises, volume controlled | The cap forces decisions the arithmetic would not |

The middle row is the one people resist, because "a review only takes ten minutes" is true and irrelevant. Price the review at what a review *costs the business*: salary per hour divided by cases per hour, plus the queueing delay, plus the SLA penalty for a slow answer. Then look at the band again.

## 4.4 The same picture on real scores

Thresholds are only useful against a score distribution. Here is the same decision plotted against actual model output: cost per case as the threshold moves, on a mix of confident and uncertain cases.

<svg viewBox="0 0 760 320" role="img" aria-label="The threshold is a business decision, not a default — cheapest here is 0.82" style="width:100%;height:auto;font-family:var(--sans,system-ui);font-size:11px">
<rect x="0" y="0" width="760" height="320" fill="transparent"/>
<line x1="62" y1="274.0" x2="610" y2="274.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="278.0" text-anchor="end" fill="var(--dim,#5c6472)">0</text>
<line x1="62" y1="194.0" x2="610" y2="194.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="198.0" text-anchor="end" fill="var(--dim,#5c6472)">20k</text>
<line x1="62" y1="114.0" x2="610" y2="114.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="118.0" text-anchor="end" fill="var(--dim,#5c6472)">40k</text>
<line x1="62" y1="34.0" x2="610" y2="34.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="38.0" text-anchor="end" fill="var(--dim,#5c6472)">60k</text>
<line x1="62.0" y1="274" x2="62.0" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="62.0" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.01</text>
<line x1="171.6" y1="274" x2="171.6" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="171.6" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.21</text>
<line x1="281.2" y1="274" x2="281.2" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="281.2" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.40</text>
<line x1="390.8" y1="274" x2="390.8" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="390.8" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.60</text>
<line x1="500.4" y1="274" x2="500.4" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="500.4" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.79</text>
<line x1="610.0" y1="274" x2="610.0" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="610.0" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.99</text>
<line x1="62" y1="274" x2="610" y2="274" stroke="var(--rule-2,#c5cbb2)" stroke-width="1.2"/>
<line x1="62" y1="274" x2="62" y2="34" stroke="var(--rule-2,#c5cbb2)" stroke-width="1.2"/>
<polyline points="62.0,61.8 67.6,73.7 73.2,81.1 78.8,87.5 84.4,92.5 90.0,97.1 95.6,101.4 101.1,105.6 106.7,109.0 112.3,111.6 117.9,114.4 123.5,117.2 129.1,120.0 134.7,123.1 140.3,125.4 145.9,128.6 151.5,131.5 157.1,134.2 162.7,137.5 168.2,139.4 173.8,141.8 179.4,143.8 185.0,146.5 190.6,149.9 196.2,152.2 201.8,154.3 207.4,156.7 213.0,160.4 218.6,163.2 224.2,165.9 229.8,168.1 235.3,170.9 240.9,173.7 246.5,177.3 252.1,180.2 257.7,182.6 263.3,185.1 268.9,187.5 274.5,189.2 280.1,191.7 285.7,194.4 291.3,196.4 296.9,198.7 302.4,201.2 308.0,202.4 313.6,203.5 319.2,205.2 324.8,207.4 330.4,209.3 336.0,211.2 341.6,212.4 347.2,214.0 352.8,215.7 358.4,217.9 364.0,218.7 369.6,220.1 375.1,221.9 380.7,224.3 386.3,225.7 391.9,227.3 397.5,228.7 403.1,229.7 408.7,231.2 414.3,231.8 419.9,233.1 425.5,233.7 431.1,234.4 436.7,235.4 442.2,235.7 447.8,236.9 453.4,237.3 459.0,238.2 464.6,239.2 470.2,240.4 475.8,240.7 481.4,241.2 487.0,241.4 492.6,241.3 498.2,241.2 503.8,241.5 509.3,241.5 514.9,242.0 520.5,241.6 526.1,241.5 531.7,241.2 537.3,241.0 542.9,241.0 548.5,240.8 554.1,240.8 559.7,240.7 565.3,240.8 570.9,240.4 576.4,239.9 582.0,239.4 587.6,238.4 593.2,237.6 598.8,236.7 604.4,235.3 610.0,233.4" fill="none" stroke="var(--accent,#6d28d9)" stroke-width="2.2"/>
<polyline points="336.0,242.0 336.0,61.8" fill="none" stroke="var(--dim,#6a7059)" stroke-width="2.2" stroke-dasharray="5 4"/>
<text x="336" y="312" text-anchor="middle" fill="var(--ink-2,#3a3f2c)">decision threshold on P(good)</text>
<text x="14" y="154" text-anchor="middle" fill="var(--ink-2,#3a3f2c)" transform="rotate(-90 14 154)">cost per case (INR)</text>
<text x="62" y="18" fill="var(--ink,#15170f)" font-size="12.5" font-weight="600">The threshold is a business decision, not a default — cheapest here is 0.82</text>
<line x1="624" y1="42" x2="644" y2="42" stroke="var(--accent,#6d28d9)" stroke-width="2.4"/>
<text x="650" y="46" fill="var(--ink-2,#3a3f2c)">cost per case</text>
<line x1="624" y1="62" x2="644" y2="62" stroke="var(--dim,#6a7059)" stroke-width="2.4" stroke-dasharray="5 4"/>
<text x="650" y="66" fill="var(--ink-2,#3a3f2c)">naive 0.5</text>
</svg>

Two readings matter. The minimum is not at 0.5 — it sits where the cost matrix says it should. And the curve is flat near its minimum, which is good news: being 0.05 off the optimal threshold costs very little, so you do not need a perfect cost estimate, only one within a factor of two. What is expensive is being at 0.5 when the optimum is 0.83, and that is a framing error, not a tuning error.

## 4.5 Regret: attributing the loss

Once a policy exists, the useful question is not "how accurate is it" but "how much did it lose, and who owns that loss". Regret is the difference between what you spent and what an oracle would have spent on the same cases with the same information. Split it in two:

- **Belief error** — the model's probability was wrong, so the right action for the belief was the wrong action in fact. This one is yours, and it shrinks with data and calibration.
- **Constraint regret** — the policy wanted to abstain and was not allowed to. This one belongs to whoever set the budget.

<svg viewBox="0 0 760 280" role="img" aria-label="Where the loss comes from: the cap dominates the model error" style="width:100%;height:auto;font-family:var(--sans,system-ui);font-size:11px">
<rect x="0" y="0" width="760" height="280" fill="transparent"/>
<rect x="92.3" y="232.3" width="107.8" height="1.7" fill="var(--accent,#6d28d9)" opacity="0.85" rx="3"/>
<text x="146.2" y="226.3" text-anchor="middle" fill="var(--ink,#15170f)">72</text>
<text x="146.2" y="252" text-anchor="middle" fill="var(--dim,#5c6472)">no-model baseline</text>
<rect x="260.8" y="222.2" width="107.8" height="11.8" fill="var(--accent,#6d28d9)" opacity="0.85" rx="3"/>
<text x="314.8" y="216.2" text-anchor="middle" fill="var(--ink,#15170f)">491</text>
<text x="314.8" y="252" text-anchor="middle" fill="var(--dim,#5c6472)">belief error</text>
<rect x="429.3" y="67.3" width="107.8" height="166.7" fill="var(--accent,#6d28d9)" opacity="0.85" rx="3"/>
<text x="483.2" y="61.3" text-anchor="middle" fill="var(--ink,#15170f)">6913</text>
<text x="483.2" y="252" text-anchor="middle" fill="var(--dim,#5c6472)">capacity cap</text>
<rect x="597.8" y="55.4" width="107.8" height="178.6" fill="var(--accent,#6d28d9)" opacity="0.85" rx="3"/>
<text x="651.8" y="49.4" text-anchor="middle" fill="var(--ink,#15170f)">7404</text>
<text x="651.8" y="252" text-anchor="middle" fill="var(--dim,#5c6472)">constrained total</text>
<line x1="62" y1="234" x2="736" y2="234" stroke="var(--rule-2,#c5cbb2)"/>
<text x="14" y="134" text-anchor="middle" fill="var(--ink-2,#3a3f2c)" transform="rotate(-90 14 134)">expected regret per case (INR)</text>
<text x="62" y="18" fill="var(--ink,#15170f)" font-size="12.5" font-weight="600">Where the loss comes from: the cap dominates the model error</text>
</svg>

The bars are the punchline of the whole section: the capacity cap costs an order of magnitude more than the model's error. Teams routinely spend a quarter of engineering on the small bar and never compute the large one. Compute both before you decide what to optimise.

There is a third bar teams forget entirely — the **no-model baseline**, the regret of taking the single best action for every case. When it is lower than your model's, as it is here, the model is subtracting value and the honest move is to ship the constant action until the cost matrix is fixed.

## 4.6 Should you pay for a second signal?

The principled version of "call the database first" is expected value of sample information: compare the expected cost after the signal with the expected cost now, and subtract the signal's cost.

```text
EVSI = E over signal z of [ min over a  cost(a | z) ]  −  min over a cost(a)  −  cost(z)
```

Buy the signal only when EVSI is positive. The interesting result is how often it is not: if the cost matrix makes one action dominant, a signal can only change the action near the edges, and the edge is where the traffic is not.

## 4.7 The code

Everything above, computed rather than asserted. First the regions — solved by intersecting lines, not by scanning a grid, because a grid hides dominated actions and is off by half a step.

```python run
"""Exact optimal regions, abstain pricing and regret decomposition."""
import itertools

ACTIONS = ["auto_approve", "manual_review", "decline"]
COSTS = {
    ("auto_approve", "bad"): 120_000.0, ("auto_approve", "good"): 0.0,
    ("manual_review", "bad"): 900.0,    ("manual_review", "good"): 900.0,
    ("decline", "bad"): 0.0,            ("decline", "good"): 24_000.0,
}


def line(action):
    """Expected cost as m*p + c with p = P(good)."""
    c_bad, c_good = COSTS[(action, "bad")], COSTS[(action, "good")]
    return c_good - c_bad, c_bad


def crossing(a1, a2):
    m1, c1 = line(a1)
    m2, c2 = line(a2)
    if abs(m1 - m2) < 1e-12:
        return None
    p = (c2 - c1) / (m1 - m2)
    return p if 0.0 <= p <= 1.0 else None


def regions():
    """[(p_lo, p_hi, action)] - exact, no grid."""
    cuts = sorted({0.0, 1.0} | {x for a1, a2 in itertools.combinations(ACTIONS, 2)
                                for x in [crossing(a1, a2)] if x is not None})
    out = []
    for lo, hi in zip(cuts[:-1], cuts[1:]):
        mid = (lo + hi) / 2
        best = min(ACTIONS, key=lambda a: line(a)[0] * mid + line(a)[1])
        if out and out[-1][2] == best:
            out[-1] = (out[-1][0], hi, best)
        else:
            out.append((lo, hi, best))
    return out


def dominated():
    """Actions that are never cheapest for any p. Not always a mistake - see 4.2."""
    winners = {a for _lo, _hi, a in regions()}
    return [a for a in ACTIONS if a not in winners]


def best_action(p):
    return min(ACTIONS, key=lambda a: line(a)[0] * p + line(a)[1])


def expected_cost(p):
    return {a: round(line(a)[0] * p + line(a)[1], 2) for a in ACTIONS}


print("regions (P(good)):")
for lo, hi, a in regions():
    print("  %6.4f - %6.4f  %-14s  cost at midpoint %9.0f" % (lo, hi, a, expected_cost((lo + hi) / 2)[a]))
print("dominated actions:", dominated() or "none")
print()
print("the threshold people quote: P(good) > %.4f to approve" % crossing("auto_approve", "decline"))
print("expected cost at p=0.71:", expected_cost(0.71))
```

```text
regions (P(good)):
  0.0000 - 0.0375  decline         cost at midpoint       450
  0.0375 - 0.9925  manual_review   cost at midpoint       900
  0.9925 - 1.0000  auto_approve    cost at midpoint       450
dominated actions: none

the threshold people quote: P(good) > 0.8333 to approve
expected cost at p=0.71: {'auto_approve': 34800.0, 'manual_review': 900.0, 'decline': 17040.0}
```

The `manual_review` region spanning almost the whole interval is the arithmetic telling you the review is too cheap. Two responses, and only one is a modelling change: raise the review cost to what a reviewer actually costs, or cap the volume with `max_abstain_rate` (§1 implements it, §2 uses it).

Now the regret decomposition, with a non-free oracle so the split means something:

```python run
"""Regret = model regret + approximation regret + constraint regret."""
import numpy as np

rng = np.random.default_rng(7)
n = 6000
p_true = rng.beta(0.6, 0.6, n)                 # the real posterior for each case
y = (rng.random(n) < p_true).astype(int)

# the model's belief: honest on average, wrong per case
p_model = np.clip(p_true + rng.normal(0, 0.10, n), 0.001, 0.999)


def action_for(p, cap=None, budget_actions=None):
    """Cost-optimal action, optionally under a capacity constraint."""
    if cap is not None and budget_actions is not None:
        return budget_actions
    return best_action(float(p))


def realised_cost(action, outcome):
    return COSTS[(action, "good" if outcome else "bad")]


def eu(action, p):
    return COSTS[(action, "bad")] * (1 - p) + COSTS[(action, "good")] * p


# 1. the oracle: right action for the true posterior, no constraints
oracle = [best_action(float(p)) for p in p_true]
# 2. the policy: right action for the model's belief
chosen = [best_action(float(p)) for p in p_model]
# 3. a no-model baseline: the single action with the lowest expected cost overall
best_constant = min(ACTIONS, key=lambda a: np.mean([eu(a, float(p)) for p in p_true]))
# 3. the constrained policy: same, but at most 25% may abstain
order = np.argsort([-(eu("manual_review", float(p)) < min(eu("auto_approve", float(p)),
                                                            eu("decline", float(p))))
                    for p in p_model])
capped = list(chosen)
budget = int(0.25 * n)
abstaining = [i for i, a in enumerate(capped) if a == "manual_review"]
for i in sorted(abstaining, key=lambda i: eu("manual_review", float(p_model[i])) -
                min(eu("auto_approve", float(p_model[i])), eu("decline", float(p_model[i]))))[:max(0, len(abstaining) - budget)]:
    capped[i] = best_action_excl = min(("auto_approve", "decline"),
                                      key=lambda a: eu(a, float(p_model[i])))

def regret(actions):
    """Expected regret against the true posterior - not the realised outcome."""
    return float(np.mean([eu(a, float(p)) - eu(o, float(p)) for a, o, p in zip(actions, oracle, p_true)]))


total = regret(capped)
belief = regret(chosen)
constraint = total - belief
baseline = regret([best_constant] * n)

print("no-model baseline: always %s" % best_constant)
print("  regret of always taking it        %10.1f" % baseline)
print("  what the model buys you           %10.1f" % (baseline - belief))
print()
print("regret of the constrained policy    %10.1f" % total)
print("  belief error (model vs truth)     %10.1f" % belief)
print("  constraint (capacity cap)         %10.1f" % constraint)
print()
print("realised cost, oracle actions      %10.1f" % float(np.mean([realised_cost(o, t) for o, t in zip(oracle, y)])))
```

```text
no-model baseline: always manual_review
  regret of always taking it              71.9
  what the model buys you               -419.0

regret of the constrained policy        7403.9
  belief error (model vs truth)          490.9
  constraint (capacity cap)             6912.9

realised cost, oracle actions           842.9
```

And the value of information, which is where most "should the model call an API first" arguments should start:

```python run
"""EVSI: should you pay for one more observation before deciding?"""

def evsi(p_prior, signal_accuracy, cost_signal):
    """A binary signal with known sensitivity/specificity, both = signal_accuracy."""
    sens = spec = signal_accuracy
    # P(signal=1) under the prior
    p_pos = sens * p_prior + (1 - spec) * (1 - p_prior)
    p_neg = 1 - p_pos
    # posterior after a positive and a negative signal
    post_pos = sens * p_prior / p_pos if p_pos > 0 else p_prior
    post_neg = (1 - sens) * p_prior / p_neg if p_neg > 0 else p_prior
    cost_now = min(eu(a, p_prior) for a in ACTIONS)
    cost_after = p_pos * min(eu(a, post_pos) for a in ACTIONS) + \
                 p_neg * min(eu(a, post_neg) for a in ACTIONS)
    return {"cost_now": round(cost_now, 1), "cost_after": round(cost_after, 1),
            "gain": round(cost_now - cost_after, 1),
            "evsi": round(cost_now - cost_after - cost_signal, 1)}


for p_prior in (0.2, 0.5, 0.8):
    for acc in (0.7, 0.9, 0.99):
        r = evsi(p_prior, acc, cost_signal=250.0)
        print("p=%.1f  signal acc=%.2f  gain %8.1f  EVSI %8.1f  %s" %
              (p_prior, acc, r["gain"], r["evsi"], "buy it" if r["evsi"] > 0 else "decide now"))
```

```text
p=0.2  signal acc=0.70  gain      0.0  EVSI   -250.0  decide now
p=0.2  signal acc=0.90  gain    186.0  EVSI    -64.0  decide now
p=0.2  signal acc=0.99  gain    666.6  EVSI    416.6  buy it
p=0.5  signal acc=0.70  gain      0.0  EVSI   -250.0  decide now
p=0.5  signal acc=0.90  gain      0.0  EVSI   -250.0  decide now
p=0.5  signal acc=0.99  gain    330.0  EVSI     80.0  buy it
p=0.8  signal acc=0.70  gain      0.0  EVSI   -250.0  decide now
p=0.8  signal acc=0.90  gain      0.0  EVSI   -250.0  decide now
p=0.8  signal acc=0.99  gain    474.6  EVSI    224.6  buy it
```

:::note[Note 4.1.a — which criterion when]
Expected utility needs calibrated probabilities and defensible costs. With neither — a new domain, a regulator asking about tails — use maximin over the plausible cost range and say so. Minimax regret is the right middle ground when costs are known but probabilities are contested. What is never acceptable is quietly using expected utility with invented numbers.
:::

## 4.8 The check

```python run
# the properties any cost matrix must satisfy before it goes near a model
regs = regions()
assert abs(sum(hi - lo for lo, hi, _a in regs) - 1.0) < 1e-9, "regions must tile [0, 1]"
assert all(lo < hi for lo, hi, _a in regs), "empty region"
for lo, hi, a in regs:                                   # the winner must win inside its region
    mid = (lo + hi) / 2
    assert best_action(mid) == a, "region and argmin disagree at %.3f" % mid
# a cost matrix with no free action has a non-zero floor - check you meant that
floor = min(max(COSTS[(a, o)] for a in ACTIONS) for o in ("bad", "good"))
print("regions tile [0,1]: ok | worst-case cost floor: %.0f" % floor)
```

```text
regions tile [0,1]: ok | worst-case cost floor: 24000
```

If the regions do not tile the unit interval, or the winner disagrees with the argmin inside its own region, the cost matrix is inconsistent and every threshold derived from it is wrong. That assertion is the cheapest test in this course and it catches the most expensive class of bug.
