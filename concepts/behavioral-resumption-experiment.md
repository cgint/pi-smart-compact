# Behavioral Resumption Experiment

## Status

Proposal for shifting compaction evaluation from static document-quality scoring to behavioral testing. Motivated by the finding that rubric scores (smart 4.26 vs pi 3.87) may not correlate with actual agent continuation utility.

---

## A) Where we stand

### Current state

We completed a rubric-based evaluation of three compaction strategies (pi, smart, minimal) across four diverse sessions. Results:

| Strategy | Weighted average | Grade |
|---|---|---|
| smart | 4.26 | Acceptable |
| pi | 3.87 | Marginal |
| minimal | 2.21 | Fail |

The gap between `smart` and `pi` is **0.39 on a 1–5 scale** — modest, not striking. On 46% of dimension-slot pairs, scores are identical.

### The core issue

We are scoring **document quality** — structure, decision framing, fact/inference separation, evidence anchoring. These are proxy metrics. The real question is whether the compaction actually helps a resumed agent stay aligned to the goal.

A summary that scores 5.0 on "structural completeness" and "evidence anchoring" might not help a resumed agent any better than a looser summary. Conversely, a less structured summary might contain the right signal for continuation.

### The risk

As noted in compaction-principles Principle 7:

> *Measure compaction by usefulness, not compression ratio alone.*

We extended this to document-quality metrics, but the same risk applies: **proxy metric hacking**. We may be optimizing for rubric scores, not behavioral utility. The gold standard itself encodes our biases about what a "good" summary looks like, not what a resumed agent actually needs.

### The goal

Establish whether compaction differences translate to **measurable behavioral differences** in resumed agents. If pi and smart produce identical agent behavior, the 0.39 rubric gap is behaviorally inert — and we must rethink our compaction strategy.

---

## B) Larger vision

A reliable evaluation environment for compaction methods based on **behavioral evidence**, not document aesthetics. This enables:

- Iterating compaction prompts with confidence that improvements are real
- Detecting when rubric gains are cosmetic
- Building trust that compaction actually serves continuation utility

Not a replacement for rubric scoring (which catches structural defects), but a necessary complement that tests the ultimate purpose.

---

## C) Minimal pilot protocol

### Pilot session

**Slot 2: web-scrape-meno** — chosen because:
- Highest gold standard fidelity (4.7/5.0)
- Complex debugging state (multiple layers: Cloud Run, local dev, widget CSS, backend)
- Clear "next step" (cleanup GCP resources, plan Wix integration)
- Largest smart-vs-pi gap in the rubric (4.68 vs 3.95)

### Experimental design

**Three conditions:**

| Condition | Input to resumed agent | Purpose |
|---|---|---|
| **pi** | `summary_pi.txt` compaction | Baseline compaction |
| **smart** | `summary_smart.txt` compaction | Candidate improvement |
| **control** | No compaction (workspace only) | Establish baseline: what can the agent infer from files alone? |

**Resumption prompt (identical for all conditions):**

```
You are a resumed agent. Below is the compaction summary of the previous session.
Review the context, state the active goal, and execute the single next step.

--- COMPACTION SUMMARY ---
<compaction_content>
--- END COMPACTION SUMMARY ---
```

For the control condition, replace the compaction block with:

```
No compaction summary is available. The workspace is at the state where the previous session ended.
Inspect the workspace and determine the active goal and next step.
```

**Controls:**

- **Same model:** `qwen36-35b-nvidia-nvfp4` on `sparky:8001`
- **Cold start:** empty message history, no external context beyond the compaction/workspace
- **Workspace state:** checkout to the exact git commit at the compaction point to prevent state leakage from later modifications
- **Token budget:** ensure the compaction input is not truncated (verify input length < model max)

### Three binary metrics

| Metric | Question | Pass criteria |
|---|---|---|
| **Goal Preservation** | Does the agent correctly identify the primary, active goal? | Matches gold standard's outcome/current state |
| **State Awareness** | Does it recognize what is already completed? | Does NOT try to redo finished work (e.g., re-investigating Cloud Run, re-fixing CSS) |
| **First Action Precision** | Is the first tool call the correct logical next step? | Functionally equivalent to what the session actually did next |

### Execution steps

1. Checkout workspace to the commit corresponding to Slot 2's compaction point
2. Run condition **control** first (establishes baseline)
3. Run condition **pi**
4. Run condition **smart**
5. For each, record: stated goal, first tool call, whether it skipped completed work
6. Compare against gold standard's "Current State" and "Next Steps"

### Stop signals

| Observation | Interpretation | Action |
|---|---|---|
| Control ≈ smart | Workspace contains too many state cues; compaction adds no value | Experiment invalid; reduce workspace signal or choose different session |
| pi ≈ smart | Rubric gap is behaviorally inert | Rethink compaction strategy; rubric is measuring cosmetic differences |
| smart > pi on ≥2 metrics | Compaction improvement has behavioral effect | Continue to multi-session validation |
| smart < pi on any metric | Smart prompt introduces regression | Diagnose which dimension causes harm |

### Recording results

Save results in `testing/behavioral_resumption_pilot.md` with:
- Raw agent output for each condition (first turn only)
- Binary metric scores with justification
- Comparison against gold standard
- Conclusion: behavioral difference detected or not

---

## D) Outlook / Out of scope for the pilot

**Beyond the pilot (future work):**

- **Multi-session validation:** Run the same protocol on all 4 sessions for statistical confidence
- **Automated resumption harness:** Script the three-condition comparison (after manual pilot proves the method works)
- **Cross-model comparisons:** Test whether behavioral gaps hold across different models
- **LLM-judge variants:** Use an LLM to score behavioral outcomes (after human-reviewed pilot establishes ground truth)
- **Longer-horizon testing:** Measure not just first action, but 3–5 turns of resumed behavior

**Out of scope for now:**

- Statistical significance testing (single pilot is exploratory)
- Automated infrastructure (keep manual to verify the method)
- Comparing against Pi's built-in compaction in live sessions (requires Pi integration)

---

## Source evidence

- `testing/evaluation_report.md` — rubric evaluation results showing modest smart-vs-pi gap
- `testing/gold_standard/session_slot2-web-scrape-debug_optimal.md` — gold standard for pilot session
- `testing/compaction_results/--Users-cgint-dev-web-scrape-meno--/summary_pi.txt` — pi compaction output
- `testing/compaction_results/--Users-cgint-dev-web-scrape-meno--/summary_smart.txt` — smart compaction output
- `concepts/compaction-principles.md` — Principle 7 (measure by usefulness), failure mode "Proxy metric hacking"
- Advisor analysis (2026-07-03) — experimental design recommendations, control group necessity, workspace leakage risk