# Compaction Evaluation Rubric

Scorable dimensions for rating compaction output quality. Each dimension is rated 1–5 independently. Dimensions are weighted — some matter more for continuation utility.

---

## Dimension 1: Trajectory Fidelity (weight: 2×)

**What it measures:** Does the output report *what happened* (the conversation trajectory) rather than *what was observed* (contents of read files)?

| Score | Criterion |
|-------|-----------|
| 5 | Reports trajectory exclusively. No file-content extraction masquerading as decisions. |
| 4 | Mostly trajectory. Minor conflation of "read X" with "learned Y from X". |
| 3 | Mixed — trajectory present but interleaved with file-content findings. |
| 2 | Primarily reports file contents as if they were session decisions. |
| 1 | No trajectory. Only file-content extraction. |

**Source:** Gold standard principle ("report trajectory, not content"), CONSOLIDATED_FINDINGS P9 (representation before optimization), compaction-principles Principle 1.

**Check against gold standard:** Does the output match the gold standard's description of what the user asked and what the agent did?

---

## Dimension 2: Decision Accuracy (weight: 2×)

**What it measures:** Are reported decisions real decisions from the session, or fabricated from file contents?

| Score | Criterion |
|-------|-----------|
| 5 | All decisions are genuine session decisions with correct rationale. Zero fabrication. |
| 4 | Decisions are genuine but some rationale is imprecise or missing evidence refs. |
| 3 | Mix of real decisions and inflated ones (observations labeled as decisions). |
| 2 | Most "decisions" are extracted from file contents, not session exchanges. |
| 1 | All decisions fabricated. Decision inflation throughout. |

**Source:** CONSOLIDATED_FINDINGS P2 (evidence-linked decisions), trace-v2 F12 (decision inflation risk), compaction-principles failure mode "decision inflation".

**Check against gold standard:** Gold standard says "no decisions made" → output must say the same. Gold standard lists N decisions → output must match those N, not invent extras.

---

## Dimension 3: Continuation Sufficiency (weight: 2×)

**What it measures:** Can the next agent take the correct next action from this compaction alone?

| Score | Criterion |
|-------|-----------|
| 5 | Next agent can resume immediately. Next steps are specific, ordered, and actionable. |
| 4 | Next agent can resume with minor clarification needed. |
| 3 | Next agent has direction but must re-read parts of the session for details. |
| 2 | Next agent has vague direction. Must reconstruct context from scratch. |
| 1 | No usable next steps. Next agent is lost. |

**Source:** compaction-principles Principle 7 ("whether the next action can be predicted/executed correctly"), minimal-progress-capsule field rules (next_needed_step: always keep).

**Check:** Do the next steps match what the remaining 30% of the session actually did?

---

## Dimension 4: Size Discipline (weight: 1×)

**What it measures:** Is the output proportional to the session's substance? A session with nothing accomplished should yield a tiny summary.

| Score | Criterion |
|-------|-----------|
| 5 | Size ≤ 2× gold standard. Dense, no filler. |
| 4 | Size ≤ 3× gold standard. Some redundancy but mostly tight. |
| 3 | Size ≤ 5× gold standard. Noticeable padding or over-enumeration. |
| 2 | Size 5–10× gold standard. Significant bloat. |
| 1 | Size > 10× gold standard. Essentially a transcript dump. |

**Source:** compaction-principles Principle 2 (minimality is decision-relative), CONSOLIDATED_FINDINGS R3–R5 (remove stale chatter, outdated hypotheses, redundant summaries).

**Check:** `len(output) / len(gold_standard)` ratio.

---

## Dimension 5: Fact/Inference Separation (weight: 1×)

**What it measures:** Does the output distinguish observable facts from interpretations?

| Score | Criterion |
|-------|-----------|
| 5 | Facts and inferences clearly separated. Uncertainty marked where appropriate. |
| 4 | Mostly separated. Minor blending of fact and inference. |
| 3 | Some separation but several inferences presented as facts. |
| 2 | Blended throughout. Hard to tell what was observed vs. inferred. |
| 1 | No separation. All statements presented as facts. |

**Source:** evidence-linked-traces pattern (ContextTrace physics vs DecisionTrace cognition), compaction-principles Principle 1 (separate observable state from interpretation).

---

## Dimension 6: Evidence Anchoring (weight: 1×)

**What it measures:** Are key claims anchored to concrete references (paths, timestamps, file names)?

| Score | Criterion |
|-------|-----------|
| 5 | All substantive claims have exact references. Paths, names, error messages preserved. |
| 4 | Most claims anchored. A few vague references. |
| 3 | Some anchoring. Key paths or names missing. |
| 2 | Minimal anchoring. Claims float without references. |
| 1 | No anchoring. Pure narrative. |

**Source:** CONSOLIDATED_FINDINGS P11 (semantic anchoring), P12 (provenance tracking), P4 (file operations separate).

---

## Dimension 7: Structural Completeness (weight: 0.5×)

**What it measures:** Does the output cover the required sections (goal, progress, decisions, next steps, context)?

| Score | Criterion |
|-------|-----------|
| 5 | All required sections present and filled meaningfully. Empty sections correctly marked "(none)". |
| 4 | All sections present. One or two are thin but adequate. |
| 3 | Most sections present. One or two missing or hollow. |
| 2 | Half the sections missing or empty. |
| 1 | Unstructured or only a few sections. |

**Source:** CONSOLIDATED_FINDINGS P1 (structured sections), DRAFT_COMPACTION_PROMPT output format.

**Note:** This is the *only* dimension the current harness scorer approximates. It has the lowest weight because structure without substance is useless.

---

## Scoring formula

```
weighted_score = Σ(dimension_score × weight) / Σ(weights)
```

Total weight sum: 2+2+2+1+1+1+0.5 = **9.5**

Thresholds:
- **≥ 4.0**: Acceptable. Supports continuation.
- **3.0 – 3.9**: Marginal. Usable with caution.
- **< 3.0**: Fail. Does not support reliable continuation.

---

## Automated vs. manual

| Dimension | Automatable? | How |
|-----------|-------------|-----|
| Trajectory Fidelity | Partial | LLM judge comparing output to gold standard trajectory |
| Decision Accuracy | Partial | LLM judge checking if claimed decisions exist in session |
| Continuation Sufficiency | Manual (now) | Human review; LLM judge later |
| Size Discipline | ✅ Full | Character count ratio |
| Fact/Inference Sep | Partial | LLM judge |
| Evidence Anchoring | Partial | Regex for paths/names + LLM judge |
| Structural Completeness | ✅ Full | Section header detection (current scorer does this) |

---

## Usage

Run harness → for each session, score each dimension against the gold standard → compute weighted score → compare strategies.

The gold standard is the reference for Dimensions 1–3. The harness scorer currently only covers Dimension 7.