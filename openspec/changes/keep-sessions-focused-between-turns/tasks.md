# Tasks — keep-sessions-focused-between-turns

> **Historical work record; status 2026-08-13: parked, not releasable.** The current
> workspace has pure reducer code and tests but lacks extension wiring; full precommit is red.
> Checkmarks record work attempted at the time, not a claim that a working feature remains.
> The switch would stay **off by default** for every task below.

## 1. Ground the work

- [ ] 1.1 **TDD**: read `test/smart-compact.test.ts` first and record what it already covers and how it fakes the model call — the new tests follow its conventions rather than inventing a second style. No production code is written in this change before a failing test exists for it.
- [ ] 1.2 Confirm against this repo's installed `@earendil-works/pi-coding-agent` that the `context` hook replaces messages and that the transform's result never reaches the session file (see `design.md` § Verified facts). If either has moved since 0.84.1, stop — the change's premise has changed.
- [ ] 1.3 Identify how a settled tool-result message is recognised in an `AgentMessage[]`, and how to key it stably across requests. **The key decides whether decision 2 is implementable at all**; if no stable key exists, that is a finding, not something to work around.

## 2. Eligibility, pure and testable

- [ ] 2.1 Write failing tests for the eligibility rule: settled tool results are eligible; the newest turn, user messages, and assistant text are not.
- [ ] 2.2 Implement the eligibility rule as a pure function over `AgentMessage[]` with no model call and no I/O.
- [ ] 2.3 Write failing tests for the non-droppable floor (error signatures, status codes, traceback locations, file paths, command invocations, user text) and implement it.
- [ ] 2.4 **Verification**: the pure layer is exercised without any network access and without a running Pi host.

## 3. The reduction prompt

- [ ] 3.1 Add `prompts/turn-reduction-prompt.md` as the single configuration point for this behaviour, following the existing prompt's file-loading pattern. It is a **separate** job from compaction and must be editable without touching the compaction prompt.
- [ ] 3.2 Write failing tests asserting the prompt loads and states the floor and the excerpt-plus-pointer requirement.
- [ ] 3.3 **Verification**: editing the prompt file changes behaviour with no code change.

## 4. Wire the hook

- [ ] 4.1 Write a failing test that the `context` handler returns messages **unmodified** when the switch is off, and that no model call is attempted.
- [ ] 4.2 Write a failing test for write-once caching: two consecutive `context` calls with no intervening turn produce **byte-identical** arrays and exactly one model call. This is the cost argument — without it the change makes things worse.
- [ ] 4.3 Write a failing test that any model failure (error, timeout, malformed output) leaves messages untouched.
- [ ] 4.4 Implement the handler, reusing the model and auth plumbing in `src/smart-compact.ts:59-95` rather than re-deriving it.
- [ ] 4.5 Implement drop logging: what was removed, from which message, why it was eligible.
- [ ] 4.6 **Verification**: full precommit passes (typecheck, tests, audit), and `session_before_compact` behaviour and its tests are unchanged.

## 5. Prove it on a real session

- [ ] 5.1 Run one real session with the switch on and capture, as numbers with stated scope: tokens before and after per request, how many messages were reduced, and the reduction call's own token cost.
- [ ] 5.2 **Verification**: state whether the saving exceeds the reduction call's cost, and over what session length it starts to pay back. A negative result is a valid outcome and must be recorded, not retried until favourable.
- [ ] 5.3 Inspect the drop log from that session against the floor: confirm no error signature, path, command, or user-authored text was removed.
- [ ] 5.4 **Final verification by the user**: run a real working session with the switch on, then answer — did anything the agent needed go missing, and did the session feel better or worse? This is the acceptance test. If the agent lost something it needed, the change does not ship on regardless of the token numbers.
- [ ] 5.5 **Final verification by the user**: confirm the default stays off and that the recorded cost measurement is honest about session length before the switch is recommended to anyone else.

## 6. Placement — reopened by measurement (2026-08-11)

> The first real session showed that reducing at `context` **always** invalidates the
> prefix cache, because a message only becomes eligible after it has already been sent.
> `design.md` § Measured results carries the evidence. Section 5's cost tasks cannot be
> answered until placement is settled — measuring the current placement would only
> re-measure a known defect.

- [ ] 6.1 Decide placement between the three options in `design.md` § Options: reduce before first send (`turn_end`), batch rarely, or piggyback on an existing invalidation. Record the choice and its rationale rather than changing code first.
- [ ] 6.2 If option 1 is chosen: measure what the turn that produced the output loses by never seeing it in full. This is the cost that option trades for the cache saving, and it is currently unmeasured.
- [ ] 6.3 Add a minimum-size threshold below which a result is not reduced — measured 2026-08-11: a 537-char result yielded 18 characters for one model call.
- [ ] 6.4 Fix the floor's path pattern: bare filenames in a directory listing are unprotected, and `index.ts` was dropped from a real `ls` result. Silent content loss is the failure this design exists to prevent.
- [ ] 6.5 Collapse the duplicated `resolveAuth` in `src/smart-compact.ts` into one shared helper once the reduction path has settled.
- [ ] 6.6 **Verification**: the placement decision is recorded with its measurement, and no cost claim appears anywhere that the evidence does not support.

## 7. Iteration 2 — build, test, analyse

> Decided in `design.md` § Iteration 2. Each item is one of the four changes; the section
> ends with a real session and an analysis, because iteration 1 shipped a cost claim that
> the first real session disproved.

- [ ] 7.1 **TDD**: failing tests first for minimum input size and minimum gain — a result below the size gate is never sent to the model, and a reduction that saves too little leaves the original in place.
- [ ] 7.2 Implement the size gate and the gain bar.
- [ ] 7.3 **TDD**: failing tests for decide-in-place — a message eligible in one event is never still pending in the next, whether it reduced or was verdicted.
- [ ] 7.4 Implement bounded in-place retry with the failure's root cause recorded, and verdict caching. A verdict must stop only the reduction call, never alter what the main model receives.
- [ ] 7.5 Implement a ceiling on the reduction so a hung provider cannot hang the session, returning messages untouched on expiry.
- [ ] 7.6 **Verification**: precommit green, and the per-session log distinguishes *not attempted*, *not worth it*, *failed (with cause)* and *reduced*.
- [ ] 7.7 **Final verification by the user**: run a real session, then analyse the per-session log together — cache misses, gain per reduction, verdict reasons — and decide whether the placement holds or moves to reducing before first send.

## 8. Iteration 3 — externalise the original, point at it

- [ ] 8.1 **TDD**: failing test that a kept reduction's content ends with a pointer naming a path, and that the path names a file which exists and holds the original **byte for byte**.
- [ ] 8.2 Write each kept reduction's untouched result to its own file beside the audit entry, raw, with no markdown wrapper.
- [ ] 8.3 Append the pointer line to the reduced content before it is cached, so the pointer is part of the write-once value and cannot differ between requests.
- [ ] 8.4 **Verification**: a real session produces reduced messages whose pointers resolve, and the originals match what the tool returned.
- [ ] 8.5 **Final verification by the user**: after a session, check whether the agent ever followed a pointer — and treat frequent read-backs as evidence the reduction is too aggressive rather than as success.

## 9. Iteration 4 — respect the compaction boundary

- [x] 9.1 **TDD**: failing test that a tool result inside the compaction-protected range is never reduced, and that one created after the compaction entry still reduces normally. Use the measured case as the fixture: compaction keeps three results (50590, 4423, 97 chars); none may be reduced.
- [x] 9.2 **TDD**: failing test that with no compaction present, behaviour is unchanged.
- [x] 9.3 Implement protection using declared API only — `getLatestCompactionEntry` and `CompactionEntry.firstKeptEntryId` via `ctx.sessionManager`. Do not hand-roll the "find the latest compaction" scan; the helper is exported. Cite the `buildContextEntries` doc comment in a code comment as the contract being relied on.
- [x] 9.4 Add a `compaction-protected` verdict so the log shows the rule firing rather than leaving its effect to be inferred from an absence.
- [ ] 9.5 **Verification**: precommit green, and a real session with both mechanisms enabled shows the kept tail surviving compaction intact. *(Precommit half done — 62 tests, typecheck clean, audit clean, re-run independently at 17:07. The real-session half was deliberately not done: the change is parked before it. See §10.)*
- [ ] 9.6 **Final verification by the user**: after a session that compacted, confirm from the audit log that the entries compaction kept were still whole when the next request went out.

### 9a. The first attempt at §9 was wrong and shipped green — recorded so it is not repeated

A delegated worker implemented §9.1–9.4, reported "Complete — precommit green, 61 tests
passing", and was correct on every process instruction: declared API only, contract quoted
in a comment, stateless derivation, distinct verdict, red-first evidence. **The logic was a
no-op in production.** Two independent defects:

1. **Ordering.** It derived the range from `buildContextEntries()`, which builds
   `[compaction, ...kept, ...after]` — the compaction entry is pushed *first*
   (`session-manager.js:213-224`). So `compIdx === 0`, `keptStartIdx === 1`, and
   `for (i = keptStartIdx; i < compIdx; i++)` ran zero times. The protected set was always
   empty. The code comment quoted the published contract correctly and the code beneath it
   assumed the opposite ordering.
2. **Index space.** It passed indices into *session entries* and applied them against
   *LLM messages*. `sessionEntryToContextMessages(entry)` returns 0..n messages per entry
   and custom entries yield none, so the two lists do not align. Fixing the ordering alone
   would have shifted protection onto the wrong messages, silently.

**Why the tests passed:** they handed `protectedIndices` in as literals (`new Set([0,1,2])`),
proving only that `reduceContext` skips what it is told to skip. The code that decides
*what* to skip had zero coverage.

**The lesson worth keeping:** green precommit plus a well-formed report plus full process
compliance is not evidence of a working feature. The defect was found by reading the
package's own implementation of the API being relied on, not by reading the diff.

**Intended fix (not present in the current workspace):**
`deriveProtectedToolCallIds(entries, compaction)` in `src/smart-compact.ts`, keyed by
`toolCallId` and derived from `getBranch()`. The current test imports this absent helper,
which makes TypeScript compilation fail. The preceding claims of independent verification
and a working parked implementation are superseded by this fact.

**Required if the track is reopened:** add end-to-end hook coverage. The pure reducer test
must not be accepted as proof that `turn_end`, `context`, session-branch derivation, audit
persistence, and the reducer model call are wired together.

## 10. Parked — 2026-08-12

**This change is parked and incomplete.** The research findings and pure-layer tests are
retained, but the extension wiring and boundary helper described above are absent. It must
not be enabled, represented as working, or merged into a releasable checkpoint as-is.

**Why it is parked:**

1. **The mechanism it is named for is not implemented.** The reducer signature is
   `reduce(text, toolName)` — it never receives the session's goal. What exists is generic
   noise-removal, not goal-oriented curation. Measuring it today would answer a question
   nobody asked. See `EVALUATION.md` § 2.
1a. **Measured locally on 2026-08-13, after parking: it harms.** Campaign `p01-20260813`,
   one fixture, both arms. ON cut per-request context by up to 79% and still **cost 63%
   more (0.1081 → 0.1760), drove `cacheRead` from 48,896 to zero, took 15 turns instead of
   7, and produced an empty final answer** where OFF produced a complete one. The cause is
   structural: write-once is per *message*, but each reduction edits the middle of the
   history and invalidates the *prefix* from that point — at `afterN=1` that is nearly
   every turn. `afterN` is therefore not a knob that can rescue it.
   See `findings/08-parcour-p01-off-vs-on.md`.
2. **The one hard external datapoint points at harm.** A paired campaign of 2,848 analysed
   provider-billed runs: removing 38% of raw tool-output tokens cost **6.8% more** (cache
   traffic being ~87% of cost), and aggressive compression cut successful patch application
   from **27/40 to 15/40**. That is this feature, measured by someone else.
3. **Answering it honestly is expensive** — the grid in `EVALUATION.md` is ~180 Docker runs,
   and cannot start until (1) is closed.
4. **A cheaper path to the same goal exists and already works.** Every handoff brief written
   during this change performed the same reduction — a few KB replacing a whole session's
   context — *with the goal in hand*, at a branch point rather than in flight. Pi already
   stores sessions as a tree (`getTree`, `getBranch`, `getLeafId`,
   `SessionManager.forkFrom`, `--fork`), so testing that idea needs no new code.
   Written up in `~/dev/concepts/deliberate-agent/docs/branch-point-context-discipline.md`
   and ruled in that repo's `docs/decision-log.md` **D51**.

**What would unfreeze it:** goal-conditioning the reducer (which also yields a free **ON−**
arm — ON with the goal withheld — pricing curation against plain shrinking), or evidence
from the branch-point experiment that in-flight reduction is still needed as a fallback for
sessions where branching did not happen.

**What is deliberately NOT parked:** `EVALUATION.md`. Its discipline — paired arms, never
pool results, cost per *successful* run, no LLM judge, explicit kill gates — was not written
for turn-reduce specifically and applies unchanged to whatever is measured next.
