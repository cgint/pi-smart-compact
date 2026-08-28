# Goal-conditioned context carry-back at branch return

## Status

Concept note, not an implementation plan. It records the motive and requirements before choosing an architecture.

## Motive

Long agentic sessions accumulate exploration, tool output, corrections, and side work. Carrying all of it forward consumes attention and cost; blindly shortening it can remove the exact evidence later work needs.

The underlying problem is therefore not text length. It is deciding **what the active line of work needs to carry forward**, relative to its goal, while keeping everything else recoverable.

## Intent

Use the LLM for the semantic judgement that fixed rules cannot make well: which outcomes from completed or side work matter to the target line of work, and how they should be represented there.

Use the agent harness for the guarantees the LLM cannot safely provide by judgement alone: lossless history, branch identity, provenance, reversibility, protected exact detail, and observable acceptance or rejection.

## Goal

When returning from exploratory or side work to an earlier point in Pi's session tree, create the **smallest goal-conditioned continuation context that lets the target branch proceed reliably**.

Success is not maximum compression. Success is correct continuation without goal drift, repeated work, or loss of decision-critical evidence.

## Broader exploration goal

Explore whether **programmable delegated computation** can reduce what an agent must carry in its main context. Code, extractive reduction, RLM programs, and sub-agents may process large histories externally while returning only goal-relevant conclusions, evidence, uncertainty, and next-step implications.

We are cross-checking whether this can improve on destructive session compaction by being goal-conditioned, lossless and recoverable, selective across multiple processing stages, behaviorally sufficient for continuation, and efficient in total cost and context usage. No specific mechanism is chosen yet; the current work is to understand the information-flow problem and useful boundaries.

## Core concept: selective carry-back

A side branch remains a complete, lossless record. On return, the relevant target is not “summarize this branch.” It is:

> Relative to the target branch's goal and state at the fork, what changed, was learned, or remains unresolved that must now be carried back?

The resulting carry-back is a selective delta, analogous to a semantic branch merge. **“Nothing to carry back” is a valid result**; forcing a summary creates noise and invented relevance. When there is relevant residue, it should retain:

- decisions or constraints that now affect the target goal;
- verified findings and their provenance;
- changed artifacts and exact references;
- unresolved risks, failures, and uncertainty;
- enough rationale to avoid repeating invalidated approaches;
- precise pointers to side-branch detail that may become relevant later.

It should normally omit exploration that produced no durable consequence, repeated discussion, settled false starts, narration, and bulk evidence that can be retrieved through a pointer.

## Why this differs from existing approaches

| Approach | Trigger and scope | Main limitation |
|---|---|---|
| Pi/smart compaction | Context threshold; summarizes an overloaded conversation | Trigger is unrelated to a semantic boundary; retention must serve an uncertain future. |
| Turn-level reduction | Rewrites old tool results during the active session | Goal-blind per-result judgement; repeatedly edits cached history; measured cost and behavior harm. |
| Branch carry-back | Explicit return from side work to a known target branch and goal | Requires a trustworthy relevance judgement and clear merge semantics. |

This concept does not replace the North Star’s first prompt-only milestone. It is a later direction because it relies on persistent branch history and recoverable detail; it investigates a different moment where target intent is clearer and source history remains intact.

## Requirements

1. **Explicit target brief** — the target objective, active subtask, constraints, and integration question are declared rather than inferred from drifting history.
2. **Explicit boundary** — carry-back occurs at a deliberate return/merge point, not merely because a token threshold was crossed.
3. **Lossless source** — the side branch remains available unchanged; omission from active context is not deletion.
4. **Selective delta** — carry back consequences for the target, not a generic summary of everything that happened; allow an empty delta.
5. **Truth separation** — distinguish observed facts from decisions, inference, rationale, and uncertainty.
6. **Provenance and rehydration** — substantive claims and omitted detail have precise, resolvable references.
7. **Protected exactness** — failures, errors, commands, paths, identifiers, and other action-critical anchors cannot rely on prompt obedience alone.
8. **Uncertainty preservation** — when future relevance cannot be judged safely, preserve the uncertainty or a retrieval route rather than asserting irrelevance.
9. **Controlled mutation** — generation or review must not accidentally change the active leaf or branch before acceptance.
10. **Behavioral evaluation** — test whether a resumed agent preserves the goal, recognizes completed work, and takes the correct next action.
11. **Cost honesty** — measure total provider cost, cache effects, extra turns, and task success; compression ratio alone is not evidence of value.

## Early ideas, not decisions

- Treat the carry-back as a small merge packet: decisions, findings, artifacts, risks, unresolved items, and pointers.
- Let an LLM propose semantic retention while mechanical checks enforce invariants and allow refusal.
- Use an independent fresh agent or RLM child to test whether the packet is sufficient for continuation.
- Keep branch-local detail where it was produced and retrieve it only if later work makes it relevant.

## Advantages

- The trigger aligns with a real change in work rather than an arbitrary context limit.
- The target goal is known, making relevance judgement better posed.
- Full branch history remains recoverable, reducing the cost of aggressive active-context reduction.
- A one-time boundary transformation avoids continuous historical prefix rewriting.
- Side exploration can remain rich without permanently burdening the main line.

## Risks and disadvantages

- The LLM cannot know all future relevance and may omit latent dependencies.
- A concise but incorrect carry-back can create confident goal drift.
- The target branch may itself have changed, making “state at fork” insufficient.
- Pointers can become unusable or too expensive to follow.
- Multiple nested or parallel branches create conflicts and provenance complexity.
- More agents or verification calls can increase cost without improving continuation.

## Current thoughts

- This is best framed as **context selection at a semantic boundary**, not general-purpose summarization.
- The central quality is conditional sufficiency: enough for the target branch's next reliable decisions, with recoverability for the rest.
- LLM control is valuable for relevance judgement, but destructive authority should remain with the harness and user-visible workflow.
- RLM is relevant because it can consume large branch evidence and return narrow findings without forcing the parent context to absorb the evidence. Its value must still be judged end to end: correctness, context scalability, total efficiency, auditability, and complex-task capability.
- The strongest comparison is behavioral: resume from the carry-back and observe whether the agent stays aligned and acts correctly.

## Open questions

- What exactly identifies the target intent: state at fork, current user instruction, durable goal artifact, or a combination?
- Is carry-back advisory context, a new branch entry, or a user-reviewed artifact?
- How should conflicts between target state and side-branch findings be represented?
- What minimum mechanical safety floor is practical without retaining excessive noise?
- When is a pointer sufficient, and when must exact evidence remain inline?

## Related repository evidence

- `NORTH-STAR.md` — continuation context must preserve the bigger-picture objective, current phase, binding state, and next-step orientation.
- `concepts/compaction-principles.md` — minimality is decision-relative; active context carries control flow; raw detail remains recoverable.
- `concepts/context-pointers.md` — requirements for precise pointers and cheap rehydration.
- `concepts/behavioral-resumption-experiment.md` — continuation behavior is the primary success criterion.
- `findings/07-floor-as-code-not-prose.md` — semantic prompts need mechanical protection for exact action-critical content.
- `findings/08-parcour-p01-off-vs-on.md` — continuous reduction reduced context but increased cost and failed the measured task; branch-point reduction remains a distinct direction.
- `openspec/changes/keep-sessions-focused-between-turns/design.md` §10 — records the parked in-flight reducer and the branch-point alternative.
