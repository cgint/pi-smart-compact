# Current state: claims, decisions, risks, next steps

Checked through 2026-11-02 10:05Z (lead session last entry `93d43e79`, 10:04:05Z; other reads as listed in [sources.md](sources.md)). Work is live; the state may have changed. Labels: **verified** (I checked it), **reported** (stated in a session or doc, not confirmed), **unverified** (no evidence), **hypothesis** (inference). Lead reports after 09:54Z are **reported** unless marked otherwise.

## Goal and decisions

| Item | Status | Source |
|---|---|---|
| User wants `/retire` to work like Pi's `/tree`, with the same mechanism and caching; the agent defines the summary | **verified** (user) | S1 `9199a1c2` (08:21:09) |
| Optional `/retire` text: interpretation is that it expresses what remains salient or happens next, not a boundary, goal, or count. The agent independently selects the boundary under the existing contract. | **interpretation**, not a user correction; confirm if needed | S1 `9199a1c2`; D3 |
| Native `/tree` is the transport and back-in-history strategy | **verified** (user) | S1 `273dcc42` (09:16:37) |
| Honest, first-class, no hacks; reconsider if it feels hacky | **verified** (user) | S1 `e1188865` (09:23:50) |
| Plan first, persist and review it, then implement and live-verify with `pi -ne -e index.ts`. Runtime proof, not theory | **verified** (user) | S1 `1b7a1b20` (09:31:58) |
| Only a bounded spike is accepted; full `/retire` migration is out of scope | **reported** (lead's decision in D1 "Status" and "Review status") | D1 |
| Option A (hook-computed or timing-based summary) rejected; Option B (agent proposes target and handoff; user runs explicit command; our hook supplies or cancels the summary; verifier checks) is the spike candidate | **reported** (lead decision; reviewers reported the same hazards) | D1 "Options"; S2 `31901a44`; S3 `bb226eef` |
| One-command flow withdrawn | **reported** (lead) | S1 `85255889` (09:31:58) |
| The lead asked the user to confirm the semantic change: current work leaves the active branch and continues through the summary, not verbatim. No explicit answer found in the ranges read | **unverified** (user acceptance) | S1 `e5453b86` (09:23:13) |

## Progress since 09:54Z (lead session, reported)

| Claim | Status | Source |
|---|---|---|
| The prototype passed its current automated tests and a live **print-mode** handoff, including a follow-up that recovered a marker from the new branch summary. Not yet the requested TUI or direct request-payload verification | **reported** (lead) | S1 `fa48c1dc` (09:58:23) |
| In the print-mode step, the resumed model answered `zebra-7` (implementer console, quoted in the lead's tool result, truncated) | **reported**; not read by me in full | S1 `80da55e3` (09:58:05) |
| Concurrency gap: overlapping commands can share and clear pending handoff state. Source-supported, not reproduced. The lead treats it as a blocker | **reported** (lead). Reviewer `w1:pD`'s console (S1 `fecd41bd`, 10:01:17) describes the same mechanism (`finally` at line 606). Reviewer `w1:pC` could not reproduce it, since read-only discuss mode blocked the driver; its analysis is static (S1 `ab4f9a5d`, 10:00:43) | S1 `04571171` (10:01:13) |
| Overlap guard added; tests deliberately pause one command and reject a second. No pass counts stated | **reported** (lead) | S1 `93d43e79` (10:04:05) |
| Isolated interactive check started; reviewers checking implementation | **reported** (lead) | S1 `93d43e79` |
| TUI committed the exact handoff, captured request contained it, and reload retained the new branch; old-branch navigation and footer capture still being checked | **reported** (lead; independently unverified) | S1 `885d2527` (10:08:37) |
| Implementer `w1:pG` says it did not create `artifacts/native-tree-handoff/tui` or `agent/scripts/inventory_work_sessions.py` and flags them as someone else's work | **reported** (pG console, lead read) | S1 `4436f807` (10:03:57) |

Not verified by me: the concurrency fix's correctness, any test count after 09:53, and the print-mode result.

## Design facts

| Claim | Status | Source |
|---|---|---|
| `navigateTree(targetId, options)` at `dist/core/agent-session.js:3261`; `session_before_tree` emitted at lines 3302–3305 (Pi 1.4.0) | **verified** by me, 09:51Z; not re-checked in this update | P1 |
| A later competing hook can replace our summary. Detection after the fact only; fail-closed not claimed | **reported** (reviewer reading of Pi source; plan limitation 2) | S2 `5011194e`; D1 "Open questions" 2 |
| An escaping throw from our handler lets Pi's default summarizer run | **reported** (reviewer-cited `runner.js:830`; plan row 2b, a known hazard) | S2 `4c463301`; D1 "Verified facts", row 2b |
| S2 `4c463301` corrects an earlier claim: the TUI shows extension errors (`showExtensionError`), so navigation is not silent. The default-summarizer fallback still stands | **reported** | S2 `4c463301` |
| Command-facing `navigateTree` returns only `{cancelled}` | **reported** (reviewer-cited `types.d.ts`; not re-checked) | S2 `0cf55308`; D1 "Verified facts" |

## Evidence of behaviour

| Claim | Status | Source |
|---|---|---|
| Meter 16.1% to 17.0% after `/retire` in pane `w1:p9`; receipt created. Agent: not a controlled measurement; does not prove the reduced context reached the model | **reported** (not measured by me) | S1 `0c2f3471` (09:13:49) |
| Meter 17.0% back to 16.1% after `/tree`. Agent: footer may show an earlier usage record | **reported** | S1 `61138ee4` (09:15:32) |
| Overlay silently fails on Pi 1.4.0 | **unverified** (agent says so) | S1 `f646b32f` (09:21:01) |
| Harness: 19 tests, 2 failing at 09:51:07; then 20 passing, 23 passing (includes a competitor-throw proxy, see Risk 3), 20 passing | **reported** (test output in session text; not run by me) | S4 `3896d98c`, `f807ceef`, `f1f2897c`, `17358c73` |
| Overlap-guard tests (after 10:01) | **reported**, counts not stated | S1 `93d43e79` |
| Harness runs on the local 0.99.1 SDK with a faux provider. The implementer calls this "real runtime 0.99.1"; the plan's runtime under test is 1.4.0 | **reported**; `node_modules` 0.99.1 confirmed by me | S4 `b1602a71`, `6a983a9b`; P1 |
| Live print-mode handoff with a real model (command in S4; marker recovered from the new branch summary) | **reported** (lead `fa48c1dc`; implementer console). Not verified by me. Runtime version of this run is not stated in the entries I read | S1 `fa48c1dc`, `80da55e3` |
| Plan row 1 gate: live model, provider payload, footer on the 1.4.0 runtime | **open**. TUI and request-payload checks are reported, but remaining evidence and independent review are pending | D1 row 1; S1 `fa48c1dc` |
| Cache benefit of native `/tree` | **hypothesis** (D1: "[hypothesis] only; no cache claim"). Reviewer A reports that summary generation sets `cacheRetention: "none"` (`compaction.js`), so no summary cache is written. Reported, not verified. No cache-read metric in the plan matrix | D1 "Verified facts" and "Open questions" 12; S2 `ca38e02d` |

## Reviews: approvals versus proof

| Reviewer | Latest verdict in the session | Basis |
|---|---|---|
| S2 reviewer A (`w1:pD`, state `done` at 10:05Z) | Rev 4: "No blocker to a bounded implementation spike" (`a578298c`, 09:40:16). Drafted a live-verification procedure, not run (`ab7dce86`, 09:44:31). Prompted again by lead at 09:58 and 10:01 (S1 `a58036cd`, `bb33f951`, `353530f1`); its replies after 09:44 are not read | Source reading and docs |
| S3 reviewer B (`w1:pC`, state `done` at 10:05Z) | Rev 4: "No blocker to the bounded spike", after text edits to the matrix (`97471293`, 09:40:14). An earlier verdict (`257bd6e6`, 09:28:39) was "needs-changes" and says "I ran nothing dynamic". Reported in S1 (`ab4f9a5d`) as unable to run a reproduction in read-only mode | Source reading |

- The approvals are for **rev 4**. D1 says re-review of rev 5 is pending (D1 "Status" and "Review status"). No session I read reports a rev 5 review.
- Whether the two requested matrix text edits were applied is **unverified**.
- No reviewer has been reported as running a live test. The lead's acceptance is "conditional on real runtime verification" (D1 "Status"). That condition is open.

## Risks

1. **Version gap.** D1 names Pi 1.4.0 as the runtime under test. The harness runs on 0.99.1 (`node_modules`). `package-lock.json` pins `pi-coding-agent` 1.0.0 (line 446). Implementer's thinking (S4 `598cca2c`, 09:53:27) raises a possible module mismatch for the live 1.4.0 run. It notes `typebox` is a runtime import and judges the `pi-coding-agent` imports type-only. *Unverified.* A pass on 0.99.1 is not a pass on 1.4.0.
2. **Live proof is partial.** A print-mode run is reported (`fa48c1dc`). The lead subsequently reported the TUI handoff and request payload (`885d2527`); old-branch navigation and footer capture remained under review, so full row 1 evidence is not yet established here. Authorization: the user authorized implementation and live verification with `pi -ne -e index.ts` (S1 `1b7a1b20`). The sources show no per-run approval gate, and this map does not add one. Precautions: the minimal live prompt first (D1 precondition 1), and a fresh `--session-dir` (Risk 5).
3. **Concurrency fix unverified.** The lead reports a blocker (`04571171`) and a guard with tests (`93d43e79`). I have not read the code or the tests. Reviewer `w1:pD`'s console describes the same mechanism. *Hypothesis:* an overlap guard covers the reported race, but only an independent check of the final code and a reproduction can confirm it.
4. **Proxy may not cover row 2b.** Row 2b is "our handler throws, real runner, no stub" (D1). The implementer's 2b "proxy" is a competitor that throws (S4 `f1f2897c`). *Hypothesis:* the proxy does not cover row 2b as written.
5. **Shared working directory.** Eight panes in the list at 10:05Z share cwd `pi-smart-compact`, including live `w1:pT` and `w1:pW`. Reviewer A saw six live Pi panes in the same cwd, so `--continue` could attach to another session (S2 `ab7dce86`). Live runs need their own `--session-dir`.
6. **Competing hooks and fallback** are detected, not prevented (D1 limitation 2). Escaping throws can run the default summarizer (see Design facts).
7. **Stale plan status.** D1 "Review status" says "Implementation: not started". The sha256 of D1 is unchanged since 09:51Z (`7bdec5dc…`), so the line is still stale in the file. The implementer started at 09:41.
8. **Semantic change unconfirmed** (see Goal and decisions table; `e5453b86`).
9. **Unknown actors and panes.** At 10:05Z: `w1:pF`, `w1:pV` and `w1:pW` are working with unknown roles or owners. `w1:pT` is `tree-live-check` in the lead's ownership record (`2309d132`); its content is unread. Absent: `w1:p9` (user pane, since 09:44), `w1:pA`, `w1:pB`, `w1:pE`, `w1:pM`. S1 `context_edit` entries `3f08c7be` and `3582a238` (09:24) have `replacement: null`; their effect is not interpreted.
10. **Lead compacted its context at 10:01:05** (`d9c804a8`). Its summary is not checked here. Treat it as the lead's self-description, not evidence.
11. **Inventory incomplete.** `metadata.json` (22 sessions) does not list the two newest in-scope session files (`w1:pT`, `w1:pW`), and its scan count is 25 files vs 27 now. See [README](README.md) and [sources.md](sources.md).

## Next steps (in order)

1. Read the final code and tests for the overlap guard, and get a reviewer to check it. Do not accept the lead's report alone. Owner: lead and reviewers.
2. Inspect the reported TUI and request-payload evidence, finish old-branch navigation and footer checks, and assess plan row 1.
3. Resolve the version gap: run the harness on Pi 1.4.0, or document the gap as a limitation and state that row 1 must run on 1.4.0.
4. Ask for a re-review of **rev 5** and the code.
5. Update D1 "Review status" and "Implementation" lines. Add a cache-read metric to the matrix or drop the cache claim.
6. Ask the user to confirm the `/retire` semantic change and whether `w1:p9` should be restored.
7. Update the inventory for newly identified sessions, including `w1:pT` and `w1:pW`, with evidence and uncertainty; re-run the validator.
8. Read the unread sessions listed in [sources.md](sources.md) before claiming full coverage.
