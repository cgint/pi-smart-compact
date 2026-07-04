# Prove compaction quality through behavioral evidence

## Why

### Summary

Our current rubric evaluation (smart 4.26 vs pi 3.87) measures document quality — structure, decisions, anchoring — not whether the compaction actually helps a resumed agent stay aligned to the goal. We risk optimizing for cosmetic rubric gains rather than behavioral utility.

### Original user request (verbatim)

> i want you to bake the concept into one or more openspec changes

### The problem

The rubric gap (0.39 on a 1–5 scale) is modest. On 46% of dimension-slot pairs, scores are identical. Even if the gap were larger, we have no evidence that higher rubric scores translate to better agent behavior after resumption. As compaction-principles Principle 7 warns: *"Measure compaction by usefulness, not compression ratio alone."*

### The value

A behavioral resumption pilot establishes whether compaction differences are real or cosmetic. If pi and smart produce identical agent behavior, the rubric gap is behaviorally inert — and we must rethink our compaction strategy. If smart demonstrably helps the agent take better next actions, we gain confidence to iterate on the prompt.

Reference: `concepts/behavioral-resumption-experiment.md`

## What Changes

- **New:** Standalone Python script (`testing/resumption_pilot.py`) that feeds each compaction to the model endpoint (sparky:8001) and captures the agent's first turn (stated goal + first tool call)
- **New:** Pilot execution against Slot 2 (web-scrape-meno) with three conditions: pi compaction, smart compaction, control (no compaction)
- **New:** Results document (`testing/behavioral_resumption_pilot.md`) recording raw outputs, binary metric scores, and conclusion

## Capabilities

### New Capabilities

- `resumption-runner`: Script that sends a compaction summary through the model endpoint with a neutral resumption prompt, captures the first turn output, and records it for scoring

### Modified Capabilities

*(none — this is a new evaluation capability, not a modification to existing compaction strategies)*

## Impact

- **Affected files:**
  - `testing/resumption_pilot.py` (new)
  - `testing/behavioral_resumption_pilot.md` (new, results)
  - `testing/compaction_results/--Users-cgint-dev-web-scrape-meno--/summary_pi.txt` (input, read-only)
  - `testing/compaction_results/--Users-cgint-dev-web-scrape-meno--/summary_smart.txt` (input, read-only)
  - `testing/gold_standard/session_slot2-web-scrape-debug_optimal.md` (scoring reference, read-only)
- **External dependency:** Model endpoint `sparky:8001` (qwen36-35b-nvidia-nvfp4) — must be reachable
- **No impact on compaction strategies themselves** — this is pure evaluation infrastructure