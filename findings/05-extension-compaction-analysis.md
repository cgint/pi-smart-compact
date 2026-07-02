# 05 — Extension Compaction Investigation

## Executive Summary

**Conclusion:** Pi's compaction pipeline is **not injectable from extensions** in a way that allows custom prompt templates. The `session_before_compact` hook fires, but extensions cannot independently call the LLM to generate a custom summary because Pi's auth layer (`modelRegistry`) is inaccessible from extension context.

The MVP prompt (`DRAFT_COMPACTION_PROMPT.md`) is complete and tested via simulation, but has never been validated against a live session because the extension mechanism to deliver it does not work.

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
2. Uses `ctx.modelRegistry.find("google", "gemini-2.5-flash")` to get a model
3. Uses `ctx.modelRegistry.getApiKeyAndHeaders(model)` to resolve auth
4. Calls `complete(model, ..., { apiKey, headers, env })`
5. Returns `{ compaction: { summary, firstKeptEntryId, tokensBefore } }`

**Key difference:** The example uses `ctx.modelRegistry` which is provided by Pi's extension runtime. Our extension never received `ctx` — only `event` and `result`.

**Why it might differ:** The official example uses `ctx.modelRegistry` which is bound at runtime by `ExtensionRunner.bindCore()`. Our code tried to derive the model externally. The official example also uses `ctx.ui.notify()` for user feedback.

**Important note:** The official example targets a specific model (`gemini-2.5-flash`), not the session's current model. It assumes the user has Gemini configured. This avoids the "what model is Pi using?" problem by choosing its own model.

---

## Key Findings

### 1. Pi's compaction pipeline is sealed

- `session_before_compact` fires but does not pass the model
- `before_provider_request` fires for agent LLM calls but its behavior during auto-compaction is unverified
- `modelRegistry` is only accessible via `ctx` in the handler, not via the event
- `completeSimple()` requires an authenticated `Model` object from Pi's internal registry

### 2. The `-e ./` path resolution bug

Pi's `resolveExtensionEntries()` function fails to correctly resolve relative paths like `./` when looking up `package.json` with `pi.extensions`. Using the absolute path works. This is a Pi bug or limitation.

### 3. The MVP prompt is ready but unvalidated

`DRAFT_COMPACTION_PROMPT.md` (7,457 chars) was designed based on:
- Pi's built-in compaction baseline analysis
- Trace-v2 pattern analysis from real sessions
- Implementation code strategies
- Academic papers on context compression

It was tested via simulation (`simulate_compaction.py`) but never against a live Pi session because the delivery mechanism (extension) failed.

---

## What Would Be Needed to Make This Work

### Option A: Use `ctx.modelRegistry` (recommended)

The official example uses `ctx.modelRegistry` to resolve models and auth. Our extension should do the same:

```typescript
pi.on("session_before_compact", async (event, ctx) => {
    // Use the session's current model (not a hardcoded one)
    const model = ctx.model; // if available
    // or: ctx.modelRegistry.find(provider, modelId)
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    // call complete() with auth
});
```

**Problem:** We don't know if `ctx` includes `model` or `modelRegistry` in Pi v0.80.3. The official example might target a newer version.

### Option B: Patch Pi's source

Modify Pi's compaction prompts directly in the source code. This is the only guaranteed way to swap them, but requires maintaining a fork of Pi.

### Option C: Accept the limitation

Pi's compaction is not injectable from extensions in the current version. Document this and move on.

---

## Files Referenced

- Draft compaction prompt: `findings/DRAFT_COMPACTION_PROMPT.md`
- Simulation pipeline: `agent/simulate_compaction.py`
- Pi's built-in compaction: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js`
- Official example: `packages/coding-agent/examples/extensions/custom-compaction.ts`
- Extension types: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- Agent session (compaction flow): `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
- Extension loader: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`