# Sources and checkpoints

Checked 2026-11-02 09:50–10:05Z. A checkpoint says what I read. It does not mean the whole file or session was covered. Ranges are 0-based JSONL line indexes (line N is the entry at index N). Entry IDs are the `id` field of each entry.

## Source IDs

| ID | Source | Kind |
|---|---|---|
| S1 | `~/.pi/profiles/minimal/agent/sessions/--Users-christian.gintenreiter-dev-external-pi-smart-compact--/2026-11-02T08-14-54-170Z_01a19b53-5cd9-7313-97de-2b907fef684b.jsonl` | Lead session (main), **still growing** |
| S2 | same directory, `2026-11-02T09-24-30-566Z_01a19b93-16e5-74fe-b348-c61bb508ad4b.jsonl` | Reviewer A (pane `w1:pD`), now `done` |
| S3 | same directory, `2026-11-02T09-24-30-586Z_01a19b93-16f9-71cb-8855-6df4bc7f3657.jsonl` | Reviewer B (pane `w1:pC`), now `done` |
| S4 | same directory, `2026-11-02T09-41-23-094Z_01a19ba2-8a15-752d-aa28-056e9417a817.jsonl` | Implementer (pane `w1:pG`), now `idle` |
| S5 | same directory, `2026-11-02T10-01-46-553Z_01a19bb5-3538-7413-8a14-3098aeadb78e.jsonl` | Pane `w1:pT` (`tree-live-check`, lead's ownership record `2309d132`). Working. Not read beyond the validator |
| S6 | same directory, `2026-11-02T10-04-56-620Z_01a19bb8-1bab-769c-a56e-fd8e3de75805.jsonl` | Pane `w1:pW`. Working. Owner unidentified. Not read beyond the validator |
| D1 | `docs/native-tree-retirement-plan.md` | Plan doc, untracked |
| D2 | `docs/goal-conditioned-branch-carry-back.md` | Motive/requirements concept, tracked |
| D3 | `docs/anchored-episode-retirement.md` | Current `/retire` contract, tracked |
| D4 | `docs/grounded-progress-map.md` | Method doc (rules for this map), untracked. Updated in the 10:05Z pass |
| P1 | Pi runtime: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/` (global, 1.4.0); repo `node_modules/@earendil-works/pi-coding-agent` (0.99.1) | Runtime and version evidence (last checked 09:51–09:57Z) |
| G1 | `git status --short`, `git rev-parse --short HEAD` in the repo | Repository state, HEAD `a515596` |
| L1 | `herdr pane list` (read-only), 2026-11-02 ~10:05Z | Live pane snapshot, shown in [agent-topology.md](agent-topology.md) |
| M1 | `docs/grounded-agent-work-map/2026-11-02-native-tree-retirement/metadata.json` | Session inventory (machine-readable). Not modified by this map |
| SC1 | `agent/scripts/inventory_work_sessions.py` and `agent/scripts/test_inventory_work_sessions.py` | Validator and its unit tests (stdlib only). Not modified by this map |

Session paths are shortened with `…` in the tables below; full names are above.

## Session checkpoints

| ID | Lines at last check | Last inspected entry (ID, timestamp, index) | Inspected ranges | Not inspected |
|---|---|---|---|---|
| S1 | **415 at ~10:05Z** (end of file at that check); **436 at 10:09:32Z**, entries 415–435 not read and not incorporated. Earlier checks: 372 (09:55:42), 385 (09:57 review) | `93d43e79`, 10:04:05.031Z, index 414 (checkpoint stays here) | Index 0–120: all entries (tool results cut to about 110 characters). Index 120–250 and 250–366: user and assistant text and custom messages only. Index 364–369: tool results partly read. Full text for `0c2f3471`, `61138ee4`, `273dcc42`, `4331a4dc`, `279e5bf0`, `f646b32f`, `e5453b86`, `85255889`, `5ec865ad`, `a02fb319`, `1b7a1b20`, `9199a1c2`, `e1188865`. **Update pass (10:05Z):** index 369–414: each entry's text or tool result, first ~700 characters. Full text of `fa48c1dc` (378), `04571171` (389), `93d43e79` (414). Compaction `d9c804a8` (388) first ~500 characters. Ownership record `2309d132` (405) records list. Custom workpad messages `cd82970d` (375), `fa79a53c` (391), `26ca51f2` (413) first ~500 characters | Tool results and thinking beyond those snippets. Full compaction summary. Context edits `3f08c7be`, `3582a238` (not interpreted). The entries of other sessions the lead reads through its tool calls (the lead's copy of their text is only partly read) |
| S2 | 149 (09:44:31 last entry) | `69448cad`, 09:44:31.710Z, index 148 (whole session at 09:44) | Index 6–148: user and assistant text and non-workpad custom messages. Thinking and tool results not inspected, except the text of the entries cited in this map | Not re-read in the 10:05Z pass. Tool-result content; the reasoning behind tool calls; any entries after index 148 |
| S3 | 155 (09:40:14 last entry) | `97471293`, 09:40:14.143Z, index 154 (whole session at 09:40) | Index 5–154: all user briefs; assistant messages longer than 120 characters only | Not re-read in the 10:05Z pass. Shorter assistant messages and tool results; any entries after index 154 |
| S4 | 210 at 09:55; 236 at the 09:57 review (not read). Current count not checked | `d140663f`, 09:53:05.411Z, index 204 | Index 0–12 (brief truncated at 500 characters). Index 112–204: text, tool results truncated to 160–700 characters. Entry `598cca2c` (09:53:27, index 209): thinking read in the review | **Index 13–111**. Index 205 onward (the implementer's later reports, e.g. overlap guard and print-mode console, are seen only through the lead's reads in S1) |
| S5 | not counted | none read | none (validator, 10:05Z run: `user_msgs=2`, 0 parse errors; header and ID checked by the validator only) | Entire content. Role and task are from the lead's ownership record only |
| S6 | not counted | none read | none (validator: `user_msgs=1`; 0 parse errors) | Entire content |

## Documents

| ID | Path | sha256 (full) | Checked (UTC) | Tracking | How it was read |
|---|---|---|---|---|---|
| D1 | `docs/native-tree-retirement-plan.md` | `7bdec5dccfa68e4bd736cdf7ce4f47e422bbaefba3b16d858017d82d70efcccf` | 09:51:04, 09:53:00, 09:55:42, 09:57 (review), and **10:05Z (same hash)**. 211 lines | Untracked | Full read at 09:51–09:57. Not re-read at 10:05Z; the unchanged hash means the content read earlier still applies |
| D2 | `docs/goal-conditioned-branch-carry-back.md` | `42aff058feb95bc287a8dfe722a089bfd67e43f9dbdd34fecc83596e0a8c9aeb` | 09:51:04, 09:55:42 | Tracked, commit `c77abdc`, clean | Headings and lines 1–20 only. Not re-checked at 10:05Z |
| D3 | `docs/anchored-episode-retirement.md` | `c94635e0a0b4290332e819cd7d2d082efd3ef1ff327563a3b3075b1e4177e0b4` | 09:51:04, 09:55:42 | Tracked, commit `2467628`, clean | Headings and lines 1–25 only. The Contract section (`### Inspect first`, `### Retire`) is the `/retire` contract the map refers to. Not re-checked at 10:05Z |
| D4 | `docs/grounded-progress-map.md` | **Current (10:05Z, after this update): `e5e37cb21a0979d9aee741da7e59171ebc3fc4504e57afae330870c808cabb64` (11399 bytes).** Earlier: 09:50 `f35703bc…` (4232 bytes); 09:55:42 `f62326e4…` (6621 bytes); 09:57:30 `c6ddfe8c…` (134 lines, 10292 bytes) | 09:50, 09:55:42, 09:57:30; updated and re-hashed at 10:05Z | Untracked | Full read of the 09:50 version. Lines 53–86 of the 09:55 version. The 09:57 version was read in the review. The 10:05Z edits changed the sections on the first instance, metadata, and the directory layout. Earlier copies are not stored, so no diff is possible |
| M1 | `…/metadata.json` | `d370e462dee3aeb2ea92e7fa968448c39e99be073f1c173a8c4dc41ecacad818` | 10:05Z (hash and validator run) | Untracked | Structure and counts read (22 sessions, 1 launch without file, 3 candidates). Not modified |
| SC1 | `agent/scripts/inventory_work_sessions.py` | `afe8c683f0b2b7fb7ffd849c3f9fcd3393da23d96866946f9475f7eed7dff9fb` | 10:05Z (hash, `--help`, validator run) | Untracked | Docstring and usage read; executed read-only against M1 |
| SC1-test | `agent/scripts/test_inventory_work_sessions.py` | `04ca3ab348f6b76908fb4fd380f79228ad980566504e6f9dbe8c9a043fe03840` | 10:05Z (run) | Untracked | Run once: `Ran 28 tests … OK` |

## Validator run (SC1 against M1, 10:05Z, read-only; abridged)

```text
CHECKED ... sessions=22 ...
NOTE  launch w1:p8 (retire-live): ownership record verified; no session file recorded
WARN  discovery.files_in_scope=25 but 27 files match now (scope changed or snapshot stale)
WARN  unrecorded in-scope file: 2026-11-02T10-01-46-553Z_01a19bb5-…jsonl
WARN  unrecorded in-scope file: 2026-11-02T10-04-56-620Z_01a19bb8-…jsonl
RESULT PASSED: 0 error(s), 3 warning(s)     (exit 0)
```

The earlier check reported 0 errors and 2 warnings. The two new warnings are the files of `S5` and `S6`. The count warning shows the scan is older than the directory.

## Pi runtime and repo checks (P1)

- Global Pi version `1.4.0` (`package.json` of the global install). Read by the lead at 08:24 (S1 `4058fef8`) and by me in the 09:51–09:57 review.
- Repo `node_modules` Pi version `0.99.1`. Read by me at 09:51 and in the review.
- `package.json` (repo): peer `>=0.74.0` (line 37), devDependency `^1.0.0` (line 49). `package-lock.json` line 446 pins `1.0.0`. The installed 0.99.1 does not match the lockfile.
- `dist/core/agent-session.js`: line 3261 is `async navigateTree(targetId, options = {})`; lines 3302–3305 contain the `session_before_tree` emit. Other line references in D1 are reviewer-cited and not re-checked.

## Repository state (G1, 10:05Z)

Branch `main`, HEAD `a515596`. 15 entries (09:55 list: 13; new: the two inventory script files).

```text
 M AGENTS.md
 M README.md
 M findings/09-episode-retirement-v0.md
 M index.ts
?? REPORT_EVALUATION.md
?? agent/scripts/inventory_work_sessions.py
?? agent/scripts/test_inventory_work_sessions.py
?? artifacts/
?? docs/grounded-agent-work-map/
?? docs/grounded-progress-map.md
?? docs/native-tree-retirement-plan.md
?? src/native-tree-handoff.ts
?? test/native-tree-handoff.session.test.ts
?? test/native-tree-handoff.test.ts
?? test/native-tree-harness.ts
```

- `artifacts/native-tree-handoff/` contains `live/`, `tui/`, `typecheck.txt` and `vitest-full.txt` (directory listing at 10:05Z). Not inspected; the implementer's `tui/` folder is reported as not created by `pG` (S1 `4436f807`).
- `index.ts` is modified. S4 reports wiring the spike behind an opt-in environment gate (S4 text, index 112–204; the exact entry and diff were not located).
- Modifications to `AGENTS.md`, `README.md` and `findings/09-episode-retirement-v0.md` predate this work and were not inspected.

## Unread sessions in today's directory

Discovered in the directory listing at about 09:50 (line counts at that time). Not read in this or earlier passes, except as noted above. Relationship to this work unverified.

- `08-21-24-357Z_01a19b59-5104…` (44), `08-21-24-376Z_01a19b59-5117…` (35), `08-29-10-057Z_01a19b60-6c28…` (50), `09-02-19-987Z_01a19b7e-c952…` (61), `09-04-55-857Z_01a19b81-2a30…` (49), `09-05-39-539Z_01a19b81-d4d2…` (35), `09-11-11-636Z_01a19b86-e614…` (5), `09-11-33-268Z_01a19b87-3a93…` (34)
- `09-17-17-673Z_01a19b8c-7be8…` (91) and `09-17-17-692Z_01a19b8c-7bfc…` (86). *Hypothesis:* panes `tree-handoff` (`w1:pA`) and `tree-cache` (`w1:pB`), launched at S1 `222c8316`. Not verified.
- `09-33-14-342Z_01a19b9b-14e5…` (62)
- `09-39-58-735Z_01a19ba1-408f…` (52): live as `w1:pF` (10:05Z list); the session D4 names as the methodology origin (D4 "Origin").
- `09-41-24-830Z_01a19ba2-90dd…` (26) and `09-41-24-887Z_01a19ba2-9116…` (33): created one minute after S4. Metadata links them to panes `w1:pH` and `w1:pJ`; those panes are absent at 10:05Z.
- `09-43-45-628Z_01a19ba4-b6db…` (17)
- `09-49-57-516Z_01a19baa-638b…` (11) and `09-49-57-525Z_01a19baa-6394…` (10): the second was `w1:pM` (absent at 10:05Z).
- S5 and S6 above (created 10:01:46Z and 10:04:56Z), plus the listed sessions in M1 that have not been read.

## Session discovery and `metadata.json`

- `metadata.json` (M1) is a **machine-readable inventory** of session IDs, paths, roles, pane links, checkpoint evidence and candidates. It lists 22 sessions, 1 launch without a session file (`w1:p8`), and 3 unlisted candidates. Its scan was at 09:59:45Z; it does not include S5 or S6.
- **Discovery is incomplete.** `completeness_claimed` is `false`. The directory listing shows files, including closed sessions. The pane list shows live panes only. Neither proves that all relevant sessions were found, and a session missing from the listing is not evidence it had no relevant content.
- **Relationship certainty varies:**
  - Pane to session: the validator treats it as **inferred** for all 20 sessions with an ownership link, and "not applicable" for the lead and the memory-steward. Herdr's pane list reports the session path for each live pane; that is recorded as L1, not as a child header.
  - Pane name to pane: from the ownership records (for example `tree-spike-build` = `w1:pG`, S1 `2b51c945`; `tree-live-check` = `w1:pT`, S1 `2309d132`).
  - Session to pane for the 09:17 and 09:41 sessions and the unread live panes: hypothesis only, except where L1 or an ownership record names the pair.
- **Update process:**
  1. Re-run the directory listing, `herdr pane list` (both read-only) and the validator command in [README](README.md).
  2. Compare with M1. Record new, missing and changed sessions. Changes to M1 belong to its owner.
  3. Check each recorded checkpoint entry ID in its file. Read entries after it by ID and timestamp, not by line count alone.
  4. Update the checkpoint table and hashes here, then the affected claims in [current-state.md](current-state.md).

## Limitations

- Session files are live. Line counts are as of the time stated.
- Tool results and thinking blocks were mostly not read. Statements about command output are as reported in the assistant's text or in the lead's tool results.
- Reviewer citations (for example `agent-session.js:3309`, `runner.js:830`) are reported by reviewers. Only the lines in P1 were re-checked.
- The lead's reports after 09:54Z (S1 `fa48c1dc`, `04571171`, `93d43e79`) are not independently proven. I did not run the tests or the live checks they describe.
- D4 changed during the work. Its current content may differ from what this map assumes about the method.

## Corrections in this revision

Recorded so provenance survives. Each item was checked against the source entry shown.

1. The `/retire` "never a boundary, goal, or count" wording (S1 `9199a1c2`): the earlier text said the agent defines "only the summary and no boundary, goal or count". Interpretation: the prohibition applies to optional text a user adds to `/retire`, not to the agent's boundary selection. This was an agent correction, not a user correction; the wording remains open to confirmation. Applied in README, history, and current-state; the original wording remains in S1.
2. Live-run approval (S1 `1b7a1b20`): the earlier text said the user must approve each live run. `1b7a1b20` authorizes implementation and live verification with `pi -ne -e index.ts`, and it sets no per-run gate. The claim was removed. The scope and precautions (plan precondition 1, fresh `--session-dir`) are kept.
3. Cache citation: the claim that summary generation sets `cacheRetention: "none"` was cited to D1. D1 has no such text ("[hypothesis] only"). It comes from S2 `ca38e02d` only, and is labelled reported.
4. Rev 5 review: the plan's "re-review pending" is attributed to D1. No checked session reports a rev 5 review.
5. Topology edges to unknown actors removed from the diagram. A hypothesis edge for the sender of cross-review prompts is in prose.
6. Semantic change (S1 `e5453b86`): the question is in S1 `e5453b86` ("Does carrying current work in the summary … match what you want?"); no answer found in the ranges read.
7. S2 `4c463301` corrects an earlier claim that navigation failure is silent: the TUI shows extension errors. Recorded in current-state.
8. **Live status (10:05Z):** the 09:54 version said no live run was reported. The lead now reports a print-mode live handoff (`fa48c1dc`, 09:58:23), with the implementer's console quoted in `80da55e3`. Labelled reported; not verified. TUI and request-payload checks are still open.
9. **Validator count:** the 2-warning result noted earlier is superseded. The 10:05Z run gives 0 errors and 3 warnings (see the validator section above). The scope changed; the old result was not wrong for its scan.
10. **Pane list:** `w1:pM` (present at 09:54Z) and `w1:pD`/`w1:pC` state changed (now `done`). `w1:pT`, `w1:pV`, `w1:pW` are new at 10:05Z.
11. **Pending metadata:** the earlier "metadata.json and any discovery script pending" statement is obsolete. Both exist (M1, SC1) and are now integrated in README, this file and how-to-resume.

## Later selective update

At 10:10Z, the lead's assistant text was sampled after the 10:04 checkpoint. Entry `885d2527` (10:08:37.215Z) reports the TUI handoff, captured provider request and reload; old-branch navigation and footer capture were still under review. This is a lead report, not independent verification. **The main S1 checkpoint remains `93d43e79`**: intervening tool results and other entries after index 414 were not comprehensively read. Resume from that checkpoint as well as this later sampled entry.
