# Keep the session focused between turns, not only when it overflows

> **Status: discontinued and archived 2026-08-28.** P01 found the design harmful. Its
> incomplete code is retained only as backup in `wip/turn-reduction-prototype`; `main` does
> not implement or support turn reduction. The present-tense text below is historical only.

## Why

### Summary

Today this extension improves context **once**, at the moment Pi decides to compact. Between those moments nothing shrinks. A tool result read twenty turns ago sits in the context at full size for the rest of the session, whether or not anything still depends on it.

That has three costs. Attention: the model re-reads stale bulk on every single call. Money: those tokens are paid for on every call, not once. And shape: compaction is a **cliff**, a large disruptive rewrite at an arbitrary threshold, rather than a gradient the session settles into.

The value of changing it is the same discipline this repo already argues for in `concepts/compaction-principles.md` — *keep the smallest active state that supports the next reliable decision, and externalize the rest behind precise pointers* — applied continuously rather than once per overflow. The same prompt-driven idea, at a cadence where it can actually keep a session healthy.

This is a natural extension of what the extension already is, not a new product: it already owns the judgement of what is worth keeping, and it already replaces context. This adds a second, cheaper place to apply it.

### Original user request (verbatim)

> I'm having quite a simple idea: what if we reduce the amount of information within the session by calling an LLM to only keep from the latest agent iteration, be it tool calls or similar, what is actually beneficial and omit the rest?

## What Changes

- A `context` handler — Pi's awaited pre-request hook — returns a message array in which **already-settled tool results** are replaced by a shorter LLM-written excerpt plus a pointer to the full original.
- Reduction is **write-once per message**: computed at most once, cached by a stable key, and reused byte-identically afterwards. Recomputing on every request would rewrite the prefix each turn and destroy provider prefix caching, turning a cost saving into a cost increase.
- **The newest turn is never touched.** Only material the session has already moved past is eligible.
- A **non-droppable floor**, taken from this repo's own compaction prompt (rules 10–12): exact error signatures and status codes, traceback locations, file paths, command invocations, and anything the user wrote.
- **Off by default**, behind its own switch, independent of `PI_SMART_COMPACT_ENABLED`, and failing open — any error leaves the messages untouched, exactly as compaction already degrades.
- Every reduction is **logged** with what was dropped, so the behaviour can be audited from outside rather than trusted.
- Existing `session_before_compact` behaviour is **unchanged**. The two operate at different cadences and must remain independently switchable so their effects can be told apart.

## Capabilities

### New Capabilities

- `turn-level-reduction` — reducing settled context between turns, with the guarantees that make it safe to leave on.

## Impact

- **Code:** `src/` (a new module plus hook registration), `prompts/` (a second prompt file — the reduction prompt is a different job from the compaction prompt and must be tunable separately), `test/`.
- **Not touched:** the compaction path, `prompts/smart-compaction-prompt.md`, the `behavioral-resumption-pilot` change.
- **Risk:** this alters what the model sees on every request, so a bad reduction is worse than a bad summary — it is silent. Mitigations are the floor, the newest-turn exclusion, the logged drops, and the default-off switch.
- **Rollback:** unset the switch. Nothing is persisted; the session file is never modified, so there is no state to unwind.
- **Verified precondition:** Pi's `context` hook replaces the messages sent to the provider and nothing else. `agent-loop.js:178-184` assigns the transform's result to a local before `convertToLlm`, so the session transcript on disk is untouched and every reduction stays recoverable.
