# Compaction principles

## Status

Initial principles derived from the first research slice. Treat these as working rules for smart context compaction, not final architecture.

## Principle 1 — Representation before optimization

Do not start by making the context shorter. First make the session state faithful, inspectable, and evidence-linked.

A compact context that loses the distinction between observable facts, inferred decisions, and unverified rationale is dangerous: it may become smaller while becoming less true.

Design implication:

- Separate observable state from interpretation.
- Keep provenance for every substantive retained fact.
- Mark inferred or uncertain content explicitly.
- Optimize context size only after the representation is reviewable.

## Principle 2 — Minimality is decision-relative

The right compact state is not “the shortest summary.” It is the smallest state that still supports the next reliable progress decision.

A retained field must justify itself by changing or safeguarding the next action. If dropping it would not change next-step judgment, it should usually move out of active context and become a pointer.

## Principle 3 — Active context should carry control flow, not the archive

Use the active LLM context mainly for current control flow:

- current objective;
- active subtask;
- relevant constraints;
- completed high-level steps;
- next needed step;
- blockers/uncertainties;
- pointers to richer evidence.

Use files for durable detail, history, examples, provenance, and review artifacts.

## Principle 4 — Compress into high-signal interventions, not system chatter

Compaction should reduce irritation and session noise. If a side-channel verifier or reflector has no materially new risk, contradiction, missing verification, or decision-relevant issue, suppress it.

A useful injected compact note should contain:

- issue or risk;
- why it matters now;
- concrete next step or blocker;
- evidence pointer when available.

## Principle 5 — Out-of-band mechanisms should not mutate primary session semantics by accident

Background reflection, compaction, or review should not silently change the active session leaf, branch, or provider continuation state.

If compaction creates summaries or review artifacts, those should be deliberate artifacts with stable references, not accidental transcript pollution.

## Principle 6 — Preserve raw detail for rehydration

Over-compression is a failure mode. A smart compaction system should omit low-priority detail from active context only when it leaves a usable retrieval path.

A good compact output can say: “details externalized at `<path>#section>`” rather than embedding those details.

## Principle 7 — Measure compaction by usefulness, not compression ratio alone

Useful metrics include:

- whether the next action can be predicted or executed correctly from the compact state;
- whether evidence pointers resolve to the right source detail;
- whether held-out sessions improve without prompt/metric overfitting;
- whether compact state avoids leakage of direct action answers;
- whether review can distinguish fact, inference, and uncertainty.

Compression ratio matters only after task sufficiency and reviewability are protected.

## Failure modes to guard against

| Failure mode | What goes wrong | Mitigation |
|---|---|---|
| Narrative hallucination | The compact summary invents plausible “why” from thin evidence. | Separate ContextTrace-like facts from DecisionTrace-like inference; cite evidence. |
| Proxy metric hacking | Replay success improves because direct answers leak into compact context. | Use held-out checks and distinguish generic patterns from specific directives. |
| Over-compression | Future agent cannot recover why a decision was made. | Externalize detail and retain retrieval pointers. |
| Decision inflation | Every instruction/observation becomes a “decision.” | Use stricter decision criteria and review spans. |
| Transcript pollution | Internal reflection/checkpoint content becomes user-visible or alters session flow. | Keep sidecar/out-of-band artifacts unless injection is high-value. |
| Heuristic overconfidence | Regex/deterministic labels are treated as semantic truth. | Treat heuristics as candidates; use review and evidence IDs. |

## Source evidence

- `../../pi-sessions-replace-driver/AGENTS.md` — sections `GOAL`, `Working agreement`, and `Main strategies`; source for minimal high-signal driver-copilot framing and file-persistent knowledge.
- `../../pi-sessions-replace-driver/work/session-signal-system.md` — sections `Verifier output`, `Implemented watcher shape`, and `Intervention distillation policy`; source for minimal progress context and suppression of low-value interventions.
- `../../pi-self-reflect/docs/steering-feedback-tree-check.md` — sections `Design conclusions from the steering` and `Important limitation`; source for out-of-band reflection and avoiding active leaf/session-state pollution.
- `../../decision-context-traces/CURRENT_STATE.md` — sections `What the system is`, `Completed`, `Previous track`, and `Loop learnings and problems`; source for ContextTrace/DecisionTrace, minimal context packs, pattern lift, and metric risks.
- `../../decision-context-traces/agent/docs-papers-map.md` — sections `Core synthesis`, `Critical risks`, and `Working thesis`; source for representation-before-optimization and compaction risk taxonomy.
