---
description: Ask the active agent to assess a native-tree branch handoff
argument-hint: "[optional continuation emphasis]"
---

Assess whether a native-tree branch handoff is appropriate. This is the sole/default context-retirement path. **Do not invent or claim that anything has been applied.**

If a handoff is worthwhile:

1. Call `native_tree_targets` to list candidate non-user ancestors on the current branch (newest first, with entry ids and excerpts). Choose one assistant entry id as `targetId`.
2. Author the exact handoff text yourself — the continuation state that must survive the abandoned branch below the target. Keep only critical working state needed to continue; do not copy raw transcripts, source/world knowledge, or filler. The handoff must carry forward, in the text itself:
   - the **active work** (what is being worked on right now) and the **next step**;
   - **unresolved tasks / open questions** that are still pending;
   - **constraints, decisions, and invariants** that must keep governing the work.
   Do not pick a boundary so early that it discards this live state.
3. **Legacy projected capsule/pin:** If `targetId` sits *before* a historical episode-retirement receipt on the current branch, that receipt will not be on the resulting branch — so its projection and recall become unavailable there. Do not assume the earlier projection survives the switch. If that legacy capsule/pin still holds relevant objective, decisions, unresolved items, or pinned state, explicitly fold its content into the handoff text as continuation state. (The original branch remains accessible for full recovery, but the resulting branch will not show the old projection.)
4. Call `handoff_record` **once** with that `targetId` and exact `text`. Then give a short final response in the same turn and do not call any other tool after it.
5. `handoff_record` returns a `handoffId`. Tell the user the exact command to apply it: `/tree-handoff <handoffId>` (substitute the real returned id). Explain that **the user must run this command themselves and explicitly confirm**; it is not applied automatically and nothing is applied until the user confirms.

If a handoff is not safe or worthwhile, explain why and do not force it. Never report a branch switch as done — only the user's explicit `/tree-handoff <handoffId>` confirmation performs it. Optional continuation emphasis: ${ARGUMENTS:-No extra continuation emphasis supplied.} It means only what should remain salient or happen next.
