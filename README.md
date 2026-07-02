# pi-smart-compact

## Status

Initial compaction knowledge base created. It captures high-signal, source-referenced learnings for smart context compaction in Pi-based agentic harnesses.

## Purpose

Help an agent keep the active context small, clear, and decision-relevant while preserving retrievable detail on disk through precise context pointers.

This is not a replacement for the source repositories. It is a compact synthesis layer that points back to source evidence.

## Map

- `NORTH-STAR.md` — user briefing and guiding objective.
- `sources/research-map.md` — inspected source inventory and coverage.
- `concepts/compaction-principles.md` — principles for smart compaction versus naive summarization.
- `concepts/context-pointers.md` — externalized-detail strategy and retrieval pointers.
- `concepts/budget-and-storage-aware-compaction.md` — token/cost/session-storage implications.
- `patterns/minimal-progress-capsule.md` — compact continuity capsule for session progress.
- `patterns/evidence-linked-traces.md` — trace/evidence pattern for reviewable compaction.
- `patterns/handoff-context-brief.md` — compact handoff package for subagents or resumed sessions.
- `status/coverage.md` — current coverage, partial areas, and next research targets.

## Working model

Smart compaction should keep only the facts needed for the next reliable decision in active context, while preserving:

- source provenance;
- richer supporting detail in files;
- explicit uncertainty;
- links to evidence and review artifacts;
- enough state to resume work without rereading full transcripts.

## Core thesis

Compaction is not just shortening text. Good compaction is a **representation discipline**: preserve the smallest state that still supports correct next-step judgment, with precise pointers to recover omitted detail.

## First-slice source basis

This initial version is derived from targeted reads of:

### Local Pi repos (under `../concepts/pi-*`)
- `../pi-sessions-replace-driver/AGENTS.md`
- `../pi-sessions-replace-driver/work/session-signal-system.md`
- `../pi-self-reflect/docs/steering-feedback-tree-check.md`
- `../pi-supervisor-guide/SCENARIO_NOTES.md`
- `../pi-subagent-coordinator/agent/delegation-handoff-research.md`
- `../pi-subagent-coordinator/agent/coordinator-strategy-experiment-003-results.md`
- `../pi-extension-environment/pi-extension-diesel-km-brief.md`
- `../pi-coding-agent-container-ui-git/docs/research.md`
- `../pi-ai-consortium/README.md`
- `../pi-gui/notes/pi-gui-options-constraints-next-steps.md`
- `../pi-ntfy-collaboration/docs/pi-ntfy-bridge-plan.md`

### Decision-context repos (adjacent under `/Users/cgint/dev/`)
- `../../decision-context-traces/CURRENT_STATE.md`
- `../../decision-context-traces/README.md`
- `../../decision-context-traces/agent/docs-papers-map.md`
- `../../decision-context-agent/README.md`

See `sources/research-map.md` for coverage status and synthesis targets.
