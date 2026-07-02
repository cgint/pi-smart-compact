# 06 — Fixed Approach: `session_before_compact` with `ctx.modelRegistry`

## Date
2026-07-02

## Problem

All previous approaches failed because they tried to work around Pi's auth layer:
- `completeSimple()` with an externally-constructed model → auth failure
- `before_provider_request` prompt-swapping → doesn't fire during auto-compaction, and fails silently with `-e ./`

## Solution

Use `session_before_compact` with `ctx.modelRegistry` — the same pattern as Pi's official example (`custom-compaction.ts`).

### Why this works

Pi's extension runtime binds `ctx.modelRegistry` at startup via `runner.bindCore()`. The registry resolves API keys from the user's `models.json` configuration. By using `ctx.modelRegistry` instead of trying to derive auth ourselves, we leverage Pi's built-in auth resolution.

### Source evidence

Verified against Pi v0.80.3 source:

1. **`ctx.model`** → `getModel: () => this.model` (agent-session.js line ~bindCore)
   - Resolved at call time, returns the session's current model

2. **`ctx.modelRegistry`** → lazily resolved via getter in `createContext()` (runner.js)
   - Available in all event handlers

3. **`modelRegistry.getApiKeyAndHeaders(model)`** → returns `{ ok: true, apiKey?, headers?, env? }` (model-registry.d.ts)
   - Resolves auth from models.json, including env vars and command-backed keys

4. **`complete(model, { messages }, { apiKey, headers, env, maxTokens, signal })`** (pi-ai/compat.d.ts)
   - Standard LLM call function, accepts resolved auth

5. **Return shape** → `SessionBeforeCompactResult` accepts `{ compaction?: CompactionResult }` (types.d.ts)
   - `CompactionResult` = `{ summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter?, details? }`

6. **Event fires** → both manual `/compact` and auto-compaction (agent-session.js)
   - `reason` field: `"manual" | "threshold" | "overflow"`

### Implementation plan

1. Listen to `session_before_compact` with `(event, ctx)` signature
2. Get model from `ctx.model` (session's current model)
3. Resolve auth via `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!)`
4. Serialize messages from `event.preparation` (messagesToSummarize + turnPrefixMessages)
5. Call `complete()` with our custom prompt from `DRAFT_COMPACTION_PROMPT.md`
6. Return `{ compaction: { summary, firstKeptEntryId, tokensBefore } }`
7. Graceful degradation: return `undefined` on any error (falls back to Pi's default)

### Differences from previous attempts

| Aspect | Previous (broken) | New (working) |
|--------|-------------------|---------------|
| Hook | `before_provider_request` | `session_before_compact` |
| Auth | External derivation → failed | `ctx.modelRegistry` → Pi's built-in |
| LLM call | `completeSimple()` (unauthenticated) | `complete()` with resolved auth |
| Model | Derived from entries → null | `ctx.model` → session's current model |
| Delivery | Prompt swapping in payload | Direct summary return |

### Files

- Draft prompt: `findings/DRAFT_COMPACTION_PROMPT.md` (7,457 chars)
- Official example: `packages/coding-agent/examples/extensions/custom-compaction.ts`
- Extension types: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- Compaction types: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.d.ts`
- Agent session: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
- Extension runner: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js`