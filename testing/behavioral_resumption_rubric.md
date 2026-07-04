# Behavioral Resumption Rubric (1–5 Scale)

## Purpose

Complements the binary Pass/Fail metrics with finer-grained scoring. Answers "how well did it work?" not just "did it work?"

## Dimensions

### 1. Goal Precision (1–5)

How closely does the stated goal match the gold standard's active objective?

| Score | Anchor |
|---|---|
| 5 | Exact match — agent states the same goal as gold standard |
| 4 | Near match — minor framing difference but same core objective |
| 3 | Functionally equivalent — different wording but same action domain |
| 2 | Partial overlap — agent identifies a related but not primary goal |
| 1 | Wrong direction — agent pursues an unrelated or completed task |

### 2. State Fidelity (1–5)

How accurately does the agent reflect the *unfinished* state of the session?

| Score | Anchor |
|---|---|
| 5 | Captures specific unresolved errors, blockers, uncertainties from gold standard |
| 4 | Knows work is incomplete and mentions the right domain (e.g., "backend not confirmed") |
| 3 | Knows work is incomplete but vague about specifics |
| 2 | Thinks most work is done, misses key unresolved issues |
| 1 | Believes everything is complete — no awareness of unfinished work |

### 3. Action Specificity (1–5)

How precise is the first tool call or command?

| Score | Anchor |
|---|---|
| 5 | Exact command/tool that directly advances the active goal |
| 4 | Correct tool with minor imprecision (e.g., right file but wrong line) |
| 3 | Right category of action (e.g., "check logs" vs. "tail tmux logs") |
| 2 | Vague action that could advance the goal but needs clarification |
| 1 | Unrelated action or asks user for input instead of acting |

### 4. Context Retention (1–5)

How many key contextual anchors does the agent retain/use from the session?

| Score | Anchor |
|---|---|
| 5 | Uses specific anchors: exact file paths, error codes, session IDs, URLs |
| 4 | Uses several anchors but misses some specifics |
| 3 | References general context (e.g., "the backend" without URL/path) |
| 2 | Minimal context — relies on generic descriptions |
| 1 | No session context — treats it as a fresh task |

### 5. Drift Resistance (1–5)

Does the agent stay on the active task without pivoting to housekeeping?

| Score | Anchor |
|---|---|
| 5 | Stays on active task throughout — no pivot to unrelated work |
| 4 | Brief mention of other tasks but stays focused |
| 3 | Pivots once but the first action is still correct |
| 2 | Pivots to housekeeping/documentation as the primary action |
| 1 | Immediately abandons active task for unrelated work |

## Scoring Notes

- Score each dimension independently. A response can be 5 on Goal Precision but 2 on Context Retention.
- Use the gold standard as the reference for "correct" goal, state, and action.
- When in doubt between two scores, round down (conservative scoring).