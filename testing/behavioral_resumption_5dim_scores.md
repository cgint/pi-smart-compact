# Behavioral Resumption Re-Score — 5-Dimension Rubric

## Date

2026-07-04

## Results

| Condition | Goal Precision | State Fidelity | Action Specificity | Context Retention | Drift Resistance | **Total** |
|---|---|---|---|---|---|---|
| **Control** | 1 | 1 | 1 | 1 | 1 | **5/25** |
| **Pi** | 4 | 3 | 3 | 3 | 5 | **18/25** |
| **Smart (iter 3)** | 4 | 4 | 4 | 4 | 5 | **22/25** |

## Key Finding

With the finer-grained rubric, **smart now leads pi** (22 vs 18). The 4-point gap comes from:
- **State Fidelity:** Smart (4) > Pi (3) — smart's "Last Session Activity" gives more specific context about what was unfinished
- **Action Specificity:** Smart (4) > Pi (3) — smart targets the browser/chat window specifically, pi generically says "check logs"
- **Context Retention:** Smart (4) > Pi (3) — smart uses the specific test page URL, pi references a temp screenshot path

Both share the same Goal Precision (4) and Drift Resistance (5).

## Comparison with Binary Rubric

| Condition | Binary (old) | 5-Dimension (new) | Shift |
|---|---|---|---|
| Control | 0/3 | 5/25 | — |
| Pi | 3/3 | 18/25 | Was "perfect" but now shows room for improvement |
| Smart (orig) | 1/3 | n/a | Was worse than pi |
| Smart (iter 3) | 3/3 | 22/25 | Was equal to pi, now **leads** pi |

The binary rubric was too coarse — it showed parity (3/3 each). The 5-dimension rubric reveals smart actually outperforms pi on state fidelity, action specificity, and context retention.

## Iteration 4 (Round 2: Push Beyond 22/25)

| Condition | Goal Precision | State Fidelity | Action Specificity | Context Retention | Drift Resistance | **Total** |
|---|---|---|---|---|---|---|
| **Smart (iter 4)** | 4 | 4 | 4 | 4 | 5 | **22/25** |

Identical to iteration 3. Rules 11-12 demanded specific error details (HTTP codes, tracebacks, tmux names) but the compaction model cannot extract details from the remaining 30% of the session that it cannot see.

**Structural ceiling confirmed:** The debugging tail (404, `chat_model.py:151`, tmux 'meno-server') is after the 70% split point. `conversation.txt` has 4 mentions of debugging terms; `remaining.txt` has 28. The compaction cannot capture what it cannot see.

## Caveats

- Single-session scoring (Slot 2 only). Multi-session validation needed.
- Manual scoring — subjectivity inherent in 1-5 scale (anchors help but don't eliminate it).
- Both strategies still score 4 (not 5) on Goal Precision — neither captures the full debugging depth (404, tmux, `chat_model.py:151`).
- The 70% split point creates a structural ceiling for sessions where the debugging tail is after the split.