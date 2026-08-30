---
description: Ask the active agent to assess anchored episode retirement
argument-hint: "[optional continuation emphasis]"
---

Assess whether anchored episode retirement is appropriate. **Always call `inspect_episode_retirement` first, then page as needed** before every `retire_episodes` call. Inspection mechanically lists safe candidates; it excludes active work and returns the witness-scoped `fromEpisodeInclusive` anchors and `inspectionWitness` authority.

The active agent independently decides whether retirement is worthwhile, which anchor to use, and the continuation goal. Choose `fromEpisodeInclusive` as the **oldest included completed episode**; it retires that episode through the newest completed episode, never active or unresolved work. Supply the returned `inspectionWitness` unchanged.

Please independently author the smallest critical `pinnedWorkingState` in your own words. It must be a non-blank state pin, not a generic summary, raw transcript, source/world knowledge, or filler. Keep only critical working state needed for continuation. The capsule model must not decide the boundary, goal, or pin; it receives redacted guidance and authors only the complementary five-key capsule.

If retirement is not safe or worthwhile, explain why and do not force it. Optional continuation emphasis: ${ARGUMENTS:-No extra continuation emphasis supplied.} It means only what should remain salient or happen next—never a boundary, goal, or count.
