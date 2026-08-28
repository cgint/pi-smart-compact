# 08 — First parcour: turn-reduce ON failed the task and cost 63% more

> Measured 2026-08-13, campaign `p01-20260813`, fixture `codebase-inventory`.
> **n=1 per arm.** Runs kept at `/tmp/parcour-p01-20260813-{off,on}-r1-codebase-inventory/`.
> Historical command: `eval/parcour.sh <campaign> codebase-inventory 1` →
> `eval/inspect.py <campaign>`. It cannot reproduce ON from the current unwired prototype.

## Result

| | OFF | ON | delta |
| --- | --- | --- | --- |
| **final answer** | 10,882 chars, 31 file references | **empty** | task not delivered |
| assistant turns | 7 | 15 | +114% |
| tool results | 11 | 26 | +136% |
| tool errors | 0 | 0 | — |
| **cost** | 0.1081 | **0.1760** | **+63%** |
| total billed tokens | 102,254 | 114,668 | +12% |
| **cacheRead** | **48,896** | **0** | **−100%** |
| cacheWrite | 0 | 0 | — |
| peak single-request input | 13,929 | 12,503 | −10% |

Per-request context was cut hard and consistently — `−49%`, `−56%`, `−67%`, `−69%`,
`−75%`, `−77%`, `−79%` — across 14 reductions of 71–98% each (largest: a `read` of 18,316
chars reduced to 450). By the metric this feature was originally judged on, it worked
perfectly. **It still cost more and produced nothing.**

The ON arm ended with an assistant message carrying `stopReason: "stop"` and no text,
after three consecutive `grep` calls returning `No matches found`. The OFF arm answered
the same prompt in 7 turns.

## The mechanism: write-once per *message* is not write-once per *prefix*

`cacheRead` went from 48,896 to **zero**. That is not a behavioural fluctuation — it is
the predicted failure, and the proposal predicted it in its own words:

> Recomputing on every request would rewrite the prefix each turn and destroy provider
> prefix caching, turning a cost saving into a cost increase.

Decision 2 answers that with write-once caching, and the cache *works* — each message is
reduced once and reused byte-identically. **The rationale still fails**, because the
guarantee is per message and the damage is per prefix:

- 14 reductions across 15 turns — with `afterN=1`, roughly **one newly-reduced message per
  turn**.
- Each reduction edits a message sitting in the *middle* of the history.
- Everything after that point shifts, so the cacheable prefix is invalidated from there.

So the prefix is rewritten nearly every turn regardless of the cache. Decision 2's
reasoning only holds in the limit where no *new* reductions occur — a state `afterN=1`
never reaches. **Raising `afterN` does not fix this**; it only reduces how often the
invalidation happens, and with it the entire claimed benefit.

## It reproduces the external precedent

`~/dev/concepts/deliberate-agent/docs/cross-domain-comparison.md` §4, from 2,848 analysed
provider-billed runs:

> cache traffic was ~87% of cost, an arm that removed **38% of raw tool-output tokens cost
> 6.8% more**… and aggressive compression cut successful patch application from **27/40 to
> 15/40**.

Here: ~77% of context removed, **63% more cost**, and the deliverable lost entirely. Same
direction, larger magnitude, on our own code. That result was recorded as "the result to
try hardest to reproduce" (`EVALUATION.md` §10) before this run. It reproduced.

## What is and is not established

**Established (mechanical, does not depend on the agent's choices):**

- Prefix caching does not survive turn-level reduction at `afterN=1`. `cacheRead = 0` is a
  direct consequence of the design, and it is the dominant cost term.
- The `−77% context` figure is real and simultaneously worthless as a benefit signal —
  the demonstration that percent-reduced is Goodhart's law with a progress bar.

**Not established (n=1, and agent runs are nondeterministic):**

- That ON *always* fails this task. One run, one seed. The turn count, the tool-call count
  and the empty answer are anecdote until repeated.
- The causal path from reduction to failure. The trailing "No matches found" greps are
  consistent with the agent having lost content it had already read, but consistent-with
  is not shown.

**Cheapest next step if anyone wants certainty:** `r2` and `r3` of the same fixture. The
cacheRead finding should hold every time, because it is structural; the behavioural
findings may not.

## Consequence

This strengthens the parking decision (`openspec/changes/keep-sessions-focused-between-turns/`
§10) with local evidence rather than borrowed evidence. It also retires the idea that
`afterN` is a tuning knob that could rescue the approach: the cache invalidation is caused
by reduction happening *at all* inside a growing prefix, not by its frequency.

It does not touch the branch-point direction (D51), where reduction happens once, at a
boundary, before the prefix exists.
