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

Edit `prompts/smart-compaction-prompt.md` to change compaction behavior. No code changes needed — reload Pi with `/reload`.

## Structure

- **`index.ts`** — Entry point (delegates to `src/`)
- **`src/smart-compact.ts`** — Extension logic
- **`prompts/smart-compaction-prompt.md`** — The compaction prompt (single config point)
- **`test/`** — Smoke tests