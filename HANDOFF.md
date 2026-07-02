# Handoff — pi-smart-compact

## Status

The initial compaction knowledge base is complete and auditor-approved. A new agent can continue from this directory without rereading the whole prior session.

## Start here

1. Read `README.md` for the map.
2. Read `NORTH-STAR.md` for the original user intent.
3. Read `status/coverage.md` for what is covered, partial, and intentionally not exhaustive.
4. Use `sources/research-map.md` to jump back to exact source documents.

## Current artifact map

- `README.md` — navigation and core thesis.
- `NORTH-STAR.md` — user briefing and guiding objective.
- `sources/research-map.md` — inspected source inventory and synthesis targets.
- `concepts/compaction-principles.md` — smart compaction rules and failure modes.
- `concepts/context-pointers.md` — externalized-detail/context-pointer strategy.
- `concepts/budget-and-storage-aware-compaction.md` — token/cost/session-storage implications.
- `patterns/minimal-progress-capsule.md` — compact continuity capsule.
- `patterns/evidence-linked-traces.md` — fact/inference/evidence split for reviewable compaction.
- `patterns/handoff-context-brief.md` — compact handoff pattern for agent/subagent continuation.
- `status/coverage.md` — coverage, gaps, and next research slices.

## Key design thesis

Smart compaction is not merely shortening text. It is a representation discipline: keep the smallest active state that supports the next reliable decision, and externalize lower-priority detail behind precise file pointers.

## Best next research slices

Recommended order:

1. Inspect `../../decision-context-traces/data/trace-v2/README.md` and representative `representation_metrics.md` artifacts for exact compaction/reviewability metrics.
2. Inspect implementation code for minimal context packs, trace schemas, and Pi session builders if moving from concept notes toward executable compaction.
3. Inspect coordinator playground run records directly if measured handoff compaction becomes central.
4. Read original papers only when a specific design question requires deeper theoretical grounding.

## Constraints to preserve

- Do not duplicate detailed source content here; synthesize and reference precise source paths.
- Keep notes compact and agent-usable.
- Preserve uncertainty explicitly.
- Prefer relative paths to source evidence.
- Keep active context focused on overview, next action, blockers, and context pointers.

## Verification already done

- The directory contains the expected knowledge-base structure.
- Representative relative source paths from `sources/`, `concepts/`, `patterns/`, and `status/` were checked and resolved.
- Independent auditor approved the completion claim.

## Clean-session prompt suggestion

If another agent continues, start with:

> Read `pi-smart-compact/HANDOFF.md`, then `README.md`, `status/coverage.md`, and `sources/research-map.md`. Continue the next research slice without duplicating source material; add compact synthesis with exact source pointers.
