# Evidence-linked traces

## Status

Initial pattern for grounding compaction in observable evidence and reviewable interpretation.

## Intent

A compact context should not blur together what happened, what was inferred, and what should happen next.

The evidence-linked trace pattern separates:

- **observable facts** — tool calls, messages, file mutations, errors, assistant final messages;
- **interpreted cognition** — intent, decision, rationale, risk, confidence;
- **compact active state** — what the next agent needs now;
- **evidence pointers** — how to rehydrate or audit details.

## Core split

| Layer | Role | Compact representation |
|---|---|---|
| ContextTrace / Physics | What observably happened. | Event IDs, action summaries, source file/index pointers. |
| DecisionTrace / Cognition | What the agent likely intended/decided. | Short decision/rationale spans with evidence refs and uncertainty. |
| Progress capsule | What matters for continuation. | Minimal current goal, completed steps, next action, blocker. |
| Pattern library | Reusable wisdom from repeated traces. | Generic trigger/pattern notes, not session-specific directives. |

## Compact trace shape

```yaml
facts:
  - id: evt_0012
    summary: "Wrote target file."
    source: "<trace artifact or session file pointer>"
  - id: evt_0016
    summary: "No verification command observed after mutation."
    source: "<trace artifact or session file pointer>"
findings:
  - type: "verification_gap"
    severity: "medium"
    confidence: 0.98
    evidence: [evt_0012, evt_0016]
    compact_intervention: "File was mutated without observed verification; run a focused check or state why verification is intentionally skipped."
uncertainty:
  - "Verification classification may be heuristic; direct execution commands can be missed unless recognized by context."
externalized_detail:
  - "Full trace: <path>"
  - "Judge input: <path>"
```

## Rules for compaction

1. **Facts first.** Start from observable trace facts before extracting rationale.
2. **Inference is not ground truth.** Decision/rationale spans are useful but must remain evidence-linked and revisable.
3. **Use evidence IDs.** Findings should cite event IDs or path/index pointers.
4. **Separate candidate issues from confirmed findings.** Heuristic signals should not become final truth without review.
5. **Keep judge inputs compact.** A judge or verifier should receive cleaned facts, assistant messages, and candidate issues, not the entire noisy transcript by default.
6. **Prefer generic patterns over directives.** Reusable compaction wisdom should not leak exact future actions from a session.
7. **Evaluate on held-out sessions.** Context compression claims should survive sessions not used for tuning.

## Relation to compaction

Evidence-linked traces let smart compaction delete bulk while preserving auditability.

Instead of carrying raw history, the compact state can carry:

- a few facts;
- a few decision-relevant findings;
- exact evidence pointers;
- an uncertainty note;
- a next-action recommendation.

This supports low-noise operation without cutting the agent off from source detail.

## Source evidence

- `../../pi-supervisor-guide/SCENARIO_NOTES.md` — sections `Cross-scenario assessment`, `Key findings`, and `Simple judge prototype update`; source for observable event traces, compact judge inputs, evidence IDs, and heuristic caveats.
- `../../../decision-context-traces/CURRENT_STATE.md` — sections `What the system is`, `Completed`, `Coverage Metrics`, and `Held-out evaluation set`; source for ContextTrace/DecisionTrace, reviewability artifacts, representation metrics, and held-out evaluation.
- `../../../decision-context-traces/agent/docs-papers-map.md` — sections `Core synthesis`, `Critical interpretation for this project`, and `Critical risks`; source for representation layer framing and risk controls.
- `../../../decision-context-traces/README.md` — section `The Intelligence Pipeline`; source for event extraction → reasoning traces → pattern synthesis.
- `../../../decision-context-agent/README.md` — sections `The Core Problem & Solution` and `Technical Architecture`; source for emergent schema and pattern synthesis framing.
