# Behavioral Resumption Pilot — Smart Prompt Optimization Log

## Date

2026-07-04

## Baseline Results (Iteration 0)

| Condition | Goal Preservation | State Awareness | First Action Precision | Total |
|---|---|---|---|---|
| **Control** | FAIL | FAIL | FAIL | 0/3 |
| **Pi** | PASS | PASS | PASS | 3/3 |
| **Smart (original)** | FAIL | PASS | FAIL | 1/3 |

## Iteration 1: Structural Separation

**Diagnosis:** Smart compaction's "Next Steps" listed post-session housekeeping (GCP cleanup) as #1, overshadowing active debugging work. "Current State" described the backend as having "full functionality" when it was actually unconfirmed.

**Prompt change:** Added rules 7-8 to distinguish active vs completed work. Restructured output format: split "Next Steps" into "Immediate Next Step" and "Later Tasks", added "What Is Unfinished" section.

**Result:** Agent still picked "Update README" as the goal (1/3 → still FAIL on Goal Preservation and First Action Precision). Structure changed but content was wrong — the compaction model still misidentified what was immediately next.

## Iteration 2: Anchor to Last Exchanges

**Diagnosis:** The compaction model summarizes the session holistically, ignoring the tail. Rules about "immediate next step" weren't specific enough — the model still defaulted to strategic priorities over session-ending activity.

**Prompt change:** Rewrote rule 8 to explicitly anchor "Immediate Next Step" to the *last exchanges* in the session. Added rule 9: do not infer completion from partial success.

**Result:** Agent picked "finalize widget integration / commit CSS fixes" (still wrong — not the backend debugging). The compaction still described the backend as "fully functional" and the immediate next step as committing CSS changes.

## Iteration 3: Dedicated "Last Session Activity" Section

**Diagnosis:** The compaction model needs a dedicated section to force it to describe the last exchanges concretely. Without a specific output slot, it defaults to holistic summarization.

**Prompt change:** Added rule 10: include a "## Last Session Activity" section describing the last 5-10 exchanges concretely (errors seen, commands run, what was being investigated). Moved this section early in the output format (right after "What Was Done").

**Result:**
| Condition | Goal Preservation | State Awareness | First Action Precision | Total |
|---|---|---|---|---|
| **Smart (iter 3)** | **PASS** | **PASS** | **PASS** | **3/3** |

Agent correctly identified the active goal: "verify AI response to test message sent in last browser interaction." First action was taking a screenshot of the chat window to check for the response — functionally equivalent to the gold standard's debugging direction.

## Stopping Criteria Met

Smart ≥ pi on all 3 metrics (3/3 vs 3/3). Optimization complete after 3 iterations.

## Final Prompt Changes (Diff Summary)

Added to smart prompt rules:
- Rule 7: Distinguish active work from completed work
- Rule 8: Derive next step from last exchanges
- Rule 9: Do not infer completion from partial success
- Rule 10: Include "Last Session Activity" section

Restructured output format:
- `## What Is Unfinished` (new)
- `## Last Session Activity` (new, placed early)
- `## Immediate Next Step` (renamed from "Next Steps")
- `## Later Tasks` (new, for post-session housekeeping)
- `## Current State` updated to include unresolved issues/errors

## Caveats

- Tested on Slot 2 only (web-scrape-meno). Multi-session validation needed to confirm generalization.
- The compaction still misses some debugging depth (404 errors, tmux logs, `chat_model.py:151` were not captured in "Last Session Activity"). Further refinement may be needed for sessions with deeper debugging tails.
- The improvement is session-dependent — a session that ends cleanly may not benefit from the "Last Session Activity" section.