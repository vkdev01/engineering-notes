---
section: "19"
title: "Education"
kicker: "Use cases"
abstract: "Tutoring, assessment and routing decisions with a fairness requirement that is not optional."
time: "5 min"
order: 19
outcomes:
  - "Build a grading decision that tolerates adjacent bands"
  - "Report every metric per slice with intervals"
  - "Decide when a flagging model should not be built"
---

Education decision models are judged on learning outcomes and equity, not just accuracy. A model that improves
average mastery by 6 points while widening the gap for one group of students has made things worse.

## Decision inventory

| Decision | Actions | Data | Risk |
| --- | --- | --- | --- |
| Next-item difficulty | easier · same · harder | Response history | Low — reversible, high frequency |
| Free-text answer grading | score band 0–4 + feedback | Student answers + rubric | Medium — grade appeals |
| At-risk flagging | no-action · nudge · tutor-assign | Engagement + grades | High — labelling a child |
| Content routing | remedial · on-level · enrichment | Mastery estimates | Medium — track placement |

## Grading rubric as a decision spec

```text
spec = DecisionSpec(
    name="short_answer_grading",
    actions=["0", "1", "2", "3", "4"],
    costs={("4","0"): 12, ("0","4"): 12,       # gross errors are worst
           ("3","2"): 2,  ("2","3"): 2,         # adjacent bands are tolerable
           ("4","3"): 1,  ("3","4"): 1},
    abstain="2", max_abstain_rate=0.20,          # 20% -> human grader
)
```

Adjacent-band tolerance is what makes automated grading workable: a model that is usually within one band is useful
even when exact agreement is only ~70%.

## Reference numbers

| Metric | Human-only | SLM + human on abstain |
| --- | --- | --- |
| Exact agreement with expert grade | — | 71% |
| Within-one-band agreement | — | 96% |
| Grading turnaround | 5–9 days | < 1 minute for 80% of answers |
| Cost per 1,000 answers | ₹4,000–₹9,000 | ₹120 + human time on 20% |
| Feedback specificity | high | lower — but immediate |

*Illustrative figures from a synthetic rubric task. Real
grading agreement depends heavily on rubric clarity; fix the rubric before the model.*

## Fairness controls that actually work

- Report every metric per language, gender, and school-type slice — with confidence intervals, not point estimates.
- Set a hard constraint: no slice may be more than 5 points below the overall within-one-band agreement.
- Never train on demographic attributes; test for proxy leakage via a slice audit.
- Human review of a random 5% sample, permanently — not only during the pilot.
- Students and teachers can see and contest any automated grade.

:::warn[Do not build the at-risk flag as a black box]
Flagging a student changes how adults treat them. Any such model needs a documented intervention path, a way to
correct the record, and evidence that the intervention helps rather than stigmatises. Many teams correctly stop at
"nudge the teacher with a summary" instead of "label the child".
:::

## Language coverage

Tokeniser cost is a real equity issue: the same sentence in Hindi or Tamil can cost 2–4× more tokens than in
English, which shows up as higher latency and, in some products, lower quality of feedback. Measure it, then consider
a multilingual SLM or a language-specific adapter rather than accepting the gap.

```python
for lang, text in samples.items():
    print(lang, len(tok(text).input_ids))     # tokens per sentence, by language
```
