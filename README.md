# pi-smart-compact

Pi extension that replaces Pi's built-in compaction with a prompt-only mechanism designed to produce minimal, high-signal continuation context.

## How it works

The extension intercepts Pi's compaction via the `session_before_compact` hook and replaces it with a custom LLM call. The compaction prompt lives in `findings/DRAFT_COMPACTION_PROMPT.md` — edit that file to change behavior. No code changes needed.

## Installation

```bash
pipa install -c .
```

## Usage

No configuration needed. The extension activates automatically when Pi detects a session is approaching the context window limit.

To change the compaction behavior, edit `findings/DRAFT_COMPACTION_PROMPT.md` and reload Pi.

## Architecture

- **`index.ts`** — Extension entry point. Listens for `session_before_compact`, loads the prompt from markdown, calls the LLM, returns the result.
- **`findings/DRAFT_COMPACTION_PROMPT.md`** — The compaction prompt. This is the only configuration point.
- **`agent/simulate_compaction.py`** — Standalone test script for iterating on the prompt without running Pi.

## Graceful degradation

If the LLM call fails (network error, API error, model unavailable), the extension falls back to Pi's built-in compaction automatically. No session disruption.