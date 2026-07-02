# Gold Standard Critique

Evaluation of each gold standard against the 7-dimension rubric. Identifies strengths, weaknesses, and whether each gold standard is a valid reference for scoring compaction outputs.

---

## Slot 1 — Smart Compact Setup

### Strengths
- **Trajectory is accurate**: Captures the arc from setup → redirection → frustration → loop → resolution. Events are chronologically coherent.
- **Decisions are real**: Git init, .gitignore rules, repo publishing, model server choice — all verifiable from the session.
- **Context is useful**: Points to compaction prompt, harness, rubric, model server config.
- **Uncertainty section is honest**: Flags self-referential bias ("created by same agent"), untested assumptions.

### Weaknesses
- **Section 4: Evidence Anchoring — Score 3/5**: References are mostly file paths and names, but lacks specific anchors like "line 42 of compaction_test_prompt.md" or "error message at timestamp 14:33Z". The GitHub repo name is mentioned but no commit SHA or PR number.
- **Section 6: Fact/Inference Separation — Score 4/5**: "User became increasingly frustrated" is an inference, not an observable fact. Better: "User issued repeated corrections (44 corrections across 139 messages) and redirected agent behavior at least 12 times."
- **Section 7: Structural Completeness — Score 4/5**: All sections present, but "Current State" overlaps significantly with "Outcome" — both describe the draft prompt as complete and next phase as field testing. Could be merged.

### Verdict: Valid gold standard. Minor tightening needed on inference labeling and evidence specificity. **Expected rubric score: 4.3/5.0**

---

## Slot 2 — Web Scrape Debug

### Strengths
- **Exceptional trajectory fidelity**: Captures the debugging spiral accurately — parse errors → diagnosis → fix → new layer of issues → more debugging. The chain of causality is preserved.
- **Strong evidence anchoring**: Specific file paths (`chat_model.py:151`), line numbers, byte positions (~7639-8262), HTTP endpoints, tmux session names, URLs. This is the best-anchored gold standard.
- **Clear outcome distinction**: Separates what was achieved (widget renders, session ID generated) from what remains unresolved (backend response not confirmed).
- **Uncertainty is actionable**: Flags specific unknowns that could mislead a resuming agent.

### Weaknesses
- **Section 6: Fact/Inference — Score 4/5**: "Agent entered an infinite loop trying to check Cloud Run" is an inference. Better: "Agent issued repeated Cloud Run status checks (7+ queries) without progressing."
- **Section 7: Structural Completeness — Score 4/5**: "Current State" restates the debugging depth already captured in "What Happened". The transition between layers (frontend → client → backend) could be clearer as a structured list rather than prose.
- **Section 4: Size Discipline — Score 4/5**: At ~1200 words, this is dense but justified by the session complexity. However, some detail on the browser CSS fix (`div.chatbox` → `div.meno-mia-chatbox`) may be overly granular for a compaction summary.

### Verdict: Strongest gold standard in the set. Best evidence anchoring and trajectory preservation. **Expected rubric score: 4.7/5.0**

---

## Slot 3 — Discuss Mode Extension

### Strengths
- **Accurate decision capture**: Tri-state system, reset removal, license propagation — all real decisions with rationale.
- **Clear structure**: Four sections are distinct and non-overlapping.
- **Good uncertainty framing**: Flags the agent loop problem and GitHub publication ambiguity.

### Weaknesses
 **Critical gap — Section 2: Decision Accuracy — Score 3/5**: "Tests adapted" is stated without specifying WHAT was adapted or WHY. The gold standard should capture that the test changes were a direct consequence of the reset→off renaming, not generic test updates.
- **Section 6: Evidence Anchoring — Score 3/5**: File paths are absent. "Extension: pi-discuss-mode (TypeScript)" is vague — no file paths, no function names, no prompt injection points. The sibling repos are named but no relative paths given.
- **Section 4: Size Discipline — Score 4/5**: Reasonably sized but the "Current State" section adds almost nothing beyond "What Happened."

### Verdict: Weakest gold standard in the set. Needs tighter evidence anchoring and more specific test descriptions. **Expected rubric score: 3.5/5.0**

---

## Slot 4 — Web Scrape Deploy

### Strengths
- **Comprehensive trajectory**: Captures the full arc — OpenSpec introduction → Cloud Run removal → testing pipeline → critical requirement → implementation → UX nit.
- **Good decision capture**: Terms acknowledgment requirement, D2 diagrams, async test improvement — all real decisions with context.
- **Actionable uncertainty**: Flags specific unresolved items (UX nit, async test coverage).

### Weaknesses
- **Weakness — Section 1: Trajectory Fidelity — Score 4/5**: Good overall trajectory but includes interaction-level detail ("All good, it's fine. Let's work together here.") that is interaction flavor, not continuation-relevant trajectory.
- **Section 6: Evidence Anchoring — Score 3/5**: References URLs and concept names but lacks file paths for the OpenSpec proposal, the skill file (.pi/skills/...), and the async test file. "OpenSpec: proposal under refinement" is not anchored to a specific file.
- **Section 7: Structural Completeness — Score 4/5**: All sections present but "Outcome" and "Current State" blur together. Both describe the terms acknowledgment as implemented. The distinction between "what was achieved" and "where things stand" is unclear.
- **Section 4: Size Discipline — Score 3/5**: At ~1300 words, this is the longest gold standard. Some detail on the browser automation struggle and the OpenSpec proposal review sequence may be excessive for a compaction reference.

### Verdict: Solid but slightly bloated. Needs tighter evidence anchoring for OpenSpec files and clearer Outcome vs Current State distinction. **Expected rubric score: 3.8/5.0**

---

## Summary Table

| Slot | Trajectory | Decision | Continuation | Size | Fact/Inf | Anchor | Struct | Weighted |
|------|-----------|----------|-------------|------|----------|--------|--------|----------|
| 1 | 5 | 5 | 4 | 4 | 4 | 3 | 4 | **4.3** |
| 2 | 5 | 5 | 5 | 4 | 4 | 5 | 4 | **4.7** |
| 3 | 3 | 3 | 4 | 4 | 4 | 3 | 4 | **3.5** |
| 4 | 4 | 4 | 4 | 3 | 4 | 3 | 4 | **3.8** |

## Overall Assessment

- **Slot 2 is the strongest** (4.7) — excellent evidence anchoring, clear trajectory, actionable uncertainty.
- **Slot 3 is the weakest** (3.5) — weak evidence anchoring, vague test descriptions, missing specific file references.
- **Slots 1 and 4 are adequate** (4.3 and 3.8) but could benefit from tighter fact/inference separation and more specific file/path anchors.

## Recommended Fixes Before Proceeding

1. **Slot 3**: Add specific file paths for the extension code. Replace "Tests adapted" with the actual files changed and why.
2. **All slots**: Replace inference phrases ("became frustrated", "entered a loop") with observable metrics (correction count, query count, interruption count).
3. **Slot 4**: Add file paths for OpenSpec proposal and skill file. Clarify the distinction between "Outcome" and "Current State."