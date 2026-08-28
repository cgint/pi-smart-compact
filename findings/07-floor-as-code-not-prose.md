# 07 — The floor is prose in compaction and code in turn-reduce

> As-of 2026-08-12. Harvested from the `keep-sessions-focused-between-turns` change
> **at the moment it was parked**, so the knowledge does not go cold with the feature.
> This is a finding, not a change proposal. Nothing here has been implemented.

## The finding in one paragraph

Both paths carry the same non-droppable floor — exact error signatures, status codes,
traceback locations, file paths, command invocations, anything the user wrote. In
compaction that floor exists **only as prose in the prompt** (rules 10–12), which is a
*request* to a model; the sole check on the returned summary is `if (!summary.trim())`.
In turn-reduce the same floor exists **as executable code**: `protectedTokens()` extracts
it from the original, `applyFloor()` verifies it survived, and the reduction is **rejected**
with a `too-protected` verdict if it did not. The older, shipped, daily-used path is the
one without the guard.

## Evidence

**Compaction — `src/smart-compact.ts`, the only post-check:**

```ts
const summary = response.content.filter(...).map((c) => c.text).join("\n");
if (!summary.trim()) {
  console.warn(`${LOG_PREFIX} Empty summary, falling back to Pi's default`);
  return;
}
```

Non-empty is the entire acceptance criterion. Whether rules 10–12 were obeyed is never
established.

**Turn-reduce — `src/turn-reduction.ts`:**

```ts
candidate = applyFloor(original, (await reduce(original, message.toolName)).trim());
// applyFloor: const missing = protectedTokens(original).filter((t) => !reduced.includes(t));
if (candidate === null) decide({ kind: "too-protected", missing: protectedTokens(original).length });
if (!worthKeeping(original, candidate, config.minGainRatio)) decide({ kind: "not-worth-it", ... });
```

Compliance is verified mechanically, non-compliance is a named verdict, and the verdict
is logged.

## Why this matters, and it is not theoretical

The measured precedent behind the whole evaluation is a *compaction-shaped* failure: in a
paired campaign of 2,848 analysed provider-billed runs, aggressive compression cut
successful patch application from **27/40 to 15/40 by destroying verbatim edit anchors**
(`~/dev/concepts/deliberate-agent/docs/cross-domain-comparison.md` §4). Verbatim edit
anchors — paths, line references, exact command text — are precisely what the floor
exists to protect and precisely what a prose-only floor cannot guarantee.

## Why transfers only flow one way

The original question was whether compaction and turn-reduce could learn from each other,
symmetrically. They cannot, because they are not siblings:

| | compaction | turn-reduce |
| --- | --- | --- |
| input | `serializeConversation(convertToLlm(allMessages))` — whole conversation | one tool result, isolated |
| goal visible | implicitly, user messages are in the input | **no**, structurally |
| effect | writes a session entry, changes the branch | a view; never reaches disk |
| cadence | at a threshold | after N settled turns |

So:

- **Safety mechanisms transfer** turn-reduce → compaction: floor-as-code, the verdict
  taxonomy, the gain-ratio refusal, per-item audit with originals retained.
- **Judgement mechanisms do not transfer** in either direction: what is worth keeping
  depends on the goal, and only compaction can see it.

The already-completed transfer ran the other way and was of *content*, not mechanism:
turn-reduce's floor list, its off-by-default and fail-open discipline, and the
prompt-as-single-config-point pattern all came from compaction.

## What a transfer would look like — sketch only, not a plan

1. Extract protected tokens from the pre-compaction conversation.
2. Check the returned summary retains them.
3. On failure: retry once, then fall back to Pi's default compaction rather than accept a
   summary that dropped an error signature.
4. Log what was missing, as turn-reduce logs verdicts.

## Two caveats that must travel with the idea

1. **The regexes are known-imperfect.** `protectedTokens()` has recorded false positives —
   the word `EVERY` matched as an error identifier, slash-command names matched as paths.
   Transferring the mechanism transfers the false positives.
2. **`MAX_RESTORED_TOKENS = 8` does not scale.** At compaction scale the protected set is
   a whole conversation, so "every token must survive" is unusable. The transfer would
   have to narrow to the high-value classes — error signatures, exit codes, `file:line`
   references, exact command text — not every path ever mentioned.

## Status

Recorded, not scheduled. Implementing it in compaction is a **different category** from
turn-reduce: a small safety guard on a path already in daily use, with a named failure
mode it currently cannot detect — not a speculative benefit. That call is open.
