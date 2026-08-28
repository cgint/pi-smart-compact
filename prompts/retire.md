---
description: Ask the active agent to assess episode retirement
argument-hint: "[optional continuation emphasis]"
---

Assess whether episode retirement is appropriate. If a prior continuation capsule exists, call inspect_episode_retirement first: it mechanically lists safe candidate counts; `latestCompletedEpisodes` counts original raw completed episodes, including those already represented by the capsule. You retain judgment and independently own whether/count/goal. If appropriate, independently choose the largest safe contiguous suffix of fully settled completed episodes and an appropriate continuation goal, then call retire_episodes. Keep active or unresolved work verbatim. If it is not safe or worthwhile, explain why and do not force it.

Optional continuation emphasis: ${ARGUMENTS:-none supplied}. Supplied emphasis means what should remain salient or happen next, not instructions about what to retire.
