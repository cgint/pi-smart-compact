# 09 — Episode retirement V0

## Status

**Provisional implementation finding (2026-08-28).** V0 is a working provider-facing overlay, not evidence of cost or task-quality improvement.

### Capsule-model V2

V2 keeps active-agent episode selection but moves capsule authorship to exactly one configured secondary `provider/model` (`PI_EPISODE_RETIREMENT_MODEL`, default `google/gemini-3.7-flash`) at a validated Pi reasoning level (`PI_EPISODE_RETIREMENT_REASONING_EFFORT`, default `medium`). It has no active-model fallback: configuration, model/auth, completion, or capsule-validation failure aborts before append. V2 receipts persist model metadata and nested usage; existing V1 receipts remain projectable and recallable.

Current automated evidence: `npm run precommit` passed TypeScript, 72 tests across 3 files (including deterministic failure cases), and audit with 0 vulnerabilities; those cases cover zero-append failures, prefix stability, and V1 compatibility. Egress is redacted by default and originals are never changed.

## Name and contract

**Episode retirement** is provisional: it conveys leaving the active working set while retaining recoverable source history, unlike Pi native compaction.

The contract is:

- select a contiguous suffix of completed user-to-user **episodes**; never a middle selection within that completed suffix;
- protect the current active episode;
- keep JSONL append-only and lossless;
- persist a structured **continuation capsule** plus exact source IDs and SHA-256 message fingerprints;
- preserve the provider-input prefix before the selected suffix exactly; project the capsule only into the first retained active user message for the provider-facing view;
- this causes a one-time suffix recache; it can avoid recurring cached-token processing cost and latency, but realized local-model speedup depends on server prefix/KV-cache retention;
- fail open on ambiguity; and
- recall by inventory, then one validated source entry at a time.

## Implementation scope

Exactly three code paths changed:

- `src/episode-retirement.ts` — selection, receipt, strict event projection, and bounded recall;
- `test/episode-retirement.test.ts` — multi-tool, string/text active-user, mismatch, resume, registration/hook, and recall tests;
- `index.ts` — independent registration alongside unchanged smart compaction.

Feature flag: `PI_EPISODE_RETIREMENT_ENABLED=true`. It is off by default.

Resolved-context retirement uses public `ReadonlySessionManager.buildContextEntries()` and `buildSessionContext()`: context-producing raw entries (`message`, `custom_message`, `compaction`, `branch_summary`) are paired in order with resolved provider messages. It preserves an opaque exact prefix and validates only the candidate source-to-active interval: candidates must contain supported raw standard messages and balanced tool calls. It hard-refuses before stream/append on producer/message count mismatch or raw standard-message fingerprint mismatch. Discuss metadata, custom-message, compaction, branch-summary, old-image prefixes, and inactive branches are allowed; those shapes remain disallowed inside the candidate. Existing receipts refuse with the reason-specific repeated-retirement-unsupported error; recall still verifies receipt sources.

Scoped census: **1,605 session files inspected; 791 (49.3%)** matched the former pre-selection rejection shape at `/Users/cgint/.pi/profiles/partner/agent/sessions`. The method used the last tree entry as active leaf, a `parentId` walk, and the global branch rule. Overlapping categories: 706 active custom metadata, 570 active `custom_message`, 232 active compaction, 12 active branch summary, and 101 global branch. The homelab cause was the old global/raw-shape rejection, not a raw-entry/resolved-message disparity. This is not a quality claim. Repeated retirement remains the next slice.

## Automated evidence

`npm run precommit` passed: TypeScript typecheck, **15 tests**, and `npm audit` with zero vulnerabilities. The registered `context` handler is tested directly with realistic event messages; it projects only after exact alignment and otherwise leaves the event unchanged.

## Isolated live evidence

### V2 synthetic smoke

One isolated synthetic run verified mechanics: active `openai-codex/gpt-5.6-terra` retired exactly two completed episodes (four source messages) through capsule model `google/gemini-3.7-flash` at `medium`. The V2 receipt had matching JavaScript SHA-256 fingerprints, `capsule-v2`, and nested usage of 1,091 input / 336 output / 171 reasoning / 1,427 total tokens / `$0.00207825`. The follow-up returned `ALPHA-731`, `blue-route`, and `verify-checksum`. This verifies the V2 protocol mechanics, not general task quality or cost benefit.

### Resolved-context fork smoke

The isolated fork `/tmp/pi-resolved-context-fork.5WzhzX/sessions/2026-08-28T13-27-41-821Z_01a0488e-03fd-7736-b184-3c7e4fad4b37.jsonl` inherited discuss metadata `355812d2` and historical failed retirement call `f047c41b`. It appended exactly one V2 `google/gemini-3.7-flash` / `medium` / `capsule-v2` receipt: N=1, four source messages, 27,248 serialized source bytes → 978 exact capsule-text bytes; usage was 12,109 input / 671 output / 484 reasoning / 12,780 total / `$0.011598`. All four JavaScript `JSON.stringify` SHA-256 source fingerprints independently matched. The original session remained SHA-256 `2c303ac7141125e942b21dacc41ec8742c997fee7d3156705c343e7634824dde`. A no-tools follow-up recovered the RAM decision and next host-requirements planning step. This proves mechanics for this formerly rejected real shape, not 99% eligibility or general quality/cost benefit; repeated retirement remains unsupported.

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

- Repeated retirement is unsupported.
- Autonomous bounded recall was not discovered.
- Long-session behavioral sufficiency is untested.
- Native compaction occurring after an existing retirement receipt is untested.

## Cheapest next test

Produce ephemeral, non-repeatable bulky tool output whose surprise detail is available only in stored history. Give vague retirement permission, then ask for the omitted detail and observe whether recall is discovered. Run it paired with fresh distinct session IDs or order-balanced runs; do not reuse copied session headers.
