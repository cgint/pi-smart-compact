# Compaction Boundary — Historical Failed-Attempt Report

> **Superseded:** this report describes the incorrect index-based attempt. Its completion
> claim is false for the current workspace: the later intended helper is absent, full
> precommit fails, and turn reduction is not wired. See
> `openspec/changes/keep-sessions-focused-between-turns/tasks.md` §9a and §10.

- **Handoff ID:** `pi-smart-compact-iter4-20260812`
- **Historical status:** the reported check was green only for the failed attempt
- **CMUX delivery:** FAILED — `surface:68` not found. Per brief: "If that surface is unreachable, say so in the report and stop."

## What I Did

Implemented section 9 of OpenSpec change `keep-sessions-focused-between-turns`: turn-reduce now skips tool results inside the compaction-protected range, preventing it from shredding what compaction deliberately preserved.

### Approach

Rather than passing raw session entries into `reduceContext` (which would couple the pure reduction layer to session internals), I computed the **protected message indices** at the wiring layer (`smart-compact.ts`) and pass a `Set<number>` of protected indices to `reduceContext`. This keeps the pure layer testable without session mocks while satisfying the stateless derivation requirement.

The check fires **before** the size gate and cache lookup, so protected messages are verdicted immediately with no wasted model calls.

### Red-First Evidence (quoted per test)

#### Test 1: "never reduces a tool result inside the compaction-protected range"

**Red output:**
```
FAIL test/turn-reduction.test.ts > compaction boundary — turn-reduce must not shred what compaction just protected > never reduces a tool result inside the compaction-protected range
AssertionError: expected 3 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 3
```

Three tool results (50,590 / 4,423 / 97 chars) were all reduced despite being in the protected range. `reduceCalls` was 3 instead of 0.

#### Test 2: "still reduces a tool result created AFTER the compaction entry"

**Red output:**
```
FAIL test/turn-reduction.test.ts > compaction boundary — turn-reduce must not shred what compaction just protected > still reduces a tool result created AFTER the compaction entry
AssertionError: expected undefined to be defined
```

No `compaction-protected` verdict existed, so neither the protected entry was skipped nor the post-compaction entry was distinguished.

#### Test 3: "with no compaction present, behaviour is unchanged"

Passed immediately (existing behavior — no compaction means no protection).

### Commands Run with Verbatim Precommit Tail

```
$ npm run precommit

> pi-smart-compact@0.1.0 precommit
> tsc --noEmit && npm run test && npm audit --audit-level=moderate

> pi-smart-compact@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/cgint/dev-external/pi-smart-compact

 Test Files  2 passed (2)
      Tests  61 passed (61)
   Start at  16:23:07
   Duration  832ms (transform 62ms, setup 0ms, import 681ms, tests 13ms, environment 0ms)

found 0 vulnerabilities
```

Exit code: 0. Typecheck clean, 61 tests passing (58 baseline + 3 new), 0 vulnerabilities.

### Files Changed + Diff Summary

1. **`src/turn-reduction.ts`**
   - Added `{ kind: "compaction-protected" }` to the `Verdict` union type
   - Added `protectedIndices?: Set<number>` to `ReduceOptions` with JSDoc quoting the `buildContextEntries` contract
   - Added compaction-protected check in `reduceContext` before the size gate: if the message index is in `protectedIndices`, it is verdicted with `{ kind: "compaction-protected" }` and skipped (no model call, no cache entry beyond the null verdict)

2. **`src/smart-compact.ts`**
   - Imported `getLatestCompactionEntry` from `@earendil-works/pi-coding-agent`
   - Added `protectedIndices` computation in the `context` handler using `getLatestCompactionEntry(ctx.sessionManager.getBranch())` + `ctx.sessionManager.buildContextEntries()`
   - Passed `protectedIndices` to `reduceContext`
   - Updated `onVerdict` logging to handle the new `compaction-protected` verdict type

3. **`test/turn-reduction.test.ts`**
   - Added describe block "compaction boundary — turn-reduce must not shred what compaction just protected" with 3 tests:
     - Protected range: 3 tool results (50,590 / 4,423 / 97 chars) — none reduced, all verdicted `compaction-protected`
     - Post-compaction: one protected + one outside range — only the latter reduces
     - No compaction: empty protected set — behavior unchanged

### Risks and Open Decisions

1. **Index correspondence assumption:** The implementation assumes message indices in `event.messages` correspond positionally to entry indices from `buildContextEntries()`. This holds for the current Pi version (0.84.1) where `sessionEntryToContextMessages` preserves order. If Pi changes the conversion, the protected range could misalign. Mitigation: the test suite catches this if we add an integration test.

2. **Forked sessions:** As noted in design.md, `buildContextEntries` is path-aware via `leafId` while `getBranch()` is the flat list. The protected range computation uses `buildContextEntries()` for the indices and `getBranch()` for `getLatestCompactionEntry`. In linear sessions these agree; forked sessions may diverge. This is a stated limitation from the design.

3. **Residual risk from design.md:** "Turn-reduce slows context growth, so compaction fires later, so the protected region persists longer than with reduction off." This remains untested in a live session.

4. **No temptation to touch out-of-scope items:** Did not touch the floor's regex false positives, absent upper bound on reduction ratio, duplicated `resolveAuth`, or missing model record — all explicitly deferred per the handoff brief.

5. **`CompactionEntryShape` and `SessionEntryShape` interfaces are defined but unused in the final implementation** (since we compute indices at the wiring layer). They were kept in case future debugging needs the shapes documented. Could be removed to reduce surface area.