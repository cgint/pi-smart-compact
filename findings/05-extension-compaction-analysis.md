# 05 — Extension Compaction Investigation

## Current State (2026-07-09)

The extension **works**. It intercepts Pi's `/compact` command (and auto-compaction) via `session_before_compact`, calls Gemini Flash with our 12-rule prompt, and returns the summary to Pi.

Known issues:
- The auth resolution uses a three-layer workaround copied from `pi-advisor` because `getApiKeyAndHeaders()` sometimes misses env-key setups like `GEMINI_API_KEY`.
- We don't know if this workaround is necessary — the original code only differed from the official example in the model name (`2.5` vs `3.5`). We never isolated which change fixed it.

---

## Timeline of Attempts

### Attempt 1: `session_before_compact` → `completeSimple()` (original approach)

**Idea:** Intercept compaction, serialize messages, call `completeSimple(model, ...)` with our prompt, return the summary in `result.compaction`.

**Failure:** `currentModel` was always `null`.

**Root cause:** Pi's extension API does not expose the current model. The `model_select` event only fires when the user *changes* models. A session already running with a model never fires it. The `/compact` command aborts the agent turn before any LLM call, so `before_provider_request` never fires either.

**Investigation:** Examined Pi's `agent-session.js` — `compact()` has `this.model` (from `this.agent.state.model`) but the `SessionBeforeCompactEvent` does not include it. The model is passed to `compact()` internally but never exposed to extensions.

### Attempt 2: Resolve model from session entries + models.json

**Idea:** Read the session's `branchEntries` to find the last assistant message's `provider` and `model` fields, then look up the model definition from `models.json` and construct a `Model` object.

**Partial success:** Successfully resolved model (`8001-sparky / qwen36-35b-nvidia-nvfp4`) and constructed a `Model` object.

**Failure:** `completeSimple()` threw `"No API key for provider: 8001-sparky"`. Pi's auth layer (`modelRegistry.getApiKeyAndHeaders()`) is inaccessible from extension context. Passing `apiKey: undefined` (for "none" providers) still failed because the auth resolver doesn't know about our externally-constructed model.

**Lesson:** `completeSimple()` uses Pi's internal auth resolution. Without access to `modelRegistry`, we cannot make authenticated LLM calls from an extension.

### Attempt 3: Prompt swapping via `before_provider_request`

**Idea:** Instead of calling `completeSimple()` ourselves, let Pi's own compaction LLM call run, but intercept it via `before_provider_request` to swap Pi's default prompts with our custom prompt.

**Setup:** Extension listens to `before_provider_request`, detects compaction calls by matching Pi's default prompt strings in the payload, replaces them with our prompt, returns the modified payload.

**Failure:** No logs appeared at all — not even the startup log. The extension was not loading.

**Root cause (discovered later):** Pi's `-e ./` path resolution has a bug. The `resolveExtensionEntries()` function checks for `package.json` with `pi.extensions` field, but the relative path `./` does not resolve correctly. Using the absolute path (`-e /abs/path/to/index.ts`) works perfectly.

**Remaining question:** Even with the extension loading, `before_provider_request` may not fire during auto-compaction (context-threshold-triggered), only during manual `/compact`. This needs testing.

### Attempt 4: Absolute path loading

**Confirmed:** `pi -e /Users/cgint/dev-external/pi-smart-compact/index.ts` loads the extension successfully. Logs appear:

```
[pi-smart-compact] Module loaded, __dirname: /Users/cgint/dev-external/pi-smart-compact
[pi-smart-compact] register() called
[pi-smart-compact] Prompt loaded at startup: 7457 chars
[pi-smart-compact] Registered before_provider_request handler
```

**Still unresolved:** Whether `before_provider_request` fires during auto-compaction (needs testing with absolute path).

---

## Official Pi Example

Pi ships an official custom compaction example: `examples/extensions/custom-compaction.ts`.

**How it works:**
1. Listens to `session_before_compact`
2. Uses `ctx.modelRegistry.find("google", "gemini-3.5-flash")` to get a model
3. Uses `ctx.modelRegistry.getApiKeyAndHeaders(model)` to resolve auth
4. Calls `complete(model, ..., { apiKey, headers, env })`
5. Returns `{ compaction: { summary, firstKeptEntryId, tokensBefore } }`

**Key difference:** The example uses `ctx.modelRegistry` which is provided by Pi's extension runtime. Our extension receives `ctx` in the handler callback.

**What changed from our original code to the working version:**
1. Model name: `gemini-2.5-flash` → `gemini-3.5-flash` (likely the only difference needed)
2. Auth resolution: Added three-layer fallback copied from `pi-advisor` (may be unnecessary — untested isolation)

**Important note:** The official example targets a specific model (`gemini-3.5-flash`), not the session's current model. It assumes the user has Gemini configured. This avoids the "what model is Pi using?" problem by choosing its own model.

---

## Key Findings

### 1. Pi's compaction pipeline IS injectable from extensions

- `session_before_compact` fires with `(event, ctx)` — `ctx` includes `modelRegistry` and `ui`
- The official example proves custom summaries work via this hook
- Our extension confirmed this with a live 113k-token session

### 2. The `-e ./` path resolution bug (fixed)

Pi's `resolveExtensionEntries()` function fails to correctly resolve relative paths like `./` when looking up `package.json` with `pi.extensions`. Using the absolute path works. This is a Pi bug or limitation.

### 3. The MVP prompt is validated

`DRAFT_COMPACTION_PROMPT.md` (7,457 chars) was tested via simulation AND against a live Pi session (318 messages, 113k tokens). It produced a usable summary.

---

## Outstanding Questions

### 1. Is the auth workaround necessary?

The original code only differed from the official example in the model name (`2.5` vs `3.5`). We never isolated whether the three-layer auth fallback is needed or if fixing the model name was sufficient. The extension works with both changes stacked.

### 2. Does `before_provider_request` fire during auto-compaction?

We confirmed it fires during manual `/compact`, but never tested whether it fires when Pi auto-triggers compaction at the token threshold. This affects whether our extension works for auto-compaction or only manual.

### 3. Simplification opportunity

Since the extension works via the official example pattern, we could simplify the code to match it more closely — potentially removing the auth workaround entirely. Worth testing.

---

## Files Referenced

- Draft compaction prompt: `findings/DRAFT_COMPACTION_PROMPT.md`
- Simulation pipeline: `agent/simulate_compaction.py`
- Pi's built-in compaction: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js`
- Official example: `packages/coding-agent/examples/extensions/custom-compaction.ts`
- Extension types: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- Agent session (compaction flow): `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
- Extension loader: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`