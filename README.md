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

Episode retirement remains off by default. Enable it with `PI_EPISODE_RETIREMENT_ENABLED=true`. Before every `retire_episodes` call, the active agent calls read-only `inspect_episode_retirement`, pages as needed, independently decides whether retirement is appropriate, chooses witness-scoped `fromEpisodeInclusive` as the oldest included completed episode, supplies `inspectionWitness`, and independently authors `continuationGoal` and the smallest critical non-blank `pinnedWorkingState` (<=2000 characters). Active work is excluded; the secondary model does not decide boundary, goal, or pin.

Use the native `/retire` prompt template, or `/retire Continue with Shuttle workload planning and the target-host pivot.` to add optional continuation emphasis. It expands into a normal user turn. Optional text says only what should remain salient or happen next, never a boundary, goal, or count. Inspection returns newest-first candidates with mechanically extracted bounded prompt previews and candidate facts, plus an opaque witness, without model/auth/append work; each complete provider-content and details envelope is <=2048 UTF-8 bytes. `sourceMessageBytes` is the UTF-8 byte length of non-pretty `JSON.stringify(selectedProviderMessages)`, not bytes freed.

```bash
export PI_EPISODE_RETIREMENT_MODEL=google/gemini-3.7-flash
export PI_EPISODE_RETIREMENT_REASONING_EFFORT=medium
```

`PI_EPISODE_RETIREMENT_MODEL` is one `provider/model` value (the first slash separates provider from model ID); there is no model list or active-model fallback. The reasoning effort must be a Pi ThinkingLevel. `continuationGoal` must be non-empty and at most 1,000 characters. Capsules have exactly five fields; fields are bounded to 2,000 characters, items to 1,000 characters, arrays to 32 items, and serialized capsule JSON to 8,000 characters. Every new receipt is strict discriminated V5 (`initial|forward|recompose|deepen`) with original pin and exact mode-specific provenance/metrics; V1–V4 remain projectable and recallable historical readers.

Interactive Pi renders a compact retirement result with serialized selected provider-message UTF-8 bytes → exact capsule-text UTF-8 bytes, configured model/reasoning, and only available nested usage fields; expanding it shows the exact latest provider continuation (one exact pin block plus capsule) and provenance. This is TUI-only: normal provider-visible tool `content` remains compact, and the append-only JSONL history is not rewritten.

Retirement pairs public `ReadonlySessionManager.buildContextEntries()` producers with `buildSessionContext()` messages. It preserves the resolved provider-input prefix exactly, validates only the selected source-to-active interval, and refuses before egress when producer/message counts or raw standard-message fingerprints differ. Discuss metadata, custom-message, compaction, branch-summary, and old-image prefixes are opaque and permitted; those nonstandard slots are never eligible candidates. `inspect_episode_retirement` evaluates every count from 1 through the mechanical maximum—there is no selection cap—and returns bounded mechanically extracted candidate facts, including prompt previews, plus source-free aggregate fields: evaluated, accepted, and refused totals; fixed canonical numeric refusal-reason counts; accepted-count/min/max-count frontiers for `initial`, `forward`, `recompose`, and `deepen`; and the full mechanical fields of `largestSafe` (or `null`). It does no model lookup, authentication, streaming, or append work. Scoped census: `/Users/cgint/.pi/profiles/partner/agent/sessions` had 1,605 session files inspected; 791 (49.3%) matched the former pre-selection rejection shape, using the last tree entry as active leaf, a `parentId` walk, and the global branch rule. Overlapping categories were 706 active custom metadata, 570 active `custom_message`, 232 active compaction, 12 active branch summary, and 101 global branch. These are session-shape counts, not raw-entry/resolved-message counts or a quality claim. A witness binds the canonical active-root snapshot and shared preflight; successful append alone consumes it, while pre-append failure remains retryable. Projection uses only the latest valid receipt’s pin and capsule; recall remains cumulative raw provenance. A malformed, inactive, tampered, or natively compacted chain is ignored for projection and refused for retirement/recall. Each new capsule causes one suffix recache; this is not a general performance-benefit claim. Source text and pin guidance are redacted before capsule-model egress by default; set `PI_EPISODE_RETIREMENT_REDACT=false` only when that is explicitly appropriate. Model/auth/completion/capsule errors abort retirement before a receipt is appended.

## Structure

- **`index.ts`** — Entry point (delegates to `src/`)
- **`src/smart-compact.ts`** — Extension logic (env-var toggle, model selection, fallback)
- **`prompts/smart-compaction-prompt.md`** — The compaction prompt (single config point)
- **`test/`** — Smoke tests