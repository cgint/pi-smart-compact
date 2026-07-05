# Coverage status

## Status

Initial research pass complete enough to provide a coherent compaction knowledge base. Coverage is broad but not exhaustive across all local repositories.

## Covered in this pass

| Area | Evidence | Result |
|---|---|---|
| North star and briefing | `../NORTH-STAR.md` | User objective and externalized-reference idea captured. |
| Session-signal/minimal progress | `../../pi-sessions-replace-driver/AGENTS.md`; `../../pi-sessions-replace-driver/work/session-signal-system.md` | Captured minimal high-signal intervention policy and minimal progress capsule. |
| Out-of-band reflection/session tree | `../../pi-self-reflect/docs/steering-feedback-tree-check.md` | Captured separation between background reflection, active session leaf, branch summaries, and sidecar isolation. |
| Supervisor trace/judge compaction | `../../pi-supervisor-guide/SCENARIO_NOTES.md` | Captured compact trace facts, evidence IDs, judge input, and heuristic caveats. |
| Decision-context trace representation | `../../../decision-context-traces/CURRENT_STATE.md`; `../../../decision-context-traces/agent/docs-papers-map.md`; `../../../decision-context-traces/README.md` | Captured ContextTrace/DecisionTrace, representation-before-optimization, risks, minimal context packs, and pattern lift framing. |
| Decision-context agent framing | `../../../decision-context-agent/README.md` | Captured emergent schema and event → reasoning → pattern synthesis pipeline. |
| Subagent handoff compaction | `../../pi-subagent-coordinator/agent/delegation-handoff-research.md`; `../../pi-subagent-coordinator/agent/coordinator-strategy-experiment-003-results.md`; `../../pi-subagent-coordinator/agent/coverage.md` | Captured handoff brief, Verification Tax, confidence/comprehension checks, routing, and measured token/cost tradeoff. |
| Budget/session-storage implications | `../../pi-extension-environment/pi-extension-diesel-km-brief.md`; `../../pi-coding-agent-container-ui-git/docs/research.md`; `../../pi-ai-consortium/README.md` | Captured token estimation caveats, per-task session persistence, and throttle/trigger need for expensive side channels. |
| Peripheral session UX/control | `../../pi-gui/notes/pi-gui-options-constraints-next-steps.md`; `../../pi-ntfy-collaboration/docs/pi-ntfy-bridge-plan.md` | Sampled UI parity/session persistence and cross-host status/control patterns; not core compaction yet. |

## Created artifacts

- `../README.md`
- `../sources/research-map.md`
- `../concepts/compaction-principles.md`
- `../concepts/context-pointers.md`
- `../patterns/minimal-progress-capsule.md`
- `../patterns/evidence-linked-traces.md`
- `../patterns/handoff-context-brief.md`
- `../concepts/budget-and-storage-aware-compaction.md`
- `../status/coverage.md`

## Partially covered / not yet covered

| Area | Status | Why it matters |
|---|---|---|
| `../../pi-subagent-coordinator-playgrounds` | Referenced only | Coordinator docs point to run records, dashboards, and validation logs; direct artifact inspection remains future work. |
| Source code implementations | Not covered | This slice is documentation-first; code may reveal exact schemas and APIs later. |
| Original papers | Indirect only | Paper themes were taken from `../../../decision-context-traces/agent/docs-papers-map.md`; original PDFs were not read in this slice. |
| Full repo exhaustive coverage | Not complete | Main/high-yield docs were sampled; not every Markdown file or code path was inspected. |

## Quality assessment

Strengths:

- The first slice is source-referenced and avoids copying large source content.
- It identifies three concrete reusable patterns: minimal progress capsule, evidence-linked traces, and handoff context brief.
- It preserves the user-requested externalized-detail strategy.
- It distinguishes observed facts, inferred cognition, compact active state, and retrievable detail.

Weak spots:

- Coverage is documentation-heavy; source code schemas and actual runtime artifacts were not yet inspected.
- Coverage remains documentation-heavy; implementation schemas and runtime artifacts were not deeply inspected.
- Paper references are currently second-order through `docs-papers-map.md`; original papers were not read in this slice.
- Some peripheral repositories were sampled for relevance rather than exhaustively digested.
- No automated link checker has been added; representative path existence was verified with shell checks.

## Recommended next research slices

1. Inspect `../../../decision-context-traces/data/trace-v2/README.md` and representative `representation_metrics.md` artifacts for exact compaction/reviewability metrics.
2. Inspect implementation code for minimal context packs, trace schemas, and Pi session builders if moving from concept notes toward executable compaction.
3. Inspect coordinator playground run records directly if measured handoff compaction becomes central.
4. Read original papers only when a specific design question requires deeper theoretical grounding.

## Completion note for current goal

This file records initial coverage, not final exhaustive coverage. The knowledge base currently satisfies the first coherent slice of the objective, but more repositories remain available for deeper research.
