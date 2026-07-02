# Plan — Next Research Slices

## Status
Draft 2026-07-02. Pending path verification before execution.

## Proposed order

1. **Inspect trace-v2 metrics** — `../../../decision-context-traces/data/trace-v2/README.md` + `representation_metrics.md` files
   Goal: Extract exact compaction/reviewability numbers to validate principles with hard data.

2. **Inspect implementation code** — Search for minimal context pack schemas, trace schemas, Pi session builders in referenced repos.
   Goal: Bridge from concept notes to executable reality.

3. **Inspect coordinator playground run records** — `pi-subagent-coordinator-playgrounds` run artifacts.
   Goal: Validate measured handoff compaction results.

4. **Synthesize findings** — Update `status/coverage.md` and relevant concept/pattern files.
   Goal: Close gaps with new evidence.

## Pre-flight check
- Verify all relative paths resolve from repo root before starting.
- Check read permissions on each target.

## Risks
- Paths may be stale (repos moved/renamed).
- Some repos may be sparse or read-only.
- Step 2 scope is broad; may need narrowing.