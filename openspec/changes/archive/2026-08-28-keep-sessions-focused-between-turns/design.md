# Design — keep-sessions-focused-between-turns

> **Historical design, discontinued 2026-08-28.** P01 showed harm; `main` does not contain
> turn reduction. Incomplete prototype code is retained only in `wip/turn-reduction-prototype`.

## Context

The idea arrived on 2026-08-11 and was first built toward in a different repo (`pi-deliberate`, a research extension for per-action "folds" of session state). That was the wrong host, and the reasons are worth carrying rather than rediscovering — they shaped the constraints below.

Everything in this document that says *verified* was read in this repo's own `node_modules` at `@earendil-works/pi-coding-agent@0.84.1`.

## Verified facts about the seam

1. **The `context` hook replaces messages.** `ContextEvent { messages: AgentMessage[] }` (`types.d.ts:489-492`); `ContextEventResult { messages?: AgentMessage[] }` (`:762-764`); registration at `:851`.
2. **The replacement reaches the provider and nothing else.** `agent-loop.js:178-184`:
   ```js
   let messages = context.messages;                                   // local
   if (config.transformContext) messages = await config.transformContext(messages, signal);
   const llmMessages = await config.convertToLlm(messages);
   ```
   `context.messages` is never reassigned, so the session transcript is untouched. **The reduction is a view over a lossless record.** Every dropped span stays recoverable, which is what makes an aggressive reduction defensible at all.
3. **The model plumbing already exists here.** `complete` from `@earendil-works/pi-ai/compat`, plus the two auth workarounds in `src/smart-compact.ts:65-95` that were earned the hard way (`getApiKeyAndHeaders` uses a stricter path than runtime; `no-api-key-needed` providers must bypass the gate). Reuse them; do not re-derive them.

## Decisions

1. **Reduce settled tool results only.** Not user messages, not assistant text, not the newest turn. The newest turn is what the model is actively reasoning over; the rest is what it has moved past. This bounds the blast radius to the material that is both largest and least likely to still matter.

2. **Write-once, keyed, frozen.** The `context` hook fires before *every* request with the whole array. If reduction were recomputed each time, the prefix would differ every turn and provider prefix caching would miss from the edit point onward — the change would *increase* cost while claiming to reduce it. Each eligible message is reduced at most once and reused verbatim. **Testable property:** two consecutive `context` calls with no intervening turn produce byte-identical arrays.

   > **Measured 2026-08-11 — this decision does NOT deliver the property it claims.** See
   > *Measured results* below. Write-once bounds each message to **one** cache miss; it
   > does not prevent the miss. The reasoning above is circular and was wrong.

3. **Excerpt plus pointer, not a rewrite.** The reduced message states what the result was and how to get the whole thing back. Replacing content with prose that cannot be traced is how a reduction becomes an unfalsifiable claim.

4. **A floor that is never crossed.** Error signatures, status codes, traceback locations, file paths, command invocations, user-authored text. This list is not invented — it is `prompts/smart-compaction-prompt.md` rules 10–12, which exist because earlier compactions dropped exactly these and broke resumption. The same failures apply here at higher frequency.

5. **Its own switch, default off, fail open.** Independent of `PI_SMART_COMPACT_ENABLED` so the two mechanisms can be measured apart. Any failure — model error, timeout, malformed output — returns the messages unmodified. This mirrors how compaction already degrades to Pi's built-in behaviour.

6. **Drops are logged.** What was removed, from which message, and why it was eligible. An unlogged reduction can only be evaluated by feel.

## Why not derive the reduction from a structured view

The rejected alternative, recorded because it was seriously pursued and is likely to resurface: have a per-action "fold" produce a structured view of the session, then keep exactly the spans that view's references point at. The appeal is real — the drop set becomes a *fact* about the view rather than an LLM's opinion of what is "beneficial", which side-steps the judgement problem entirely.

It was tried on 2026-08-11 and measured. The fold, once fed real tool output, produced sixteen accurate file facts, **zero** open questions, **zero** next-step candidates, and an "edges" section that contradicted its own contents. Reduction derived from those references would have kept `package.json` trivia and dropped the actual task. The elegant answer is not available yet, and waiting for it delivers nothing.

So: an LLM judges what to keep, and the guardrails above — bounded scope, floor, logging, lossless underlying record — carry the weight instead. If a structured view ever becomes good enough to derive from, this seam is where it would plug in.

## Measured results

### 2026-08-11 — reducing at `context` guarantees a prefix-cache miss

**The cost argument is not established, and the mechanism as designed works against it.**

Session `019ff268-97bb-719b-a8c9-20b75fb72732`, first real interactive run. From its
`.pi/turn-reduce/<session-id>/_requests.log`:

```
19:59:59  context  3762 →  3760   toolResults=1  eligible=1  reduced=1
20:00:06  context 19283 → 19281   toolResults=3  eligible=1  reduced=0
20:00:48  context 25008 → 18252   toolResults=3  eligible=3  reduced=2   (-27%)
```

Pi's own accounting for the request following that last event:

```
Input: 73,370   Cached: 38,400 (52.3%)
Cache Re-billed: $0.003 (16,013 tokens, 1 miss)
```

**The circularity.** A message becomes eligible only once it is at least `afterN` turns
behind — which means it has already been sent at least once, so it is already inside the
cached prefix. Editing it therefore *always* lands in cached territory. Eligibility and
cache-safety are mutually exclusive under this design. Write-once means each message
causes exactly **one** miss rather than many; it does not avoid the miss.

**The arithmetic.** That event removed ~6,750 characters ≈ **1,700 tokens per subsequent
request**, and cost **16,013 tokens once**. Break-even is roughly nine or ten further
requests — and only if nothing else reduces meanwhile, since each new reduction restarts
the clock. Net positive is plausible on long sessions with large tool output; it is
clearly negative on short ones.

**What this does not invalidate.** The mechanism works: eligibility, the floor, fail-open,
per-session audit files, and the one-reduction-per-message guarantee all behaved as
specified. The defect is *where* the reduction is applied, not whether it can be applied.

### Options, none chosen yet

1. **Reduce before first send** — do the work in the `turn_end` handler so the result
   enters the context already reduced and is never rewritten. No miss can occur, because
   nothing cached is ever edited. Cost: the turn that produced the output never sees it in
   full, which may damage the reasoning that immediately follows it. This is the only
   option that keeps both the original idea and the cost argument.
2. **Batch rarely** — accept a miss but amortise it across many reductions at once. This
   converges on compaction, which this repo already implements at
   `session_before_compact`.
3. **Piggyback on an existing miss** — reduce only at a moment the prefix is being
   invalidated anyway.

Deciding between these needs a measurement of option 1's effect on the immediately
following turn, which does not exist yet.

## Iteration 2 — decided 2026-08-11, after the first measured session

User ruling on placement: **rewriting the very near past is acceptable** even at the cost
of a small cache miss, provided the session stacks less context overall; and *not sending
a full tool response to the main model at all* is also acceptable where the output type
justifies it. Four changes follow from that plus the measured backlog.

7. **A reduction must be worth the risk it carries, not merely shorter.** Every reduction
   risks the reducing model misrepresenting the result. `537 → 519` — an 18-character
   saving — does not pay for that risk, so the original is kept. The bar is a **minimum
   gain**, absolute and proportional, plus a **minimum input size** below which no
   reduction is attempted at all. The size gate matters independently: it avoids spending
   a model call to discover an answer the length already gave us.

8. **Decide in place, never defer.** Every message that becomes eligible is settled during
   the event in which it first becomes eligible — reduced, or given a verdict. Nothing is
   left pending. This is what actually prevents the measured backlog: a message that is
   never pending can never drift deeper into the prefix and cause an expensive late edit.

   > **Supersedes** the eligibility-*window* idea (`afterN <= behind <= afterN + K`) drafted
   > earlier the same evening. The window was a patch for deferral; removing deferral
   > removes the need for it. Recorded because the reasoning, not just the conclusion,
   > was wrong.

9. **A verdict is cached, and its scope is the reduction call only.** "Do not reduce this
   message again" means no further *side-channel* model call is spent on it. The main model
   continues to receive that message in full, exactly as before — nothing is hidden from
   the agent. Retries happen **in place** and bounded; the root cause of a failure is
   logged rather than swallowed, because "not shorter", "timed out" and "auth failed" are
   three different problems and the first session could not distinguish them.

10. **The reduction is bounded in time.** The `context` hook is awaited before every LLM
    call, so an unbounded reduction hangs the session. The whole reduction carries a
    ceiling; on expiry the messages are returned untouched. This was absent in iteration 1
    and is a latent hang, not a performance nicety.

## Iteration 3 — the pointer, decided 2026-08-11

Decision 3 already required *"excerpt **plus pointer** … and how to get the whole thing
back"*, and `concepts/context-pointers.md` already rules that raw traces are externalised
with a path reference. Iteration 1 shipped the excerpt and **omitted the pointer** — a
written decision that never reached the code, the third instance of that failure in one
evening. This closes it.

11. **The original is externalised, and the reduced message names it.** Each kept
    reduction writes the untouched result to its own file beside the audit entry, and the
    reduced content carries one line naming that path. The audit `.md` is not that file:
    it wraps the original in a fence inside `<details>`, which is right for a human and
    wrong for exact recovery.

    **Why a file beats re-running the tool.** Re-running yields *fresh* output; the file
    yields **what the agent actually saw at that moment**. For anything historical those
    differ, and the historical one is usually the answer. Re-running may also be slow,
    expensive, or not idempotent. The file also survives compaction, which in-context text
    does not.

    **The pointer must not lie.** `.pi/` is scratch space that may be cleaned, so the path
    is relative and the line reads as a possibility, not a guarantee. A dangling pointer
    must degrade to a missing file, never to a false claim that detail was preserved.

    **Accepted risk:** the agent may read originals back, re-inflating context, and a
    read-back costs a tool call *plus* the full content. That is the intended trade — pay
    for detail when it turns out to matter rather than on every request forever. It also
    yields a new signal: frequent read-backs mean the reduction is too aggressive, and
    that is mechanically visible in the tool calls.

## Iteration 4 — turn-reduce must not shred what compaction just protected

### The collision, measured

Session `019ff644`, 2026-08-12. Compaction ran at 13:59:23 (`fromHook: true`, so it was
this extension's own summary) and kept three tool results verbatim. Thirty-four seconds
later turn-reduce destroyed two of them:

| Kept by compaction | Size | What turn-reduce did |
|---|---:|---|
| `read …a7ac6f6c9e` | 50,590 | → 502 (99% gone) |
| `bash …be6b002423` | 4,423 | → 159 (96% gone) |
| `bash …180f5084c2` | 97 | verdict `too-small`, untouched |

Matching log line: `gains=[read:50590→502(99%) bash:4423→159(96%)]`.

**Why this is the worst case rather than an overlap.** `findCutPoint(…, keepRecentTokens)`
preserves the recent tail deliberately: it is the working set the agent needs to continue,
and it is explicitly *not* summarised — the summary covers only pre-cut material. So after
turn-reduce shreds the kept tail, that content is in the agent's context **nowhere**:
absent from the summary by design, and gone from the tail. Compaction did its job;
turn-reduce then removed the part compaction had protected.

Turn-reduce has no concept of the boundary — eligibility is `turnsBehind >= afterN` and
nothing else. Compaction *creates* the condition, because it removes everything older,
leaving the protected tail as the only substantial material left to reduce.

### 12. Never reduce inside the compaction-protected range

> **User ruling, 2026-08-12.** The range form was the user's; an earlier snapshot-of-ids
> proposal from the assistant is superseded, and an intermediate "reset the turn counter"
> fallback is **rejected outright** — it merely postpones the same collision by `afterN`
> turns and delays reduction of new material as well.

Entries between the latest compaction's `firstKeptEntryId` (inclusive) and the compaction
entry itself (exclusive) are the protected working set. Tool results in that range are
never reduced, and the skip is recorded as its own verdict so the rule is visible firing
rather than inferred from an absence.

**Why the range holds, from the published contract.** `buildContextEntries` is exported
from the package entry point and its declaration documents the layout this depends on:

> *"the latest compaction is represented by the compaction entry itself, followed by the
> kept entries starting at firstKeptEntryId and all entries after the compaction entry.
> Older summarized entries are omitted."*

So context = `[summary] + [kept range] + [new]`. The range is **closed** — new material
lands after the compaction entry and therefore reduces normally. This is the point that
kills the "protects everything forever, unbounded context" objection.

**Bounded four ways, all mechanical:**

- **Size** — `findCutPoint` accumulates from the end until `keepRecentTokens`; default
  **20,000** (`settings-manager.js:521`, configurable).
- **Membership** — closed range, fixed at compaction time.
- **Lifetime** — only the *latest* compaction counts, so at the next one these entries fall
  before the new cut and leave context entirely. Protection ends by deletion.
- **Statelessness** — derived from session entries on every context event, so it survives
  `/reload`, resume, and being loaded into an already-compacted session. A remembered
  snapshot would silently fail all three.

Works identically whether the compaction came from this extension or Pi's built-in — same
entry type, same field — so protection does not depend on `PI_SMART_COMPACT_ENABLED`.

**Already safe, no rule needed:** the summary itself is `role: "compactionSummary"`
(`createCompactionSummaryMessage`), not `toolResult`, so `isToolResult()` already excludes
it. Turn-reduce cannot damage the summary.

**Interface position.** The rule uses only declared API: `getLatestCompactionEntry` and
`type CompactionEntry` (both exported from the package entry), `ctx.sessionManager`
(`ReadonlySessionManager`), and the documented `buildContextEntries` layout. The *cost
argument* around it does lean on internals read from compiled output — `agent-loop.js`
assigning the transform result to a local, `calculateContextTokens` driving the compaction
trigger from provider-reported usage, and `findCutPoint`'s algorithm. Those are
documentation risks, not breakage risks: if they change, nothing fails to compile, the
cost model just quietly stops holding.

### Known residual risk

Turn-reduce slows context growth, so compaction fires later, so the protected region
persists **longer** than with reduction off. Bounded in size, unbounded in
time-until-next-compaction. Untested.

Fork/branch sessions: `buildContextEntries` is path-aware via `leafId`, while `getEntries()`
is the flat list. Linear sessions agree; forked ones may not. Treated as a stated
limitation rather than claimed as handled.

## Risks / Trade-offs

- **A bad reduction is silent**, where a bad compaction summary is at least visible in one place. Mitigated by the floor, the newest-turn exclusion, and logged drops — not eliminated.
- **The reduction call costs tokens on the turn it happens.** It pays back only if the removed bulk would have been re-sent enough times to exceed it. Long sessions win; short ones may not. This is measurable and should be measured before the switch is recommended on.
- ~~**Prefix-cache behaviour is the whole cost argument** and rests on decision 2 holding in practice, not just in a unit test.~~ **Measured 2026-08-11: it did not hold.** See *Measured results*. This risk is now a finding and blocks any recommendation to enable the switch.
- **Two mechanisms now shape context.** If both are on and a session degrades, attribution is hard — hence separate switches.

## Open Questions

- ~~What cadence is right~~ — **decided 2026-08-11**: `PI_TURN_REDUCE_AFTER_N`, default `1`. Now subordinate to the placement question in *Measured results*, since reducing at `context` at any N incurs the miss.
- **Is there a minimum size below which reducing loses?** Measured 2026-08-11: a 537-char `ls` result reduced to 519 — 18 characters saved for a full model call. The saving lives entirely in large results; small ones cost more than they return.
- Is a per-message reduction the right unit, or should a whole settled turn reduce as one? Per-message is simpler; per-turn may read better.
- Does this compose with `session_before_compact`, or does reducing early starve the later summary of the detail it needs to be accurate? Cannot be answered before both run together.
