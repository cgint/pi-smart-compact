# Research map

## Status

Initial source map for compaction-relevant material. Coverage is intentionally focused: it records what was inspected and what was extracted, not a full repository inventory.

## Coverage table

| Source | Status | Key concepts extracted | Target notes |
|---|---|---|---|
| `../../pi-sessions-replace-driver/AGENTS.md` | Covered initial | Driver-copilot north star; minimal high-signal interventions; durable file-based memory; context as control flow, files as knowledge store. | `../concepts/compaction-principles.md`, `../patterns/minimal-progress-capsule.md` |
| `../../pi-sessions-replace-driver/work/session-signal-system.md` | Covered initial | JSONL session watching; compact contract checking; async verifier cadence; six verifier angles; `minimal_progress_context`; artifact-rich/out-of-band detail with tiny in-band interventions. | `../patterns/minimal-progress-capsule.md`, `../concepts/context-pointers.md` |
| `../../pi-self-reflect/docs/steering-feedback-tree-check.md` | Covered initial | Pi `/tree` as prior art; branch summaries; context rebuild; out-of-band reflection; avoid polluting active session leaf; sidecar session isolation. | `../concepts/context-pointers.md`, `../concepts/compaction-principles.md` |
| `../../pi-supervisor-guide/SCENARIO_NOTES.md` | Covered initial | Observable event traces; compact judge input; evidence IDs; heuristic caveats; assistant-message previews; facts separate from findings. | `../patterns/evidence-linked-traces.md` |
| `../../../decision-context-traces/CURRENT_STATE.md` | Covered initial | ContextTrace/Physics vs DecisionTrace/Cognition; representation before optimization; minimal context packs; pattern lift; compaction metrics; held-out evaluation. | `../concepts/compaction-principles.md`, `../patterns/evidence-linked-traces.md` |
| `../../../decision-context-traces/agent/docs-papers-map.md` | Covered initial | Papers/docs synthesis; representation layer; risks: hallucinated rationale, proxy hacking, premature ontology, over-compression, decision inflation, no outcome link. | `../concepts/compaction-principles.md`, `../patterns/evidence-linked-traces.md` |
| `../../../decision-context-traces/README.md` | Covered initial | Three-stage pipeline: event extraction, reasoning traces, pattern synthesis; compound engineering framing. | `../patterns/evidence-linked-traces.md` |
| `../../../decision-context-agent/README.md` | Covered initial | Emergent schema from trajectories; event extraction → reasoning traces → pattern synthesis; RLM-PoT as deterministic dataset coverage. | `../patterns/evidence-linked-traces.md` |
| `../../pi-subagent-coordinator/agent/delegation-handoff-research.md` | Covered initial | Handoff as transfer of authority, responsibility, context, constraints, verification criteria; Verification Tax; confidence and comprehension checks. | `../patterns/handoff-context-brief.md` |
| `../../pi-subagent-coordinator/agent/coordinator-strategy-experiment-003-results.md` | Covered initial | Measured coordinator overhead; improved handoff quality; routing rule for baseline vs coordinator. | `../patterns/handoff-context-brief.md`, `../concepts/budget-and-storage-aware-compaction.md` |
| `../../pi-subagent-coordinator/agent/coverage.md` | Covered initial | Evidence matrix and experiment artifacts for coordinator work. | `../patterns/handoff-context-brief.md`, `../status/coverage.md` |
| `../../pi-extension-environment/pi-extension-diesel-km-brief.md` | Covered initial | Token usage collection, approximation caveats, current-session scope, cost/energy communication. | `../concepts/budget-and-storage-aware-compaction.md` |
| `../../pi-coding-agent-container-ui-git/docs/research.md` | Covered initial | Per-task Pi session files, resume path, SQLite/token usage persistence in related UI systems. | `../concepts/budget-and-storage-aware-compaction.md`, `../concepts/context-pointers.md` |
| `../../pi-ai-consortium/README.md` | Covered initial | Pre-generation multi-angle probing; latency/token cost as attack surface; throttle/trigger need. | `../concepts/budget-and-storage-aware-compaction.md`, `../concepts/compaction-principles.md` |
| `../../pi-gui/notes/pi-gui-options-constraints-next-steps.md` | Covered initial | Extension UI parity constraints; session persistence/auditing as UI capabilities. | `../concepts/context-pointers.md` |
| `../../pi-ntfy-collaboration/docs/pi-ntfy-bridge-plan.md` | Partial initial | Cross-host steering, status, heartbeat, ask/reply, append-only topic reconstruction; peripheral to current compaction core. | `../status/coverage.md` |

## Repository-level inventory

| Repository | Status | Notes |
|---|---|---|
| `../../pi-ai-consortium` | Covered initial | Latency/token pressure and trigger/throttle need for pre-generation multi-angle probes. |
| `../../pi-coding-agent-container-ui-git` | Covered initial | Per-task session files and persistence notes relevant to externalized detail retrieval. |
| `../../pi-extension-environment` | Covered initial | Token usage and energy/budget notes synthesized into budget-aware compaction. |
| `../../pi-gui` | Covered initial | UI/session persistence constraints sampled; mainly future retrieval UX relevance. |
| `../../pi-ntfy-collaboration` | Partial initial | Cross-host status/control channel sampled; peripheral unless multi-session compaction becomes central. |
| `../../pi-self-reflect` | Covered initial | Focused read of `/tree`/reflection design note. More implementation docs remain. |
| `../../pi-sessions-replace-driver` | Covered initial | Core source for minimal progress capsule and high-signal intervention policy. |
| `../../pi-subagent-coordinator` | Covered initial | Handoff compaction, Verification Tax, confidence/comprehension checks, token/cost tradeoffs. |
| `../../pi-subagent-coordinator-playgrounds` | Referenced only | Evidence artifacts are referenced by coordinator docs but not directly inspected. |
| `../../pi-supervisor-guide` | Covered initial | Focused read of scenario validation and compact judge input pattern. |
| `../../../decision-context-agent` | Covered initial | README-level coverage only. |
| `../../../decision-context-traces` | Covered initial | Core trace-v2 and paper-map files covered. |

## Extraction rule

Do not copy source content wholesale. Use this map to point from compact synthesis to detailed origin files.
