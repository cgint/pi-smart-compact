# Context pointers and externalized detail

## Status

Initial strategy note for compaction outputs that keep active context small while making omitted detail retrievable.

## Concept

A **context pointer** is a compact reference from active context to a richer artifact on disk.

Instead of carrying long explanations, examples, or raw traces in the active LLM window, the compacted context keeps a short pointer such as:

```text
Detail: see pi-smart-compact/patterns/evidence-linked-traces.md#compact-trace-shape
Source: ../../pi-supervisor-guide/SCENARIO_NOTES.md#simple-judge-prototype-update--2026-05-17-162053-cest
```

The pointer should be specific enough that a future agent can fetch the detail with one targeted read.

## Priority split

| Priority | Keep inline? | Treatment |
|---|---:|---|
| Current objective and active subtask | Yes | Inline in compact context. |
| Binding constraints and blocker rules | Yes | Inline; do not bury. |
| Next needed action | Yes | Inline and unambiguous. |
| Key open uncertainty | Usually | Inline if it changes next action; otherwise pointer. |
| Evidence detail | No, unless essential | Store in file and reference exact path/section. |
| Historical rationale | Usually no | Externalize; keep only decision-relevant residue. |
| Examples and edge cases | No | Externalize with pointer. |
| Raw transcripts/traces | No | Externalize; compact context should refer to trace IDs or file paths. |

## Pointer requirements

A good context pointer should include:

- stable relative path;
- section heading, symbol, event ID, or artifact name;
- short reason the pointer matters;
- whether the detail is evidence, example, caveat, or unresolved background.

Bad pointer:

```text
See the old notes.
```

Good pointer:

```text
Caveat: verification heuristics can misclassify direct execution commands; see ../../pi-supervisor-guide/SCENARIO_NOTES.md#finding-2--verification-detection-is-too-literal.
```

## Compacted-context pattern

A compacted agent context can use this shape:

```markdown
## Active frame
Objective: <one sentence>
Current subtask: <one sentence>
Next action: <one sentence>
Constraints: <short bullets>

## Retained facts
- <fact needed for next decision> (source: <path#section>)

## Externalized detail
- <topic>: <path#section> — <why it may be needed later>

## Uncertainty
- <uncertainty>; fetch <path#section> before acting if this becomes decision-relevant.
```

## Design guidance

1. **Default to retrieval, not retention, for low-priority detail.**
   If a detail does not affect the next action, preserve a pointer instead of carrying it.

2. **Do not hide binding constraints.**
   User constraints, safety rules, and current blocker rules must remain inline.

3. **Avoid accidental session-state mutation.**
   Background artifacts should live as files or extension entries. They should not alter the active Pi session branch/leaf unless the user explicitly asks for branch/session-tree behavior.

4. **Keep sidecar analysis sidecar.**
   Reflection or verifier outputs should be injected into the main session only when they add materially new leverage.

5. **Make rehydration cheap.**
   A future agent should be able to resolve a pointer with a targeted `read`, not a broad search.

## Source evidence

- `../../pi-sessions-replace-driver/work/session-signal-system.md` — sections `Verifier output`, `Implemented watcher shape`, and `Notes`; source for rich verifier artifacts plus smaller in-band interventions.
- `../../pi-self-reflect/docs/steering-feedback-tree-check.md` — sections `What was good about the steering`, `What was weak or risky`, and `Design conclusions from the steering`; source for branch/session-state separation and out-of-band reflection.
- `../../pi-sessions-replace-driver/AGENTS.md` — sections `Working agreement` and `Main strategies`; source for using chat context as control flow and files as durable knowledge.
- `../../decision-context-traces/agent/docs-papers-map.md` — sections `GAM — General Agentic Memory` and `Critical risks`; source for preserving history and retrieving/compiling just-in-time rather than over-compressing early.
