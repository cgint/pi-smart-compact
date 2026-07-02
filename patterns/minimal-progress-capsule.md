# Minimal progress capsule

## Status

Initial pattern extracted from the session-signal work. This is a candidate core artifact for smart compaction.

## Intent

A **minimal progress capsule** preserves just enough session state for an agent or verifier to decide whether work is still moving correctly and what should happen next.

It is not a transcript summary. It is a continuity object.

## Capsule shape

```yaml
initial_goal: "<original user/session objective>"
current_goal: "<current interpreted goal, if changed>"
current_active_subtask: "<one line>"
completed_high_level_steps:
  - "<short completed step>"
next_needed_step: "<one line>"
current_blocker_or_open_question: "<optional one line>"
insufficient_context: false
externalized_detail:
  - topic: "<detail omitted from active context>"
    pointer: "<relative path#section or artifact id>"
    reason: "<why it may be useful later>"
source_evidence:
  - "<path#section or event id>"
```

## Field rules

| Field | Keep when | Drop or externalize when |
|---|---|---|
| `initial_goal` | Needed to detect drift or incomplete objective. | Almost never; can be pointer only for very short scoped subtasks. |
| `current_goal` | Current work differs from initial goal or narrows it. | Same as initial goal and no drift risk. |
| `current_active_subtask` | Always for active work. | Never during continuation. |
| `completed_high_level_steps` | Needed to avoid repeating work or to prove progress. | Detailed command logs should be pointers. |
| `next_needed_step` | Always. | Never; compaction without next action is weak. |
| `current_blocker_or_open_question` | Blocks action or changes strategy. | Background uncertainty that does not affect next action. |
| `insufficient_context` | True when safe compaction cannot be done. | False only when evidence is enough. |
| `externalized_detail` | Detail may matter later but not now. | Detail is irrelevant or already covered by a higher-level pointer. |
| `source_evidence` | Needed for audit/replay. | Never for substantive claims. |

## Minimality rule

Every retained field must be justified by a concrete progress decision. If dropping a field would not change next-step judgment, it should not be in the active capsule.

## Safety rule

If the available history cannot be compressed safely, set `insufficient_context: true` and say what must be fetched before proceeding. Do not invent continuity.

## Example capsule

```yaml
initial_goal: "Create a compaction-oriented knowledge base under pi-smart-compact."
current_goal: "Extract source-backed compaction patterns from Pi and decision-context repos."
current_active_subtask: "Write first-slice synthesis notes with exact source pointers."
completed_high_level_steps:
  - "Created NORTH-STAR.md from user briefing."
  - "Read first high-yield source documents for signal extraction, reflection, supervisor traces, and decision-context traces."
next_needed_step: "Verify all written source links resolve and update coverage status."
current_blocker_or_open_question: null
insufficient_context: false
externalized_detail:
  - topic: "Detailed verifier angle list"
    pointer: "../../pi-sessions-replace-driver/work/session-signal-system.md#implemented-watcher-shape-2026-06-12"
    reason: "Useful if designing actual verifier prompts later."
source_evidence:
  - "../../pi-sessions-replace-driver/work/session-signal-system.md#implemented-watcher-shape-2026-06-12"
```

## How this supports smart compaction

- It keeps active context centered on progress and next action.
- It avoids reloading full session history for every continuation.
- It makes missing context explicit instead of hiding it behind confident summaries.
- It gives low-priority detail a retrieval path.
- It is small enough to be injected or carried across turns without becoming noise.

## Source evidence

- `../../pi-sessions-replace-driver/work/session-signal-system.md` — section `Implemented verifier angle: minimal_progress_context`; source for capsule fields, minimality rule, and insufficiency signal.
- `../../pi-sessions-replace-driver/work/session-signal-system.md` — section `Verifier output`; source for artifact-rich verifier output and lightweight evidence pointers.
- `../../pi-sessions-replace-driver/AGENTS.md` — sections `GOAL` and `Main strategies`; source for minimal high-signal interventions and using files for durable knowledge.
- `../../decision-context-traces/CURRENT_STATE.md` — section `Held-out evaluation set`; source for treating compact context as something that should be evaluated against task usefulness rather than accepted by appearance.
