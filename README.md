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

```bash
export PI_EPISODE_RETIREMENT_MODEL=google/gemini-3.7-flash
export PI_EPISODE_RETIREMENT_REASONING_EFFORT=medium
```

`PI_EPISODE_RETIREMENT_MODEL` is one `provider/model` value (the first slash separates provider from model ID); there is no model list or active-model fallback. The reasoning effort must be a Pi ThinkingLevel. `continuationGoal` must be non-empty and at most 1,000 characters. Capsules have exactly five fields; fields are bounded to 2,000 characters, items to 1,000 characters, arrays to 32 items, and serialized capsule JSON to 8,000 characters. V1 receipts remain projectable and recallable.

Interactive Pi renders a compact retirement result with serialized selected provider-message UTF-8 bytes → exact capsule-text UTF-8 bytes, configured model/reasoning, and only available nested usage fields; expanding it shows the exact provider-facing capsule text and provenance. This is TUI-only: normal provider-visible tool `content` remains compact, and the append-only JSONL history is not rewritten.

Retirement preserves the provider-input prefix before the selected suffix exactly and performs a one-time suffix recache. It may avoid recurring cached-token processing and latency; local-model speedup depends on the server's prefix/KV-cache retention and is not guaranteed. Source text is redacted before capsule-model egress by default; set `PI_EPISODE_RETIREMENT_REDACT=false` only when that is explicitly appropriate. Model/auth/completion/capsule errors abort retirement before a receipt is appended.

## Structure

- **`index.ts`** — Entry point (delegates to `src/`)
- **`src/smart-compact.ts`** — Extension logic (env-var toggle, model selection, fallback)
- **`prompts/smart-compaction-prompt.md`** — The compaction prompt (single config point)
- **`test/`** — Smoke tests