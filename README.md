# pi-smart-compact

Pi extension that replaces built-in compaction with a smarter prompt-driven summary.

## How it works

Intercepts Pi's `session_before_compact` event and generates a summary using a custom prompt optimized for behavioral resumption — preserving decisions, blockers, active work state, and specific error details. Uses Gemini Flash by default (cheaper/faster), falls back to the session's current model.

Graceful degradation: if the LLM call fails, Pi's built-in compaction runs instead.

## Installation

```bash
cd pi-smart-compact
npm install
pipa install -c .
```

## Configuration

Enable the extension by setting the environment variable:

```bash
export PI_SMART_COMPACT_ENABLED=true
```

By default the extension is **disabled** (Pi's built-in compaction runs). Set the env var to `true` to activate.

Edit `prompts/smart-compaction-prompt.md` to change compaction behavior. No code changes needed — reload Pi with `/reload`.

### Episode retirement capsule model

Episode retirement remains off by default. Enable it with `PI_EPISODE_RETIREMENT_ENABLED=true`. When the active agent calls `retire_episodes`, it chooses the completed-episode count and supplies `continuationGoal`; one configured secondary model alone authors the persisted capsule.

Use the native `/retire` prompt template, or `/retire Continue with Shuttle workload planning and the target-host pivot.` to add optional continuation emphasis. It expands into a normal user turn; the active agent still decides whether retirement is appropriate, its count, and its goal. Optional text says what should remain salient or happen next, not what to retire. When a prior capsule exists, `/retire` asks the active agent to call read-only `inspect_episode_retirement` first; it classifies source-free candidates as `initial`, `forward`, `recompose`, or `deepen` without model/auth/append work.

V3 is exact-forward retirement: its cumulative boundary remains stable. V4 corrective deepening supersedes the latest projection with one capsule (never nested), retaining before + parent + after raw provenance; it can move the retirement boundary backward, while the earlier prefix remains exact and the newly moved suffix is recached once.

```bash
export PI_EPISODE_RETIREMENT_MODEL=google/gemini-3.7-flash
export PI_EPISODE_RETIREMENT_REASONING_EFFORT=medium
```

`PI_EPISODE_RETIREMENT_MODEL` is one `provider/model` value (the first slash separates provider from model ID); there is no model list or active-model fallback. The reasoning effort must be a Pi ThinkingLevel. `continuationGoal` must be non-empty and at most 1,000 characters. Capsules have exactly five fields; fields are bounded to 2,000 characters, items to 1,000 characters, arrays to 32 items, and serialized capsule JSON to 8,000 characters. V1 receipts remain projectable and recallable.

Interactive Pi renders a compact retirement result with serialized selected provider-message UTF-8 bytes → exact capsule-text UTF-8 bytes, configured model/reasoning, and only available nested usage fields; expanding it shows the exact provider-facing capsule text and provenance. This is TUI-only: normal provider-visible tool `content` remains compact, and the append-only JSONL history is not rewritten.

Retirement pairs public `ReadonlySessionManager.buildContextEntries()` producers with `buildSessionContext()` messages. It preserves the resolved provider-input prefix exactly, validates only the selected source-to-active interval, and refuses before egress when producer/message counts or raw standard-message fingerprints differ. Discuss metadata, custom-message, compaction, branch-summary, and old-image prefixes are opaque and permitted; those nonstandard slots are never eligible candidates. `inspect_episode_retirement` evaluates every count from 1 through the mechanical maximum—there is no selection cap—and returns a bounded, source-free summary: evaluated, accepted, and refused totals; fixed canonical numeric refusal-reason counts; accepted-count/min/max-count frontiers for `initial`, `forward`, `recompose`, and `deepen`; and the full mechanical fields of `largestSafe` (or `null`). It does no model lookup, authentication, streaming, or append work. Scoped census: `/Users/cgint/.pi/profiles/partner/agent/sessions` had 1,605 session files inspected; 791 (49.3%) matched the former pre-selection rejection shape, using the last tree entry as active leaf, a `parentId` walk, and the global branch rule. Overlapping categories were 706 active custom metadata, 570 active `custom_message`, 232 active compaction, 12 active branch summary, and 101 global branch. These are session-shape counts, not raw-entry/resolved-message counts or a quality claim. Repeated retirement uses V3 only for an exact-forward interval: it carries the parent capsule separately from the newly completed raw interval, has cumulative raw provenance, and projects only the latest validated active-chain capsule. V4 can instead move the boundary backward through corrective deepening. A malformed, inactive, tampered, or natively compacted chain is ignored for projection and refused for retirement/recall. Each new capsule causes one suffix recache; V3's cumulative boundary remains stable, but this is not a general performance-benefit claim. Source text is redacted before capsule-model egress by default; set `PI_EPISODE_RETIREMENT_REDACT=false` only when that is explicitly appropriate. Model/auth/completion/capsule errors abort retirement before a receipt is appended.

## Structure

- **`index.ts`** — Entry point (delegates to `src/`)
- **`src/smart-compact.ts`** — Extension logic (env-var toggle, model selection, fallback)
- **`prompts/smart-compaction-prompt.md`** — The compaction prompt (single config point)
- **`test/`** — Smoke tests