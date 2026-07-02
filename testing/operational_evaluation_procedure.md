# Operational Evaluation Procedure

Step-by-step instructions for scoring compaction results against the rubric.

---

## Prerequisites

- `testing/gold_standard/` — reference summaries
- `testing/sessions/` — raw JSONL session files
- `testing/compaction_results/` — generated compaction outputs
- `testing/compaction_evaluation_rubric.md` — dimension definitions
- `testing/scripts/evaluate_scores.py` — weighted-score calculator

---

## Step 1: Run the harness (generate compaction results)

```bash
python3 testing/compaction_test_harness.py
```

Or target specific sessions:

```bash
python3 testing/compaction_test_harness.py --sessions 15-03 20-19 20-23
```

Outputs appear in `testing/compaction_results/<session_id>/summary_<strategy>.txt`.

---

## Step 2: Load the three artifacts for the session

Open these files side by side:

1. **Input:** `testing/sessions/<session_id>.jsonl` — raw session
2. **Gold standard:** `testing/gold_standard/session_<time>_optimal.md` — reference trajectory
3. **Compaction output:** `testing/compaction_results/<session_id>/summary_<strategy>.txt` — what to score

---

## Step 3: Score each dimension (0–10)

For each strategy, evaluate against the 7 dimensions. Read the dimension definition from `compaction_evaluation_rubric.md`, then assign a score:

| Score | Meaning |
|---|---|
| 0 | Completely absent or catastrophically wrong |
| 1–2 | Present but severely deficient |
| 3–4 | Partially present; noticeable gaps |
| 5–6 | Adequate; meets basic bar |
| 7–8 | Strong; minor improvements possible |
| 9–10 | Excellent; matches gold standard closely |

### Dimension checklist

**1. Trajectory Fidelity (2×)**
- [ ] Does the output describe what the user asked and what the agent did?
- [ ] Does it avoid describing file contents as if they were session events?
- [ ] Compare to gold standard's "What Happened" section.

**2. Decision Accuracy (2×)**
- [ ] List every decision the output claims.
- [ ] For each: did this decision actually occur in the session, or is it extracted from file content?
- [ ] If gold standard says "no decisions made," any claimed decisions are fabrication.

**3. Continuation Sufficiency (2×)**
- [ ] Could the next agent take the correct next action from this output alone?
- [ ] Compare output's next steps to what the remaining 30% of the session actually did.

**4. Size Discipline (1×)**
- [ ] Compute: `len(output_chars) / len(gold_standard_chars)`
- [ ] ≤ 2× → 5–10, ≤ 3× → 4, ≤ 5× → 3, 5–10× → 2, > 10× → 1

**5. Fact/Inference Separation (1×)**
- [ ] Can you distinguish observable facts from interpretations?
- [ ] Are uncertainties marked?

**6. Evidence Anchoring (1×)**
- [ ] Do key claims have exact references (paths, timestamps, names)?
- [ ] Are file operations listed with paths?

**7. Structural Completeness (0.5×)**
- [ ] Are required sections present and meaningful?
- [ ] Are empty sections correctly marked "(none)"?

---

## Step 4: Record raw scores

Create `testing/scores_session_<time>.json`:

```json
{
  "pi": [d1, d2, d3, d4, d5, d6, d7],
  "smart": [d1, d2, d3, d4, d5, d6, d7],
  "minimal": [d1, d2, d3, d4, d5, d6, d7]
}
```

Order: Trajectory Fidelity, Decision Accuracy, Continuation Sufficiency, Size Discipline, Fact/Inference Separation, Evidence Anchoring, Structural Completeness.

---

## Step 5: Calculate weighted totals

```bash
python3 testing/scripts/evaluate_scores.py testing/scores_session_<time>.json --show-table
```

Output:
- `raw_sum`: Σ(score × weight)
- `weighted_score`: raw_sum / 9.5
- `%`: raw_sum / 95 × 100
- `grade`: ≥ 4.0 Acceptable, ≥ 3.0 Marginal, < 3.0 Fail

---

## Step 6: Write evaluation report

Create `testing/evaluation_session_<time>.md` containing:
- Session input description
- Gold standard text
- Score table (all 7 dimensions per strategy)
- Weighted totals (reference script output)
- Diagnosis: what failed, why, root cause
- Action items: what to fix in prompts/harness

---

## Repeat for each session

Run Steps 2–6 for every session in `testing/sessions/`. Results accumulate in:
- `testing/scores_session_*.json` — raw data
- `testing/evaluation_session_*.md` — narrative reports

---

## Notes

- **No mental math.** All weighted calculations go through the script.
- **Scores are subjective** (except Size Discipline and Structural Completeness). Disagreements are expected — document rationale in the evaluation report's dimension notes column.
- **Re-score freely.** Change a score in the JSON, re-run the script, update the report. The scores file is the source of truth.