# 09 — Episode retirement V0

## Status

**Provisional implementation finding (2026-08-28).** V0 is a working provider-facing overlay, not evidence of cost or task-quality improvement.

### V3 forward retirement + V4 corrective deepening

V3 extends a valid V1/V2 first retirement with an append-only active receipt chain. Each later receipt stores the exact parent receipt/capsule SHA-256 hashes, generation, raw-delta entries, and a cumulative contiguous raw range. Provider input separates the prior structured capsule from the new raw delta, so it neither nests capsule text nor reconstructs omitted source facts. The latest valid active-chain receipt alone projects and recalls the full cumulative originals. Missing, malformed, tampered, inactive, or native-compacted chains fail closed; V1/V2 one-shot projection and recall remain compatible. Cumulative metrics and V3 delta metrics are persisted and rendered. V3's exact-forward boundary remains stable; V4 corrective deepening can move the boundary backward. Every new capsule causes one suffix recache; this is not a general performance-benefit claim.

### Capsule-model V2

V2 keeps active-agent episode selection but moves capsule authorship to exactly one configured secondary `provider/model` (`PI_EPISODE_RETIREMENT_MODEL`, default `google/gemini-3.7-flash`) at a validated Pi reasoning level (`PI_EPISODE_RETIREMENT_REASONING_EFFORT`, default `medium`). It has no active-model fallback: configuration, model/auth, completion, or capsule-validation failure aborts before append. V2 receipts persist model metadata and nested usage; existing V1 receipts remain projectable and recallable.

**Historical-stage automated evidence (2026-08-28):** `npm run precommit` passed TypeScript, 160 tests across 4 files (including deterministic failure cases), and audit with 0 vulnerabilities; those cases cover zero-append failures, prefix stability, and V1 compatibility. This measurement was not rerun for that stage.

**Current verification (bounded inspect review):** `npm run precommit` passed TypeScript, **162 tests across 4 files**, and `npm audit --audit-level=moderate` with 0 vulnerabilities. Egress is redacted by default and originals are never changed.

## Name and contract

**Episode retirement** is provisional: it conveys leaving the active working set while retaining recoverable source history, unlike Pi native compaction.

The contract is:

- select a contiguous suffix of completed user-to-user **episodes**; never a middle selection within that completed suffix;
- protect the current active episode;
- keep JSONL append-only and lossless;
- persist a structured **continuation capsule** plus exact source IDs and SHA-256 message fingerprints;
- preserve the provider-input prefix before the selected suffix exactly; project the capsule only into the first retained active user message for the provider-facing view;
- this causes a one-time suffix recache; it can avoid recurring cached-token processing cost and latency, but realized local-model speedup depends on server prefix/KV-cache retention;
- fail closed on ambiguity for retirement and recall; leave the provider projection unchanged when its parity check is ambiguous; and
- recall by inventory, then one validated source entry at a time.

`inspect_episode_retirement` evaluates every count from 1 through the mechanical maximum, with no selection cap. It returns only fixed, source-free data: evaluated/accepted/refused totals; fixed canonical numeric refusal-reason counts; per-relation accepted-count/min-count/max-count frontiers for `initial`, `forward`, `recompose`, and `deepen`; and `largestSafe` with the established mechanical candidate fields, or `null`. It does no model lookup, authentication, streaming, or append work.

## Implementation scope

**Historical-stage implementation evidence (2026-08-28):** Exactly three code paths changed:

- `src/episode-retirement.ts` — selection, receipt, strict event projection, and bounded recall;
- `test/episode-retirement.test.ts` — multi-tool, string/text active-user, mismatch, resume, registration/hook, and recall tests;
- `index.ts` — independent registration alongside unchanged smart compaction.

Feature flag: `PI_EPISODE_RETIREMENT_ENABLED=true`. It is off by default.

Resolved-context retirement uses public `ReadonlySessionManager.buildContextEntries()` and `buildSessionContext()`: context-producing raw entries (`message`, `custom_message`, `compaction`, `branch_summary`) are paired in order with resolved provider messages. It preserves an opaque exact prefix and validates only the candidate source-to-active interval: candidates must contain supported raw standard messages and balanced tool calls. It hard-refuses before stream/append on producer/message count mismatch or raw standard-message fingerprint mismatch. Discuss metadata, custom-message, compaction, branch-summary, old-image prefixes, and inactive branches are allowed; those shapes remain disallowed inside the candidate. **Historical-stage behavior (2026-08-28):** Existing receipts refused with the reason-specific `repeated-retirement-unsupported` error; recall still verified receipt sources.

**Historical-stage census and roadmap (2026-08-28):** **1,605 session files inspected; 791 (49.3%)** matched the former pre-selection rejection shape at `/Users/cgint/.pi/profiles/partner/agent/sessions`. The method used the last tree entry as active leaf, a `parentId` walk, and the global branch rule. Overlapping categories: 706 active custom metadata, 570 active `custom_message`, 232 active compaction, 12 active branch summary, and 101 global branch. The homelab cause was the old global/raw-shape rejection, not a raw-entry/resolved-message disparity. This is not a quality claim. At that stage, repeated retirement remained the next slice.

## Automated evidence

**Historical-stage automated evidence (2026-08-28):** `npm run precommit` passed: TypeScript typecheck, **15 tests**, and `npm audit` with zero vulnerabilities. This measurement was not rerun for that stage. The registered `context` handler was tested directly with realistic event messages; it projected only after exact alignment and otherwise left the event unchanged.

## Isolated live evidence

### V2 synthetic smoke

One isolated synthetic run verified mechanics: active `openai-codex/gpt-5.6-terra` retired exactly two completed episodes (four source messages) through capsule model `google/gemini-3.7-flash` at `medium`. The V2 receipt had matching JavaScript SHA-256 fingerprints, `capsule-v2`, and nested usage of 1,091 input / 336 output / 171 reasoning / 1,427 total tokens / `$0.00207825`. The follow-up returned `ALPHA-731`, `blue-route`, and `verify-checksum`. This verifies the V2 protocol mechanics, not general task quality or cost benefit.

### Resolved-context fork smoke

The isolated fork `/tmp/pi-resolved-context-fork.5WzhzX/sessions/2026-08-28T13-27-41-821Z_01a0488e-03fd-7736-b184-3c7e4fad4b37.jsonl` inherited discuss metadata `355812d2` and historical failed retirement call `f047c41b`. It appended exactly one V2 `google/gemini-3.7-flash` / `medium` / `capsule-v2` receipt: N=1, four source messages, 27,248 serialized source bytes → 978 exact capsule-text bytes; usage was 12,109 input / 671 output / 484 reasoning / 12,780 total / `$0.011598`. All four JavaScript `JSON.stringify` SHA-256 source fingerprints independently matched. The original session remained SHA-256 `2c303ac7141125e942b21dacc41ec8742c997fee7d3156705c343e7634824dde`. A no-tools follow-up recovered the RAM decision and next host-requirements planning step. This proves mechanics for this formerly rejected real shape, not 99% eligibility or general quality/cost benefit.

### Resolved-context repeated-retirement V3 smoke

The isolated session `/tmp/pi-v3-smoke.WPu94f/sessions/2026-08-28T15-13-43-413Z_v3-live-smoke.jsonl` produced receipts `[V2, V3]`. V3 generation 2 names parent entry `41e81785`; exact parent-receipt and prior-capsule hashes matched, as did all six raw source fingerprints. Its cumulative replacement metrics were 2 episodes / 6 messages / 6,992 bytes / 243 capsule bytes; delta metrics were 1 episode / 4 messages / 4,540 bytes / 259 prior-capsule bytes / 243 new-capsule bytes. Capsule-model usage was 2,707 input / 469 output / 410 reasoning / 3,176 total / `$0.003789`. A no-tools follow-up recovered `migrate service`, `blue-route`, and `verify-checksum`. This verifies chain mechanics only, not general quality, cache, or cost benefit; post-receipt native compaction remains refused and untested live.

### Inspect-guided V4 corrective-deepening smoke

V3 remains exact-forward; V4 supersedes the latest projection with before + parent + after raw provenance and one non-nested capsule. Strict chain, tamper, child-generation, renderer, and pre-egress validation fail closed.

Final isolated session `/tmp/pi-v4-inspect-smoke.0Fg2GW/sessions/2026-08-28T17-00-44-509Z_inspect-v4.jsonl` called `inspect_episode_retirement` then chose N=3 and emitted `[V2, V4]`. Parent/capsule hashes, all fingerprints, and unique cumulative IDs matched. V4 had before 1 episode / 2 messages / 2,895 B; after 1 / 4 / 4,825 B; cumulative 3 / 8 / 8,589 B; prior 591 → new 611 capsule bytes; usage 4,764 input / 643 output / 535 reasoning / 5,407 total / `$0.00598425`. A no-tools recovery returned `ALPHA-731`, `blue-route`, and `verify-checksum`. Measured progression: without mechanical preview the agent chose N1/V3; recall-only chose N2/V4 at the same boundary; candidate inspection enabled N3 deepening. This is mechanics evidence only, not general benefit.

### Native /retire prompt

`/retire [optional continuation emphasis]` is feature-gated and selectively discovered as a native Pi prompt template. It expands into a normal user turn: the active agent retains whether/count/goal decisions, and optional text says only what remains salient or happens next. A pinned Pi 0.84.2 `registerCommand` + captured `pi.sendUserMessage` adapter was rejected after resume: its stale-context guard fired before nudge, tool, or receipt append, so it was removed rather than worked around.

Fresh resumed smoke `/tmp/pi-retire-template-smoke.vT13Zt/sessions/2026-08-28T16-19-26-979Z_native-retire-live.jsonl` persisted no literal `/retire`; it produced one expanded prompt, one agent-chosen N=1 call with non-empty goal, and one valid V2 receipt. All fingerprints matched; metrics were 1 episode / 2 messages / 901 source bytes → 495 capsule bytes. Active usage was 1,400 input / 148 output / 83 reasoning / 1,548 total / `$0.004576`; capsule usage was 706 input / 260 output / 143 reasoning / 966 total / `$0.0015045`. This verifies prompt command mechanics only, not general benefit.

All artifacts are outside the repository:

1. Protocol smoke: `/tmp/pi-episode-retirement-smoke.y38j9f/sessions/2026-08-28T08-08-05-906Z_01a04769-6a12-73b7-ba6c-b6d50d9db2f7.jsonl`.
2. Bulky value signal: `/tmp/pi-episode-retirement-value.A6snb5/sessions/2026-08-28T08-11-35-697Z_01a0476c-9d91-7479-aac5-00f9fdc4ace1.jsonl`.

Both used `openrouter/google/gemini-3.6-flash` with explicit extension `/Users/cgint/dev-external/pi-smart-compact/index.ts` and `PI_EPISODE_RETIREMENT_ENABLED=true`.

### Bulky fixture

```bash
{ printf 'HEAD_FACT=ORBITAL-CEDAR-7419\n'; for i in $(seq 1 650); do
  printf 'record-%04d: deterministic payload for episode-retirement value check\n' "$i"
done; printf 'TAIL_FACT=VIOLET-HARBOR-2086\n'; } > corpus.txt
wc -l -c corpus.txt
sha256sum corpus.txt
```

Result: 652 lines, 45,558 bytes; SHA-256 `992e971c63ff19262adaa4d1513895108f649ba6ebbed1ccb1282651669c1f37`.

### Reproduction shape

```bash
PI_EPISODE_RETIREMENT_ENABLED=true pi -p \
  --session-dir "$WORKSPACE/sessions" \
  --model openrouter/google/gemini-3.6-flash \
  --extension /Users/cgint/dev-external/pi-smart-compact/index.ts \
  'Read the full corpus.txt and report both facts and counts.'
```

Resume the emitted session for: (B) explicit `retire_episodes` with truthful capsule, (C) `--no-tools` continuation, and (D) `recall_episode` inventory followed by a selected `sourceEntryId`.

### Observations, not benefit claims

The bulky run recorded **22,432 total tokens / 16,280 cacheRead** immediately before retirement and **11,765 total / 8,127 cacheRead** on the first stable post-retirement call. This is a scoped mechanism observation, **not a paired benefit result**: prompts and cache state differ.

Prompt C ran with `--no-tools` and correctly returned, from continuation state alone: `ORBITAL-CEDAR-7419`, `VIOLET-HARBOR-2086`, 652 lines, and 45,558 bytes. Its 3,736 total tokens / zero cache read are confounded by removed tool schemas and **must not be compared as retirement savings**.

Bounded recall first returned an inventory of all 12 selected source entries, then fingerprint-verified and returned source `86b94057`. It retrieved the exact stored `read` tool-result entry. That entry was itself Pi-truncated (14,474-character JSON payload / 14,013-character displayed text), so recall is **not magical full-source reconstruction**; it retrieves exact stored chunks.

Recorded provider cost: **$0.069455325** for the bulky four-prompt run. The earlier protocol smoke cost **$0.02443245**.

## Paired autonomy result

Preregistration: `/tmp/episode-retirement-autonomy-preregister.md`. One common bulky completed seed episode was copied byte-for-byte into:

- OFF: `/tmp/pi-episode-retirement-autonomy.wZOny2/arms/off.jsonl`;
- ON: `/tmp/pi-episode-retirement-autonomy.wZOny2/arms/on.jsonl`.

Both copies began with the same session header ID and identical file hash. Both used `openrouter/google/gemini-3.6-flash`; OFF omitted the feature flag and ON set `PI_EPISODE_RETIREMENT_ENABLED=true`. B gave both arms only vague permission to manage settled history if beneficial.

**Demonstrated once:** ON independently called `retire_episodes`, selected `latestCompletedEpisodes: 1`, and authored a capsule preserving the durable facts and its investigation decisions. Receipt: `4af0ec46`. It selected ten source entries (`f0177e27` through `05401f8b`).

Both no-tools C answers correctly returned the head fact, tail fact, 652 lines, and 45,558 bytes. ON recorded **3,712 total / 3,662 input / 0 cacheRead**; OFF recorded **14,778 total / 14,720 input / 0 cacheRead**. This is a **context-residency signal**, not a general success or cost claim.

D exposed a limit. OFF answered the resident surprise detail in one call at **$0.00610365**. ON used `grep` against the still-live `corpus.txt` in two calls totaling **$0.00722670** and did not call `recall_episode`. This does not test recovery pressure because the original source remained available on the filesystem.

Do not compare aggregate arm cost: copied arms retained the same session header ID and sequential order contaminated cache availability; ON's first B call had `cacheRead` while OFF's did not. B behavior also differed beyond retirement: OFF performed three shell inspections before `READY`.

## Failures and corrections

- A first live invocation used repository cwd instead of the synthetic workspace; it was discarded and rerun in fresh `/tmp` workspace.
- The first fixture measured 56,058 bytes, above the requested cap; it was regenerated to 45,558 bytes before any agent run.
- Review corrected V0 from a standalone synthetic capsule message to capsule text prepended to the active user message, preventing fabricated assistant history and consecutive provider-user messages.
- Review required strict transformation of `event.messages`, rather than rebuilding provider context from branch entries; V0 now fails open on mismatch.

## Remaining gaps

- Post-receipt native compaction remains refused and untested live.
- Autonomous bounded recall was not discovered.
- Long-session behavioral sufficiency is untested.

## Cheapest next test

Produce ephemeral, non-repeatable bulky tool output whose surprise detail is available only in stored history. Give vague retirement permission, then ask for the omitted detail and observe whether recall is discovered. Run it paired with fresh distinct session IDs or order-balanced runs; do not reuse copied session headers.
