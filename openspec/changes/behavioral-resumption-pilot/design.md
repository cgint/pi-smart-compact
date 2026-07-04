## Context

We need to test whether compaction outputs actually help resumed agents. The current rubric (document quality) doesn't measure behavioral utility. The pilot uses Slot 2 (web-scrape-meno) with three conditions: pi compaction, smart compaction, and control (no compaction). Each condition feeds a compaction summary to a fresh agent via the model endpoint (sparky:8001, qwen36-35b-nvidia-nvfp4) and captures the first turn.

Existing infrastructure: `testing/compaction_test_harness.py` (makes HTTP calls to sparky), gold standards in `testing/gold_standard/`, compaction outputs in `testing/compaction_results/`.

## Goals / Non-Goals

**Goals:**
- Run three-condition pilot (pi, smart, control) against Slot 2
- Capture each agent's first turn (stated goal + first tool call)
- Score three binary metrics (Goal Preservation, State Awareness, First Action Precision)
- Produce `testing/behavioral_resumption_pilot.md` with results and conclusion

**Non-Goals:**
- Multi-session validation (future work)
- Automated harness for all sessions (future work)
- TypeScript test integration (future work, after pilot proves method)
- Modifying compaction strategies themselves

## Decisions

**Python over TypeScript for the pilot script**
- Rationale: existing harness (`compaction_test_harness.py`) already has HTTP call patterns to sparky; faster to reuse than build TS equivalent
- Alternative considered: TypeScript test — deferred until pilot validates the method

**Minimal script, not full framework**
- Rationale: concept says "keep manual to verify the method"; we don't know if the metrics discriminate yet
- The script just sends 3 HTTP requests and saves outputs; scoring is manual

**Neutral resumption prompt**
- Rationale: avoid teaching the model how to interpret the compaction; use identical prompt across all conditions
- Prompt: "You are a resumed agent. Below is the compaction summary..." (see concept for exact wording)

**Control condition (no compaction)**
- Rationale: advisor-recommended baseline to detect workspace state leakage
- If control ≈ smart, the workspace itself contains enough cues, making the experiment invalid

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Model non-determinism (same input → different output) | Run each condition once; accept variability. If results are inconclusive, repeat. |
| Workspace state leakage (files reveal session state) | Checkout to exact git commit at compaction point before running |
| sparky:8001 unavailable | Pilot blocked; requires model endpoint to be up |
| Compaction input truncated by token limit | Verify input length < model max (32768 tokens); all compactions are <10K chars |
| Metrics don't discriminate (all pass or all fail) | Documents the finding; informs whether to rethink the experiment or the compaction strategy |