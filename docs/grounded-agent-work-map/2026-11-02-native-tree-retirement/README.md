# Native tree retirement: work map (instance 2026-11-02)

**Main snapshot: 2026-11-02 10:05Z; one later lead report checked at 10:08Z.** Lead session last inspected entry `93d43e79` (10:04:05.031Z, index 414). The file grew to 436 lines by 10:09:32Z; entries 415–435 are not read or incorporated. Other sessions: checkpoints in [sources.md](sources.md). Work is live; this is a navigation aid, not a completion claim.

## At a glance

- **Goal:** `/retire` hides completed work with a context overlay. The user wants Pi's native `/tree` transport and prefers reusing its mechanism, hoping it may improve caching. The agent defines the summary. ([history](history.md); S1 `9199a1c2`, `273dcc42`)
- **Current step:** a *bounded spike* is coded but uncommitted (`src/native-tree-handoff.ts`, `test/native-tree-*.ts`). Plan `docs/native-tree-retirement-plan.md` is PROPOSED rev 5 (same sha256 `7bdec5dc…` at 09:51, 09:57 and 10:05Z), accepted only for the spike. Full `/retire` migration is not approved.
- **Progress since 09:54Z (lead's reports, not independently proven):** a live **print-mode** handoff and a prototype test suite passed, per the lead (`fa48c1dc`, 09:58). A **concurrency blocker** was reported: overlapping commands can share and clear pending handoff state (`04571171`, 10:01). An **overlap guard** with tests was reported as added; the isolated interactive check was started (`93d43e79`, 10:04). Reviewers are reported to be checking the final code.
- **Later lead report (10:08Z):** the TUI committed the handoff, the captured request contained it, and reload retained the new branch. Old-branch navigation and the footer capture remained under review (`885d2527`). These claims have not been independently checked here.
- **Reviews:** approvals (rev 4, "no blocker to a bounded spike") are from source reading only. No session I read reports a rev 5 review.
- **Cache benefit:** hypothesis. Nothing measured.
- **Top risks:** Pi version gap (1.4.0 runtime vs 0.99.1 harness); concurrency fix unverified; competing hooks can replace the summary (detected, not prevented); live runs need their own session directory. Details: [current-state.md](current-state.md).

## Files

| File | Use it for |
|---|---|
| [history.md](history.md) | How the work developed: timeline (Mermaid + text) with entry IDs |
| [current-state.md](current-state.md) | Claims by evidence status, decisions, reviews, risks, next steps |
| [agent-topology.md](agent-topology.md) | Panes, sessions, roles and relationships, with a live snapshot |
| [sources.md](sources.md) | Source IDs, checkpoints, hashes, what was and was not read, corrections |
| [metadata.json](metadata.json) | Machine-readable session inventory (22 listed sessions, see below) |

Decisions and open questions are kept in [current-state.md](current-state.md). The set is small and shares evidence; split them if it grows.

Source IDs (`S1`–`S6`, `D1`–`D4`, `P1`, `G1`, `L1`, `M1`, `SC1`) are defined in [sources.md](sources.md). Labels: **verified** (I checked it), **reported** (a session or doc states it; not confirmed), **unverified** (no evidence yet), **hypothesis** (inference).

## Metadata and session inventory

- [metadata.json](metadata.json) lists **22 Pi sessions** (generated 2026-11-02T09:59:45Z), plus one pane launch with no session file (`w1:p8`) and three unlisted candidates. It is a snapshot; this map does not edit it.
- **Links are inferred.** Pane-to-session links are never verified by the files: 20 sessions carry an inferred link from an ownership record; 2 have none (lead and memory-steward). Roles are inferred from prompt text.
- **Incomplete.** `completeness_claimed` is `false`. Discovery finds *candidates*, not proof of participation. A passing check does not prove that all relevant sessions were found.
- **Validator result at my check (~10:05Z):** 0 errors, 3 warnings. Two of the warnings are new in-scope session files not yet recorded (`01a19bb5…` at 10:01:46Z, pane `w1:pT`; `01a19bb8…` at 10:04:56Z, pane `w1:pW`). The third is the file count (25 at scan vs 27 now). An earlier check reported 2 warnings; the scope has since changed.
- Script: [inventory_work_sessions.py](../../../agent/scripts/inventory_work_sessions.py). Its unit tests: [test_inventory_work_sessions.py](../../../agent/scripts/test_inventory_work_sessions.py) (28 tests, OK at 10:05Z).

## Scope

- Included: lead session `S1` (partly, see [sources.md](sources.md)), reviewer sessions `S2` and `S3` (not re-read in this update), implementer session `S4` (selectively, earlier reads), the sessions of panes `w1:pT` and `w1:pW` (`S5`, `S6`; metadata and validator only), four docs, the Pi runtime checks from 09:51–09:57Z (not repeated), the pane list at ~10:05Z, and `metadata.json` plus its validator.
- Not included: most of the content of `S2`–`S6`; the other sessions in today's directory (listed in [sources.md](sources.md)); live tests; other repository files.

## How to resume

1. From the repository root, run the validator (read-only; it does not write the metadata):

   ```bash
   python3 agent/scripts/inventory_work_sessions.py docs/grounded-agent-work-map/2026-11-02-native-tree-retirement/metadata.json --candidates
   ```

   Exit codes: `0` no errors (warnings allowed), `1` validation errors, `2` unreadable metadata or usage error. A pass does not prove completeness. Re-run once a live writer has flushed if a partial line is reported.
2. Re-run the pane list (read-only, `herdr pane list`) and compare with [agent-topology.md](agent-topology.md).
3. For each session in [sources.md](sources.md), confirm the checkpoint entry ID still exists. A `/tree` navigation branches inside the same JSONL file, so do not assume the checkpoint is the last line. Read every later entry by ID and timestamp.
4. Recompute `sha256` for each doc and for `metadata.json`. If one changed, reread the whole doc.
5. Add new sessions as new sources. Do not fold them into old checkpoints. Update `metadata.json` with evidence and uncertainty for newly identified participants; then re-run step 1.
6. Only then update the affected claims in [current-state.md](current-state.md).
