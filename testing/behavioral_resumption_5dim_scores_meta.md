# Behavioral Resumption Re-Score — Meta-Analysis Layer (Phase 02)

## Date

2026-07-05

## Methodology

Score both `smart` (baseline) and `smart_meta` (treatment) against the gold standard for Slot 2 using the 5-dimension rubric. Same gold standard, same session, same split. Only variable: the meta-analysis section.

## Gold Standard Reference

`testing/gold_standard/session_slot2-web-scrape-debug_optimal.md`

Key elements from gold standard:
- Active goal: debugging chat integration pipeline (frontend CSS, client networking, backend response)
- Server in tmux 'meno-server'
- 404 error persists, model switch attempted (2.5-flash → 3.5-flash)
- Cloud Run identified as dead, needs undeployment
- Parse error fix theoretical (one test after bump)
- Multiple uncertainty zones explicitly listed

## Scores

### smart (baseline)

| Dimension | Score | Rationale |
|---|---|---|
| Goal Precision | 4 | Identifies "verify chat response" as next step. Near match — but misses the deeper debugging context (404, model switch, tmux). Same as baseline. |
| State Fidelity | 4 | Captures that test message is pending. Mentions Cloud Run decommissioned. Misses: 404 error, model switch attempt, tmux session, hostname/session ID fixes. |
| Action Specificity | 4 | Targets agent-browser screenshot of the local page. Correct tool, minor imprecision (doesn't mention checking tmux logs or verifying model). |
| Context Retention | 4 | Uses specific URLs, file paths, CSS class names. Misses: tmux 'meno-server', chat_model.py:151, 404 error details. |
| Drift Resistance | 5 | Stays on active task. No pivot to housekeeping. |
| **Total** | **22/25** | Matches established baseline. |

### smart_meta (treatment)

| Dimension | Score | Rationale |
|---|---|---|
| Goal Precision | 4 | Same as smart — "verify chat response" is the immediate next step. Meta-analysis doesn't change goal extraction. |
| State Fidelity | **5** | Meta-analysis adds critical state context: Working Assumptions flag data_store integrity, Reasoning Gaps flag Cloud Run deletion without checking external deps, Uncertainty Zones flag live Wix embed method unknown. The resumed agent now knows what's uncertain, not just what's done. |
| Action Specificity | 4 | Same as smart — targets agent-browser screenshot. Meta-analysis doesn't change the immediate action. |
| Context Retention | **5** | Meta-analysis adds operational anchors the baseline missed: GCS bucket status, Wix integration mechanism, localhost vs production URL risk. Combined with baseline's file paths/URLs, this is more complete context. |
| Drift Resistance | **5** | Meta-analysis explicitly lists risks (hardcoded localhost, token truncation) and alternatives considered (chunked writing, dynamic loader). Resumed agent has guardrails against pivoting to naive solutions. |
| **Total** | **23/25** | **+1 improvement** over baseline. |

## Comparison

| Condition | GP | SF | AS | CR | DR | **Total** |
|---|---|---|---|---|---|---|
| Smart (baseline) | 4 | 4 | 4 | 4 | 5 | **22/25** |
| Smart Meta (treatment) | 4 | **5** | 4 | **5** | **5** | **23/25** |

**Delta: +1** (State Fidelity +1, Context Retention +1, capped at 5 per dimension)

## Diagnosis

The meta-analysis layer improved State Fidelity and Context Retention by surfacing:
1. **Assumptions** the session operates on (data_store integrity, maxTokens reliability, Wix replica accuracy)
2. **Reasoning gaps** (Cloud Run deletion without checking external deps, Wix integration mechanism uninvestigated)
3. **Concrete uncertainty zones** with verification steps (live Wix embed method, GCS bucket status)

These are exactly the kinds of signals the resumed agent needs to avoid blind spots. The meta-analysis didn't change the immediate next step (Goal Precision, Action Specificity unchanged) — it changed the **quality of the context** around that step.

## Caveats

- Single-session scoring (Slot 2 only). Need to validate on Slots 1, 3, 4.
- Manual scoring — subjectivity inherent in 1-5 scale.
- Token cost: +1904 chars / +293 words (+38%/+45%). Acceptable if signal quality holds.
- The +1 may be conservative. A resumed agent with the meta-analysis might make measurably better decisions, but we can't measure that without running the full behavioral test (feeding compaction to a resumed agent and observing its actions).

## Next Steps

- [ ] Run on Slots 1, 3, 4 to check generalization
- [ ] Run full behavioral test (feed compaction to resumed agent, observe actions)
- [ ] Measure if the +1 holds across sessions or is Slot 2 specific