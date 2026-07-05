# Behavioral Resumption — Option Comparison (Phase 02)

## Date

2026-07-05

## Conditions

| Condition | Description | Compaction chars |
|---|---|---|
| **smart** | Baseline (iteration 3) | 4288 |
| **smart_meta** | Original single-pass with concurrent meta-analysis rules | 7882 |
| **smart_b** | Option B: two-phase framing within single pass | 7357 |
| **smart_a** | Option A: true two-pass (operational → meta-analysis concatenated) | 8488 |

## Behavioral Responses

| Condition | Agent chose to... | Correct? |
|---|---|---|
| **smart** | Validate chat widget via agent-browser | ✅ Yes |
| **smart_meta** | Update README to remove Cloud Run refs | ❌ No (housekeeping drift) |
| **smart_b** | Verify chat response via curl | ✅ Yes (slightly different tool) |
| **smart_a** | Complete chat test via agent-browser | ✅ Yes (matches gold standard) |

## 5-Dimension Scores

| Dimension | smart | smart_meta | smart_b | smart_a |
|---|---|---|---|---|
| Goal Precision | 4 | 2 | 4 | 4 |
| State Fidelity | 4 | 2 | 4 | 4 |
| Action Specificity | 4 | 3 | 4 | **5** |
| Context Retention | 4 | 3 | 4 | 4 |
| Drift Resistance | 5 | 2 | 5 | 5 |
| **Total** | **22/25** | **12/25** | **21/25** | **22/25** |

### Scoring notes

- **smart_meta (12/25):** Catastrophic regression. The concurrent meta-analysis rules biased the compaction model toward closure — it declared the chat test "passed" when it was incomplete. The resumed agent inherited this wrong state and pivoted to README housekeeping.
- **smart_b (21/25):** Tail reading fixed (two-phase framing prevented closure bias). Meta-analysis present and high-quality. Lost 1 point on Action Specificity: used `curl` instead of `agent-browser` (correct goal, slightly different tool).
- **smart_a (22/25):** Tail reading preserved (pass 1 untouched). Meta-analysis high-quality (pass 2 independent). Action Specificity 5: used `agent-browser` matching gold standard exactly. Ties smart baseline.

## Diagnosis

### Root cause of smart_meta failure

The meta-analysis rules (rules 13-15) were present in the system prompt alongside the operational rules. The model optimized for "producing a good meta-analysis" which incentivized a coherent, defensible narrative. Coherence favors closure over ambiguity. The session tail was ambiguous (screenshot saved, not read). The model resolved the ambiguity in favor of closure — declaring the test "passed" — because that made the meta-analysis easier to write.

**The meta-analysis goals contaminated the operational reading.**

### Why Option B partially works

Explicitly separating "Phase 1: operational" from "Phase 2: review your own output" reduced the contamination. The model read the tail correctly. But it still scores 21/25 (lost 1 on Action Specificity — chose `curl` over `agent-browser`). The two-phase framing helped but didn't fully isolate the concerns.

### Why Option A ties the baseline

True separation: pass 1 generates the operational summary with the proven smart prompt (unchanged). Pass 2 receives the operational summary and generates only the integrity check. Zero contamination. The operational output is identical to what smart would produce. Meta-analysis is a bonus layer on top.

**Option A = smart (22/25) + meta-analysis (free bonus, no contamination).**

## Recommendation

**Option A (two-pass) is the winner.** It preserves the proven operational quality while adding the meta-analysis layer as a clean bonus. The cost is one additional model call (~600 tokens of meta output), but the behavioral quality is guaranteed.

Option B is acceptable (21/25, no regression) but slightly weaker on action specificity. It's cheaper (one call) if the cost of a second call is prohibitive.

smart_meta (original single-pass) is **rejected** — the contamination effect is unacceptable.

## Next Steps

- [ ] Run Option A on all 4 slots to verify generalization\n- [ ] Measure if the meta-analysis from Option A provides measurable value to the resumed agent beyond the operational summary\n- [ ] Evaluate whether the second model call cost is acceptable in production\n