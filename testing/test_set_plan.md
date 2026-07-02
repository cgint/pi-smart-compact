# Proper Test Set — Plan

**Status:** Active work. Created 2026-07-02.

---

## Why this exists

Our current 3 test sessions are all identical: "user asked to read files → agent read files → produced output." No decisions, no failures, no multi-turn negotiation. This can't evaluate compaction quality — it only tests one narrow thing (resistance to decision inflation).

The rubric and evaluation apparatus are solid. The test data is broken. We need to replace the sessions before continuing.

---

## What's already built (don't rebuild)

| Artifact | Location | Status |
|---|---|---|
| Evaluation rubric (7 dimensions) | `testing/compaction_evaluation_rubric.md` | ✓ Done |
| Operational procedure | `testing/operational_evaluation_procedure.md` | ✓ Done |
| Scoring script | `testing/scripts/evaluate_scores.py` | ✓ Done |
| Gold standard structure | `testing/gold_standard/README.md` | ✓ Done |
| Compaction harness | `testing/compaction_test_harness.py` | ✓ Done |
| Session 20-23 scores | `testing/evaluation_session_20-23.md` | ✓ Done (but on broken test data) |

---

## What needs to happen

### Step 1: Source four new sessions (DONE)

Replaced all three broken sessions (identical "find *.md and read") with four diverse real sessions:

| Slot | Source Directory | Date | Users | Corrections | Tests |
|------|-----------------|------|-------|-------------|-------|
| 1 | `--Users-cgint-dev-external-pi-smart-compact--` | 2026-07-02 | 139 | 44 | **Decision accuracy** — heavy steering, constant redirections |
| 2 | `--Users-cgint-dev-web-scrape-meno--` | 2026-06-17 | 55 | 6 | **Trajectory fidelity** — debugging: parse errors, write failures, infinite loops |
| 3 | `--Users-cgint-dev-external-pi-discuss-mode--` | 2026-07-02 | 53 | 17 | **Negotiation/structuring** — extension scaffolding, skill loading, structural debates |
| 4 | `--Users-cgint-dev-web-scrape-meno--` | 2026-07-02 | 95 | 30 | **Deployment/infradebates** — OpenSpec, Cloud Run removal, time estimate pushback |

Each has distinct interaction patterns. Verified diversity via user message classification (questions, commands, corrections).

### Step 2: Verify diversity (DONE)

Confirmed each session has distinct characteristics:
- **Slot 1** (smart-compact): 139 msgs, 51 questions, 34 commands, 45 corrections — heavy steering
- **Slot 2** (web-scrape-debug): 55 msgs, 12 questions, 21 commands, 6 corrections — debugging spiral
- **Slot 3** (discuss-mode): 53 msgs, 14 questions, 13 commands, 17 corrections — structural negotiation
- **Slot 4** (web-scrape-deploy): 95 msgs, 23 questions, 36 commands, 30 corrections — infra debates

### Step 3: Copy sessions to testing/sessions/

Copy the 4 JSONL files from Pi session archives to `testing/sessions/` with descriptive filenames.

Source files:
- `~/.pi/profiles/partner/agent/sessions/--Users-cgint-dev-external-pi-smart-compact--/2026-07-02T09-19-17-266Z_019f2220-1b12-7840-8e2a-ccd677504cc2.jsonl`
- `~/.pi/profiles/partner/agent/sessions/--Users-cgint-dev-web-scrape-meno--/2026-06-17T09-34-51-137Z_019ed4ee-f701-711b-a75e-4c18ac398421.jsonl`
- `~/.pi/profiles/partner/agent/sessions/--Users-cgint-dev-external-pi-discuss-mode--/2026-07-02T09-03-52-705Z_019f2211-ff80-7165-bd99-14a5792a3033.jsonl`
- `~/.pi/profiles/partner/agent/sessions/--Users-cgint-dev-web-scrape-meno--/2026-07-02T10-11-03-886Z_019f224f-824e-7364-b1ca-ec6fea3a6f30.jsonl`

Remove the 3 old broken sessions from `testing/sessions/`.

### Step 4: Write gold standards (DONE)

Gold standards written for all 4 sessions:
- `testing/evaluation_slot_1-smart-compact-setup.md` — heavy steering, constant redirections
- `testing/evaluation_slot_2-web-scrape-debug.md` — debugging spiral, parse errors, infinite loops
- `testing/evaluation_slot_3-discuss-mode-extension.md` — structural negotiation, tri-state design
- `testing/evaluation_slot_4-web-scrape-deploy.md` — infra debates, OpenSpec refinement, critical requirements

### Step 5: Review gold standards (TODO — awaiting user review)

Before running the harness, review all 4 gold standards against the rubric to ensure they represent truly optimal compactions. Key concerns:
- Do they preserve decisions with rationale?
- Are uncertainties explicit?
- Is there any metadata bloat?
- Would dropping any field change next-step judgment?

### Step 6: Run harness

```bash
python3 testing/compaction_test_harness.py --sessions <session_ids>
```

Generates pi/smart/minimal compaction outputs.

### Step 7: Score

Follow `testing/operational_evaluation_procedure.md`. Save raw scores as JSON, run `scripts/evaluate_scores.py`, write evaluation report.

---

## Research context (why the rubric looks the way it does)

The 7 rubric dimensions come from:
- `findings/CONSOLIDATED_FINDINGS.md` — P/R/I preservation rules
- `concepts/compaction-principles.md` — 7 principles + failure modes
- `patterns/evidence-linked-traces.md` — fact/inference separation
- `patterns/handoff-context-brief.md` — authority/scope transfer
- `patterns/minimal-progress-capsule.md` — next-action continuity

Heavy-weight dimensions (2×): Trajectory Fidelity, Decision Accuracy, Continuation Sufficiency. These are the dimensions the current test set fails to exercise.

---

## Lessons from this iteration

- Mechanical rubric-mapping produces bloat. The rubric evaluates, it doesn't prescribe structure.
- Building apparatus on broken foundations is waste. Validate test data first.
- "If dropping a field would not change next-step judgment, it should not be in the active capsule." Applies to gold standards too.