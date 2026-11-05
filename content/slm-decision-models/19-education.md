---
section: "19"
title: "Education"
kicker: "Use cases"
abstract: "Short-answer grading as a release-or-review decision with ordinal costs: auto-release almost everything in formative practice, almost nothing in a summative exam, and a per-group error floor that costs ₹1 per answer and makes English learners wait longer for feedback."
time: "13 min"
order: 19
outcomes:
  - "Price grading errors by band distance and decide release vs teacher review per answer"
  - "Explain why the same model auto-releases 100% of formative answers and under 25% of summative ones"
  - "Impose a per-group gross-error floor and compute what it costs in money and feedback delay"
  - "Design at-risk flagging as capacity-ranked teacher support, not a label on a student"
---

A school network runs weekly short-answer quizzes in science: about 40,000 answers a week, each graded 0–4 against a rubric. Teachers spend evenings marking, and feedback reaches students days after they have moved on. An SLM grader could return a band in seconds. The decision is not "what grade" alone — it is **release the model's grade now, or send the answer to a teacher**, and the answer depends on what a wrong grade costs, which differs between a practice quiz and an exam, and between students the model reads well and students it reads poorly.

:::key[First principle]
In education the model releases a grade only when its expected cost of being wrong is below the price of a teacher's minute — and that cost depends on how far off it can be, how much the grade matters, and who the student is. Errors must be bounded per group, not just on average, and every automated grade must be contestable by a person.
:::

## 19.1 Where SLMs fit

| Decision | Actions | Fit | Who decides |
| --- | --- | --- | --- |
| Formative short-answer grading | release band · `teacher_review` | Good: high volume, errors cheap and correctable | Model releases; teacher spot-checks and handles disputes |
| Summative grading | release band · `teacher_review` | Assist: model pre-sorts and drafts feedback | Teacher confirms nearly every grade |
| Next-item difficulty | easier · same · harder | Good: reversible within minutes | Model |
| At-risk support | `teacher_check_in` (ranked) | Assist only, capacity-ranked | Teacher, with the student and family |
| Track placement, admissions, discipline | — | Do not automate | People, under policy |

The deep course's [domain-fit rubric](/c/practical-slm-decision-models/15-use-cases-and-domain-fit) explains the split: grading has closed actions and observable outcomes (an expert grade), but regulatory and fairness exposure rises steeply when a decision follows the student.

## 19.2 Ordinal costs and the release rule

Grading errors are not equal: one band off is an argument, two bands off is a broken promise. Price by **distance** $|b - y|$ between the released band $b$ and the expert band $y$, with an illustrative teacher review at ₹15 (one minute at ₹900/hour):

| Stakes | exact | off by 1 | off by 2+ | teacher review |
| --- | ---: | ---: | ---: | ---: |
| Formative (practice quiz) | 0 | 10 | 60 | 15 |
| Summative (term exam) | 0 | 60 | 400 | 15 |

Given the model's calibrated distribution $P(y)$ over bands, the best band to release and the decision are

$$
b^* = \arg\min_b \sum_{y} C(|b-y|)\,P(y), \qquad \text{release } b^* \text{ if } \sum_y C(|b^*-y|)\,P(y) < c_{\text{review}}, \text{ else teacher.}
$$

:::example[Worked example · one answer, two stakes]
The model reads a student's explanation of osmosis and returns $P(y) = (0, 0.05, 0.25, 0.60, 0.10)$ for bands 0–4.

- **Formative.** Releasing band 3: off-by-one mass \(0.25 + 0.10\) = 0.35, costing \(0.35 \times 10\) = 3.5; off-by-two mass 0.05, costing \(0.05 \times 60\) = 3.0. Total ₹6.5 < ₹15: **release band 3** now.
- **Summative.** The same band costs \(0.35 \times 60 + 0.05 \times 400\) = ₹41, and the next-best (band 2) ₹79. Both exceed ₹15: **send to the teacher**.

Same model, same probabilities, opposite decisions — because the stakes, not the model, set the bar.
:::

## 19.3 Two groups, two stakes, 200,000 answers

Simulate 200,000 answers with an illustrative band mix. 80% are written by fluent writers, whom the model reads well (score noise 0.55 bands); 20% by English-language learners, whose correct ideas in non-standard phrasing the model reads less reliably (noise 0.85 bands). Probabilities are calibrated per group. The last two lines show what happens when calibration is fitted on fluent writers only.

```python run
import numpy as np

# Short-answer grading, bands 0-4: release the model's band or send to a teacher. INR, illustrative.
REVIEW = 15.0                                   # one teacher-minute at an illustrative INR 900/hour
STAKES = {"formative": (10.0, 60.0), "summative": (60.0, 400.0)}   # cost if off by 1 band, by 2+
BANDS = np.arange(5)
PRIOR = np.array([0.10, 0.20, 0.30, 0.25, 0.15])
GROUPS = {"fluent": (0.80, 0.55), "learners": (0.20, 0.85)}   # (share, model noise sigma in bands)
rng = np.random.default_rng(19)
N = 200_000
grp = rng.choice(list(GROUPS), N, p=[g[0] for g in GROUPS.values()])
sig = np.array([GROUPS[g][1] for g in grp])
y = rng.choice(5, N, p=PRIOR)                   # expert grade
s = y + sig * rng.normal(size=N)                # model's continuous grade


def posterior(sig):
    like = np.exp(-0.5 * ((s[:, None] - BANDS) / sig[:, None]) ** 2)
    post = like * PRIOR
    return post / post.sum(1, keepdims=True)


def run(post, off1, off2):
    gap = abs(BANDS[:, None] - BANDS)
    loss = np.where(gap == 0, 0.0, np.where(gap == 1, off1, off2))
    exp = post @ loss.T                          # expected cost of releasing each band
    band, rel = exp.argmin(1), exp.min(1) < REVIEW
    cost = np.where(rel, loss[band, y], REVIEW)
    return band, rel, cost


def show(label, band, rel, cost):
    for g in GROUPS:
        m = grp == g
        r, err = rel[m], abs(band[m] - y[m])
        print(f"{label:24s} {g:9s} released {r.mean():6.1%}  exact {(err[r] == 0).mean():6.1%}  "
              f"within-1 {(err[r] <= 1).mean():6.1%}  gross/1k {(r & (err >= 2)).mean() * 1e3:5.1f}  "
              f"INR {cost[m].mean():5.2f}")


post = posterior(sig)
print(f"teacher grades everything: INR {REVIEW:.2f}/answer")
for stake, (off1, off2) in STAKES.items():
    show(f"{stake}", *run(post, off1, off2))
fluent_only = posterior(np.full(N, GROUPS["fluent"][1]))   # calibration fitted on fluent writers only
show("summative, fluent calib.", *run(fluent_only, *STAKES["summative"]))
```

```output
teacher grades everything: INR 15.00/answer
formative                fluent    released 100.0%  exact  69.3%  within-1  99.7%  gross/1k   2.7  INR  3.21
formative                learners  released 100.0%  exact  52.7%  within-1  97.2%  gross/1k  27.9  INR  6.12
summative                fluent    released  23.5%  exact  84.2%  within-1 100.0%  gross/1k   0.1  INR 13.74
summative                learners  released   3.8%  exact  87.3%  within-1  99.6%  gross/1k   0.1  INR 14.77
summative, fluent calib. fluent    released  23.5%  exact  84.2%  within-1 100.0%  gross/1k   0.1  INR 13.74
summative, fluent calib. learners  released  27.0%  exact  63.8%  within-1  97.6%  gross/1k   6.4  INR 19.00
```

(Exact and within-1 are measured on released answers; gross/1k counts released answers two or more bands off, per 1,000 answers in the group.)

- **Formative: release everything, and it pays.** Cost falls from ₹15 to ₹3.21 per answer for fluent writers and ₹6.12 for learners, with exact agreement of 69.3% — usable because within-one agreement is 99.7%.
- **Summative: the model is mostly a sorter.** It releases 23.5% of fluent answers and 3.8% of learners', saving ₹1.26 and ₹0.23 per answer. At exam stakes the value is in pre-sorting and drafting feedback, not in grading.
- **Pooled calibration is worse than no model.** Calibrated on fluent writers, the grader is overconfident on learners: it releases 27.0% of their exam answers with 6.4 gross errors per 1,000, at ₹19.00 per answer — more than paying a teacher for every one.

## 19.4 A per-group error floor, and what it costs

In formative mode the cost-optimal policy gives learners 27.9 gross errors per 1,000 answers against 2.7 for fluent writers — ten times as many. The average looks fine; the learners do not. A fairness floor makes the constraint explicit: **no group may exceed 5 gross errors per 1,000 answers.** Lower a group's release trigger (the expected-cost bar, ₹15 by default) until it meets the floor, and count the cost in rupees and in feedback delay (teacher turnaround illustrative: 3 days).

```python run
off1, off2 = STAKES["formative"]
gap = abs(BANDS[:, None] - BANDS)
loss = np.where(gap == 0, 0.0, np.where(gap == 1, off1, off2))
exp = post @ loss.T
band, best = exp.argmin(1), exp.min(1)
FLOOR, WAIT_DAYS = 5.0, 3.0                     # max gross errors per 1,000 answers; teacher turnaround
print(f"formative, release if expected cost < trigger; floor: gross errors <= {FLOOR:.0f} per 1,000 per group")
total = 0.0
for g in GROUPS:
    m = grp == g
    err = abs(band[m] - y[m])
    for trig in np.arange(15.0, 0.0, -0.25):    # lower the trigger until the group meets the floor
        rel = best[m] < trig
        if (rel & (err >= 2)).mean() * 1e3 <= FLOOR:
            break
    cost = np.where(rel, loss[band[m], y[m]], REVIEW).mean()
    total += cost * m.mean()
    print(f"  {g:9s} trigger INR {trig:5.2f}: released {rel.mean():6.1%}, gross/1k "
          f"{(rel & (err >= 2)).mean() * 1e3:4.1f}, INR {cost:5.2f}/answer, "
          f"mean feedback wait {(~rel).mean() * WAIT_DAYS:4.2f} days")
_, _, c_free = run(post, off1, off2)
print(f"blended INR {total:.2f}/answer with the floor vs {c_free.mean():.2f} without: "
      f"the floor costs INR {total - c_free.mean():.2f}/answer")
```

```output
formative, release if expected cost < trigger; floor: gross errors <= 5 per 1,000 per group
  fluent    trigger INR 15.00: released 100.0%, gross/1k  2.7, INR  3.21/answer, mean feedback wait 0.00 days
  learners  trigger INR  5.75: released  38.4%, gross/1k  4.1, INR 11.09/answer, mean feedback wait 1.85 days
blended INR 4.79/answer with the floor vs 3.79 without: the floor costs INR 0.99/answer
```

:::chart[Gross grading errors per 1,000 answers vs the release trigger (formative)]{type="line" x="release trigger: max expected cost (₹)" y="gross errors per 1,000 answers" hmarks="5:floor" marks="5.75:learners' trigger;15:default (₹15)" note="Synthetic, 200,000 answers; learners are 20% with a noisier model read (0.85 vs 0.55 bands). Costs illustrative."}
trigger, fluent writers, English learners
1, 0.006, 0.025
2, 0.019, 0.075
2.5, 0.113, 0.150
3, 0.406, 0.275
3.5, 0.725, 0.400
4, 1.131, 0.649
4.5, 1.482, 0.824
5, 1.975, 1.099
5.25, 2.225, 2.198
5.5, 2.482, 3.222
5.75, 2.719, 4.146
6, 2.719, 6.395
6.25, 2.719, 8.268
6.5, 2.719, 10.166
7, 2.719, 13.464
7.5, 2.719, 16.436
8, 2.719, 19.533
9, 2.719, 26.453
10, 2.719, 27.851
12, 2.719, 27.851
15, 2.719, 27.851
:::

- **The floor is cheap in money.** ₹0.99 per answer — at 40,000 answers a week, about ₹40,000 a week of teacher time, all of it spent on learners' answers.
- **It is not free in experience.** Learners' answers are released only 38.4% of the time, so they wait 1.85 days on average for feedback while fluent writers wait none. Fewer wrong grades for learners has bought slower feedback for learners. Name that trade in the design review; the durable fix is a model that reads learners better (more labelled answers in their phrasing, rubric exemplars written in plain language), which shrinks both gaps at once.
- **Set the triggers on held-out data.** The loop above tunes and reports on the same sample for brevity. In practice pick the trigger on one labelled set, confirm on another, and report each group's gross-error rate with an interval: a class of 30 learners cannot demonstrate a 5-per-1,000 floor on its own.

## 19.5 At-risk support: rank for a teacher, don't label a child

Flagging a student "at risk" changes how adults treat them, and the outcome you would price — a term failed, a student lost — is not something to put in a cost matrix. Treat it as a **capacity problem**, not a threshold:

- Each teacher can do a fixed number of check-ins a week (say 5). The model **ranks** students by predicted need; the teacher sees the top of the list with the evidence (missed submissions, falling quiz bands) and decides whether to act.
- **No stored label.** The ranking is recomputed weekly, visible only to the teacher, and never written to the student's record or shared with other staff.
- **Measure whether it helps.** Roll out to randomly chosen classes first and compare outcomes; a check-in that stigmatises is worse than none.
- **Exclude protected attributes and audit proxies** (postcode, school type, home language) by comparing ranking rates across the groups you are permitted and required to monitor.

## 19.6 Governance checklist

:::exercise[Exercise 19.1 · Automated grading pre-flight]{id="checklist" items="Rubric with exemplars for every band, agreed by teachers;Error costs set per stake (formative vs summative) and signed off;Calibration fitted and checked per language and school-type group;Per-group gross-error floor with intervals on held-out data;Every automated grade visible, explained by rubric criteria and contestable;Random 5% of released grades re-marked by teachers, permanently;No protected attributes as inputs, with a proxy audit by group;Summative release rule approved by the exam owner, with teacher review on any dispute"}
:::

Practical rules:

- **Fix the rubric before the model.** If two teachers agree on only 70% of answers, no model will do better; measure inter-rater agreement first.
- **Explain by criterion, not by prose.** Feedback cites which rubric criteria were met, drawn from a closed set; free-form generated feedback is checked against the rubric before a student sees it.
- **Language coverage is an equity issue.** Count tokens per answer by language with your tokenizer: scripts such as Devanagari or Tamil take 3 UTF-8 bytes per character, so byte-level tokenizers with few merges for them produce many more tokens per sentence — more latency, more truncation, often worse reads. Measure, then consider a multilingual model or an adapter.
- **Monitor drift each term.** New topics, new question formats and rubric revisions all shift the score distribution; recheck calibration per group at the start of every term.

## 19.7 Check yourself

:::qa[The teacher-review cost rises from ₹15 to ₹30 (an evening rate). What happens to the summative example in §19.2?]
Releasing band 3 still costs ₹41 in expectation, which is above ₹30: the answer still goes to the teacher. At ₹45 it would be released. The review price moves the bar; stakes this high keep most answers with the teacher anyway.
:::

:::qa[Why did fluent-only calibration make summative grading worse than paying a teacher for everything?]
The grader assumed learners' answers were read as precisely as fluent writers' (noise 0.55 instead of 0.85 bands), so its probabilities were overconfident. It released 27.0% of learners' exam answers expecting a low cost, and the true cost was ₹19.00 per answer with 6.4 gross errors per 1,000 — above the ₹15 of teacher-only grading.
:::

:::qa[A district wants one number: "the grader is 66% accurate". What do you report instead?]
Per stake and per group: release rate, exact and within-one agreement on released answers, gross errors per 1,000 with intervals, cost per answer and mean feedback delay. From §19.3–19.4, formative learners at the floor: 38.4% released, 4.1 gross errors per 1,000, ₹11.09 per answer, 1.85 days mean wait — the trade-offs the single number hides.
:::

Next: [Autonomous systems](/c/slm-decision-models/20-autonomous-systems).
