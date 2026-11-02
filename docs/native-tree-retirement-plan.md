# Native tree retirement — shared design draft (rev. 5)

## Status

**PARTIAL SPIKE. Implemented behind an opt-in flag; evidence and review gaps remain. The spike pass gate is not met, and precommit fails on the dependency audit (8 vulnerabilities). Not production or full migration.**

Reviewer record (as reported; the lead has not accepted them as proof):

- `w1:pC` — happy to proceed with a bounded spike. Requires that competitor-order rows run through the **real Pi SDK `AgentSession` and real extension runner**, with stubs only for our caught-error and I/O injections. Records model compliance, summary parent, and cost/credentials as runtime risks, not blockers. Does **not** endorse full `/retire` migration.
- `w1:pD` — happy to proceed to implementation and live evidence, with documented limitations. Requires a minimal live prompt before any matrix row, early runs of row 2b and metadata classification, and artifacts saved per row. Stop and report if row 1's `fromHook` or payload check fails; do not restate the criterion to pass. Does **not** endorse full `/retire` migration.
- Both reviewers reported subsequently reviewing rev. 5 and the implementation. They reported accepting the single-flight fix for the overlap defect, but did not endorse a full migration. Reviewer findings and remaining gaps are recorded below.

Lead acceptance: **for a bounded implementation spike only**, conditional on real runtime verification in the matrix below. Not acceptance of full migration, and not acceptance that the design is proved.

Labels: **[confirmed]** = seen in source or runtime, anchor given; **[reviewer-cited]** = cited by a reviewer, not re-read by the author; **[reported]** = prior investigation; **[proposal]** = design choice, not user-approved; **[hypothesis]**; **[unverified]**; **[open]**.

## Requirements

**User requirements (as the lead reports them):**
- Use Pi's native tree navigation (`navigateTree`) to return to an earlier point.
- The active line continues from an **agent-authored** continuation, not raw side-branch content and not Pi's default LLM summary.
- The agent independently chooses the boundary.
- Optional `/retire` text is not a boundary, count, or goal.
- The original branch is preserved. Pi metadata entries may be added.

**Lead decisions [proposal], not user-confirmed:**
- A literal `/tree` gesture is not required; a command that calls native `navigateTree` is acceptable.
- No forced user confirmation. The user runs an explicit command that shows an informative proposed target. A UI confirmation is **recommended** for the spike when UI is available; it must be presented as a confirmation of the exact target and handoff, never as anything else.
- LLM calls are not prohibited. The requirement is exact agent-authored text.

**Scope:** stage 1 is a bounded command prototype for a non-user ancestor target. Stage 2 (`/retire` migration) is out of scope and is not endorsed.

## Related work (cited, not duplicated)

- `docs/goal-conditioned-branch-carry-back.md` — motive and requirements.
- `docs/anchored-episode-retirement.md` — current `/retire` contract.

Prior observation [reported]: a `/retire` run moved context from 16.1% to 17.0% and persisted a receipt. This does **not** show overlay reduction failed; that is **[unverified]**.

## Verified facts

Pi 1.4.0 global install, `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent` (version in `package.json` [confirmed]). The automated harness initially used local SDK 0.99.1; `npm ci` restored the lockfile's SDK 1.0.0, against which typecheck and all tests subsequently passed. Neither version is the global 1.4.0 runtime used for the live TUI.

- `dist/core/agent-session.js:3261` — `navigateTree(targetId, options)`. Throws while streaming or compacting. No-op if target equals current leaf. Throws if `summarize` is set without a model (throw at :3274–3275 [reviewer-cited]).
- `:3302–3305` — emits `session_before_tree` with `preparation` (`targetId`, `oldLeafId`, `commonAncestorId`, `entriesToSummarize`, `userWantsSummary`, mutable `customInstructions`, `replaceInstructions`, `label`) and an abort `signal` [confirmed].
- Same function [reviewer-cited]: `result.cancel` returns `{cancelled:true}` at :3309, before any write and before the `session_tree` emit at :3406. `result.summary` is used only if `options.summarize`. The default summarizer runs when no extension summary was supplied (:3331).
- Details persistence [reviewer-cited]: :3358–3360 copies the extension summary's `details`; :3384 writes the entry with `fromExtension` as `fromHook`. `fromHook` is true for any supplier, so it cannot identify ours.
- Command-facing `ctx.navigateTree` returns `{cancelled}` only [reviewer-cited: `types.d.ts:1698–1705`]. A non-cancelled result alone does not prove success.
- `session_tree` carries `newLeafId`, `oldLeafId`, optional `summaryEntry`, `fromExtension` [reviewer-cited: `types.d.ts:657–669`].
- Runner: last truthy hook result wins; early `cancel` short-circuits [reviewer-cited: `runner.js:814–823`, `:820–821`]. An escaping handler exception is swallowed and the default summarizer can run [reviewer-cited: `runner.js:830`].
- `before_provider_request` [confirmed: `dist/core/extensions/types.d.ts:694`, registration at :1203].
- `ui.confirm` and `ui.select` exist [reviewer-cited: `types.d.ts:74`, `:76`].
- Provider-facing shape: the model sees Pi's prefix and suffix around summary text [reviewer-cited: `messages.js:13–16`, `:97–103`].
- Extension registration [confirmed]: `index.ts:4` imports `registerRetirePrompt`; `index.ts:9` calls it. `src/episode-retirement-prompt.ts:7–9` is gated on `EPISODE_RETIREMENT_ENABLED_VAR === "true"` and registers `resources_discover` with `promptPaths`. `/retire` is a prompt template, not a command.
- Live provider: `~/.pi/agent/auth.json` exists [reviewer-cited]; whether a model responds is **[unverified]** until precondition 1 passes.

Cache: **[hypothesis]** only; no cache claim.

## Target semantics (spike scope)

- **In scope:** a validated **non-user ancestor** on the current path (for example an assistant message).
- **Out of scope:** user-message targets (navigating there moves the parent and prefills the editor) and root targets.
- The summary entry's parent must equal `targetId`. This is an expectation, **not yet verified**; row 1 must check it. If it fails, the criterion is restated with evidence, not dropped.

## Handoff, freshness, and effectful calls

- The agent authors the handoff with a `handoff_record` tool. Its tool-result `details` store `{ schema, handoffId, targetId, text, sha256 }`.
- `handoffId` is a **UUID**. `sha256` is SHA-256 over the **UTF-8** bytes of `text`.
- **Freshness:** a handoff record is valid only within its own tool turn: the record's tool result, plus the normal final assistant response of that same turn.
- **Effectful tool call** is defined as: **any tool call after the record whose effect or identity cannot be shown irrelevant to the authored continuation.** The command does not use a blind list of allowed tools or entries. It rejects if any such call occurs after the record and before the navigation.
- A later user message is also rejected.
- We do **not** assume `terminate` ends the turn, and we do **not** require that only metadata follows the record.

### Metadata classification

Post-record entries that are not tool calls or user messages are classified **from Pi's session-manager source and from observed test turns**, not from a blind allowlist. Any entry type not classified as metadata by that process is a rejection cause. The classification list is an artifact of the spike, not a claim in this document.

## Model skips or fails the handoff

- If the model does not call `handoff_record` in the expected turn shape (no record, or a record without a final response in the same turn), the **command rejects and reports "no valid handoff"**. No navigation is attempted.
- This is reported as a **rejection**, not as a failure of the navigation mechanism.
- The rejection report states what was found (for example: no record, malformed record, record superseded).

## Safety model

**Our `session_before_tree` handler**, driven by the pending record:

| Situation | Handler returns | Reason |
|---|---|---|
| Pending exists, and event matches target and old leaf and requests a summary | `{ summary: text }` | Supply agent text; Pi's preparation event has no `handoffId`, so the verifier checks it after commit |
| Pending exists, and event does not match | `{ cancel: true }` | Prevent default summarizer |
| Pending exists, and our handler catches its own internal error | `{ cancel: true }` | Our error, our decision |
| No pending (ordinary `/tree`, or `summarize:false`) | `undefined` | Native behaviour; explicit no-op, not a fallback |

- **Escaping throw** from our handler (not caught by us): the runner swallows it and the default summarizer can run [reviewer-cited]. This is a known hazard recorded as a failure mode, not a pass.
- **Competing handlers** are outside our control. Last truthy result wins; early cancel short-circuits. Detection is after the fact. **Fail-closed against competitors is not claimed.**
- **Success is not "navigation not cancelled".** Success requires the post-commit verifier to confirm: summary entry `details.handoffId` and `sha256` match the pending record; `fromHook` is true; text equals the recorded text; parent equals `targetId`.

## Pending state and invocation

- Preflight runs first. Once preflight passes and pending is set, `navigateTree` is invoked with **no intervening `await`**.
- Pending holds immutable `text`, `sha256`, and `handoffId`, and is memory-only. It is cleared in `finally`. A single-flight guard is claimed synchronously before any command await and released in a surrounding `finally`; an overlapping command is rejected rather than queued.
- Restart leaves nothing pending.

## Outcome classes

- **Pre-commit rejection** (no model, target equals leaf, invalid target type, no valid handoff, stale or mismatched handoff, effectful or later-user entries after record, leaf differs from recorded old leaf, streaming/compacting): rejected before `navigateTree`, or thrown before any write. Session file verified unchanged.
- **Success:** verifier criteria above hold.
- **Collision:** a competitor's summary or non-summary fallback committed.
- **Cancellation:** `{cancelled:true}`; no `session_tree` emitted.
- **Uncertain:** an I/O or write error where state cannot be confirmed by re-reading the session file. Not called definitively post-commit; no atomicity claimed.
- A thrown `ctx.navigateTree` is reported with what the verifier finds; pending is cleared in `finally` regardless.

## Options

### Option A — Hook-computed or timing-based summary (rejected)
Obtaining text inside the hook or through a timing sequence has lifecycle hazards [reported] and invites hidden work during navigation.

### Option B — Agent-proposed target and handoff, then explicit user-run navigation (spike candidate)

1. **Inspection (agent):** proposes a safe non-user ancestor (agent inference).
2. **Handoff turn (agent):** authors exact text for that target and calls `handoff_record` within the freshness rule.
3. **Settle:** the command reads the branch after the turn settles.
4. **Explicit user command:** the user runs a command with `handoffId` (spike: command argument). The command shows the proposed target (entry id, type, short excerpt) and the handoff SHA-256. With UI available, a confirmation is recommended and is labelled as confirming this exact target and handoff. Without UI, the command proceeds only on explicit invocation and reports that no confirmation was shown.
5. **Preflight** (pre-commit checks). Records old leaf.
6. **Pending** (memory-only, one-shot, set immediately before navigation, cleared in `finally`).
7. **`navigateTree(targetId, {summarize:true})`**, no intervening `await`.
8. **Our hook** supplies or cancels per the safety table.
9. **Verifier** reads `session_tree` and the branch and classifies the outcome.

### Option C — Native summarizer with custom instructions (alternative)
Rejected for the requirement: the text is not agent-authored.

### Option D — Upstream supplied-summary option on `navigateTree` (future)
Keeps the native mechanism. Writing session entries directly is **rejected** as a bypass.

## Test architecture

- **Competitor-order rows (3a–5b) run through the real Pi SDK `AgentSession` with the real extension runner.** Extensions are registered in a **fixed order** through extension factories. No stubbed runner. These rows test Pi's real last-truthy and early-cancel behaviour, not our stubs.
- **Stubs are permitted only at two injection points**, both of which are our own code paths:
  - **Row 2a:** the verifier dependency (or the handler's internal step) is injected to throw. The throw happens inside our `try`, so the caught-error path is exercised.
  - **Row 18:** the session-file writer or re-read dependency is injected to fail, to model an I/O error.
- The **exact injected dependency name** is recorded in the spike's artifacts **when the implementation exists**. This document does not name a dependency that has not been written.
- **No production fault-injection flag or env var** exists or is permitted for these injections.
- **Faux provider** may be used for deterministic rows that do not need a live model.
- **Live model** is required for row 1 (provider payload and footer) and must be recorded with model and provider names.
- Registration order is controlled by the factories in the harness; the real `-e` argument order effect is **[unverified]** and not relied on.

## Runtime evidence matrix (command prototype)

Each row records: session `.jsonl` before and after (byte comparison of old entries), active leaf before and after, `session_tree` event or its absence, summary entry (`details`, `sha256`, `fromHook`, parent), outcome class, and artifacts saved in the spike's own test folder.

| # | Case | Expected outcome |
|---|---|---|
| 1 | Happy path, live model: handoff, preflight, navigate, verify | **Success.** Summary entry parent == `targetId` (checked); `details` match pending `handoffId`/`sha256`; `fromHook` true (checked); text equals recorded text; old entries byte-identical; reload shows same state; subsequent live turn's **provider payload** captured via `before_provider_request` with summary inside Pi's wrapper; **TUI footer** pane capture before and after, including the subsequent turn. Model and provider names recorded. If `fromHook` or parent check fails, stop and report; criterion not restated to pass. |
| 2a | Our handler's caught internal error, via injected verifier dependency inside our `try` | Handler returns cancel → **cancellation**; no `session_tree`; leaf unchanged |
| 2b | Escaping throw from our handler (real runner, no stub) | **Known hazard**: default summarizer may run; recorded as failure mode, not success |
| 3a | Competitor registered **before** ours (real runner), returns summary | Ours overwrites it (last truthy) → **success** with our details |
| 3b | Competitor registered **after** ours (real runner), returns summary | **Collision** (competitor summary, not ours) |
| 4 | Competitor registered after ours, returns truthy non-summary | **Collision**: default LLM fallback committed |
| 5a | Competitor cancels, registered before ours | **Cancellation**; no `session_tree` |
| 5b | Competitor cancels, registered after ours | **Cancellation**; no `session_tree` |
| 6 | Handoff absent, malformed, or SHA-256-mismatched; or the command selects a `handoffId` that is not the latest handoff record on the current path (superseded) | Pre-commit rejection; no navigation; session unchanged |
| 7 | Restart after handoff, before command | Nothing pending; command re-validates from file; no silent resume |
| 8 | Original branch | Side-branch entries byte-identical in `.jsonl` |
| 11 | Ordinary `/tree` with no pending, and `summarize:false` | Hook returns `undefined`; **native behaviour** |
| 12 | Post-record entries of non-tool, non-user types | Classified from source and observed turns; rejection only if unclassified |
| 13 | No model configured | Rejected **before** navigation call; no hook invoked |
| 14 | Target equals current leaf | Rejected **before** navigation call |
| 15 | `navigateTree` invoked while streaming | Throws; pending cleared in `finally`; report states outcome |
| 16 | Later user message, or any effectful tool call after record | Rejected pre-commit |
| 17 | Final assistant response in same tool turn as record | Allowed |
| 18 | Injected session-writer or re-read failure | Outcome **uncertain** unless re-read confirms state |
| 19 | Model produces no `handoff_record` (or no same-turn final response) | Command rejects with "no valid handoff"; no navigation; reported as rejection, not mechanism failure |

**Early run order (preconditions):**
1. A minimal live prompt through `pi -ne -e index.ts` succeeds before any matrix row.
2. Row 2b and the metadata classification run early, so their results inform later rows.

**Pass gate for the spike:** rows 1, 2a, 3a, 3b, 4, 5a, 5b, 6, 7, 8, 11, 13, 14, 16, 17, 19 observed with artifacts; row 2b recorded as a known hazard; rows 12, 15, 18 observed with artifacts. Row 1 is mandatory with live model, payload, and footer. Passing the gate is evidence for the bounded spike only, not proof of the design.

## Open questions and limitations

1. **Target selection UX:** command argument for the spike; picker deferred. [open]
2. **Competitor mitigation:** detection and reporting only; fail-closed not claimed. [limitation]
3. **Handoff expiry:** not required for the spike. [open]
4. **Real `-e` registration order:** controlled by factories in the harness; the `-e` effect is [unverified]. [open]
5. **Escaping-throw path:** our own escaping throw remains unobserved (row 2b); a competitor-throw proxy is not equivalent. [open]
6. **Metadata classification:** completed from source and observed turns; not claimed in advance. [open]
7. **Same-turn shape:** covers observed turn shapes only; other shapes [unverified]. [limitation]
8. **Summary parent and `fromHook` for the extension path:** verified in the live TUI handoff. [confirmed]
9. **Live model availability and cost:** two providers responded during synthetic tests; future availability and cost remain variable. [confirmed for tested runs]
10. **I/O uncertainty:** no atomicity claim; uncertain outcomes reported as uncertain. [limitation]
11. **Stage 2 `/retire` migration:** not endorsed; mapping undefined. [open]
12. **Cache benefit:** hypothesis only. [limitation]

## Implementation and evidence (2026-11-02)

- Opt in with `PI_NATIVE_TREE_HANDOFF_ENABLED=true`; `index.ts` then registers `src/native-tree-handoff.ts`, two agent tools and `/tree-handoff <handoffId>`. Existing `/retire` remains unchanged. This is a spike, not a user-facing migration.
- Independent review found a pre-await overlap race; the implemented synchronous single-flight guard and real-runner gated test address it. Both reviewers reported checking the fix. Row 14's command-level leaf case is structurally unreachable for a valid record; its record-tool guard is tested.
- Automated evidence: after `npm ci --ignore-scripts`, locked SDK **1.0.0**, `npm run precommit` passed typecheck and **248/248 tests** (see `artifacts/native-tree-handoff/precommit-final.log`), but failed audit with **8 vulnerabilities (4 moderate, 4 high)**. Do not equate this with the 1.4.0 runner. The lockfile was not upgraded.
- Live Pi **1.4.0** TUI, `github-copilot` / `gemini-3.8-flash`: exact agent text was committed in a `branch_summary` under target `7ecaab79`, with `fromHook: true` and matching handoff details; captured subsequent `before_provider_request` payload includes the text inside Pi's branch-summary wrapper. Original session bytes remained a prefix; a fresh reload displayed the new branch; `/tree` navigation to the old branch and back worked. Synthetic private evidence is in ignored `artifacts/native-tree-handoff/tui/`. A prior print-mode run used `qwen38-cloudrun` and independently recovered a summary-only marker.
- Footer: the first run's immediate captures were truncated. A second full-width live run captured **4.3%/256k** after the handoff turn and before the command, **4.2%/256k** immediately after navigation, and **4.2%/256k** after a follow-up; see `artifacts/native-tree-handoff/tui/run2/evidence/`. That second run also committed `fromHook: true` under its selected target and captured the summary wrapper in the next provider payload. These tiny synthetic runs do not establish cache savings.
- Important Pi behavior: navigation without appending an entry does not persist the selected leaf across reload. After adding a turn on the old branch, reload resumed that last-appended branch even after in-memory navigation back to the handoff branch.
- Remaining gate gaps: row 2b (our own escaping throw) was not observed; a competitor's throw is only a proxy. Metadata types are only partly exercised through real turns. Most deterministic collision/order tests use SDK 1.0.0, not live Pi 1.4.0. The complete footer captures are from the second synthetic run, not the first. Existing plan claims requiring handoffId in the preparation event are corrected above; the event exposes no such field. Pre-existing bytes and our summary are checked, but extra appended entries are not rejected by the file verifier.
- No UI confirmation is available in non-UI mode; explicit invocation is the authorization. Non-UI outcomes and rejections are written to stderr. UI confirmation has a 120-second timeout in both TUI and RPC; timeout is treated as declined. The behavior is tested with a harness stub, not a real unanswered RPC client. Competing handlers may still override the hook and can only be detected after navigation. Summary quality and cache performance remain separate unproven questions.

## References

- `docs/goal-conditioned-branch-carry-back.md`
- `docs/anchored-episode-retirement.md`
- `index.ts:4`, `index.ts:9`
- `src/episode-retirement-prompt.ts:7–9`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:3261, 3302–3305`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:694, 1203`
