# Findings: Pi's Built-in Compaction (Baseline)

Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/` (installed package v0.80.3)

---

## Compaction Architecture

### Trigger condition
- Compaction triggers when: `contextTokens > contextWindow - reserveTokens`
- Default settings: `reserveTokens: 16384`, `keepRecentTokens: 20000`
- Two trigger modes: manual (`compact()`) and auto (`checkAndMaybeCompact()`)
- Auto-compaction handles: context overflow recovery (retry after compact) and threshold-based (no auto-retry)

### Cut point algorithm
- Walks backwards from newest entry, accumulating estimated message sizes
- Stops when accumulated tokens >= `keepRecentTokens`
- Cuts at valid message boundaries (user, assistant, custom, bashExecution) — NEVER at tool results
- Supports split turns: if cutting mid-turn, generates a separate "turn prefix" summary

### Summary generation
- Uses LLM to generate a structured summary of discarded history
- Two prompts: initial (`SUMMARIZATION_PROMPT`) and incremental (`UPDATE_SUMMARIZATION_PROMPT`)
- Conversation serialized to plain text with `[User]:`, `[Assistant]:`, `[Assistant thinking]:`, `[Assistant tool calls]:`, `[Tool result]:` markers
- Tool results truncated to 2000 chars for summarization
- File operations (read/write/edit) extracted and appended as XML tags

### Output format
- Summary follows a fixed template: Goal, Constraints & Preferences, Progress (Done/In Progress/Blocked), Key Decisions, Next Steps, Critical Context
- File operations appended as `<read-files>` and `<modified-files>` XML blocks
- Previous summary preserved and merged (incremental mode)

---

## Findings

### F1: Preserve
**"Compaction preserves exact file paths, function names, and error messages"** — the prompt explicitly instructs the model to preserve these. The code also extracts file operations (read/write/edit) as XML tags.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — SUMMARIZATION_PROMPT, `formatFileOperations()`)*

### F2: Preserve
**"Compaction preserves the last N tokens of conversation" (keepRecentTokens=20000)** — recent messages are always kept intact, never summarized away. This ensures the agent can continue from where it left off.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — `findCutPoint()`, DEFAULT_COMPACTION_SETTINGS)*

### F3: Preserve
**"Compaction preserves blockers, in-progress work, and next steps" via the structured template** — the summary template explicitly has sections for Blocked, In Progress, and Next Steps.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — SUMMARIZATION_PROMPT)*

### F4: Remove
**"Compaction discards ALL older conversation history" (before cut point)** — everything before the cut point is summarized into a single text block. No individual messages, no tool calls, no tool results are preserved verbatim.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — `prepareCompaction()`, `compact()`)*

### F5: Remove
**"Compaction discards tool result content entirely" (truncated to 2000 chars then summarized)** — tool outputs are truncated during serialization, then the entire conversation (including truncated tool results) is summarized. The actual content is lost.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js` — `TOOL_RESULT_MAX_CHARS = 2000`, `serializeConversation()`)*

### F6: Remove
**"Compaction discards thinking/reasoning content"** — thinking blocks are serialized as `[Assistant thinking]:` text but then summarized away. The actual reasoning process is lost.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js` — `serializeConversation()`)*

### F7: Improve
**"Compaction uses a generic, one-size-fits-all summary template" (Goal/Constraints/Progress/Decisions/Next Steps/Critical Context)** — the template is rigid and may not adapt to the specific nature of the session (debugging vs. feature development vs. research).
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — SUMMARIZATION_PROMPT)*

### F8: Improve
**"No custom instructions hook for session-specific compaction strategy" (customInstructions parameter exists but is rarely used)** — the `compact()` method accepts `customInstructions` that get appended to the prompt, but there's no automatic way to inject session-type-specific instructions (e.g., "this is a debugging session, preserve error traces").
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` — `compact(customInstructions)` at line 1292)*

### F9: Preserve
**"Compaction preserves the previous summary across compactions" (incremental mode)** — when a second compaction happens, the previous summary is fed back and merged, preventing information loss across multiple compaction cycles.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — `generateSummary()` accepts `previousSummary`, `UPDATE_SUMMARIZATION_PROMPT`)*

### F10: Improve
**"Token estimation is a rough heuristic (chars/4) — may overestimate or underestimate"** — the code uses `chars / 4` for token estimation, which is conservative (overestimates). This can trigger compaction earlier than necessary, losing information.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — `estimateTokens()`, `ESTIMATED_IMAGE_CHARS = 4800`)*

### F11: Remove
**"Compaction discards model changes and thinking level changes"** — these metadata events are excluded from the summary. If the session switched models or thinking levels, that context is lost.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — `findValidCutPoints()` skips `model_change` and `thinking_level_change`)*

### F12: Improve
**"No awareness of session phase or task type"** — the compaction prompt doesn't know whether the session is in planning, implementation, debugging, or review phase. It treats all sessions identically.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — `SUMMARIZATION_PROMPT` is session-type agnostic)*

### F13: Preserve
**"Compaction tracks file operations across compaction cycles"** — file read/write/edit operations are extracted from both current messages and previous compaction details, preserving file context.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — `extractFileOperations()`)*

### F14: Remove
**"System prompt is minimal and generic" (just "context summarization assistant")** — the system prompt provides no strategy, no domain awareness, no guidance on what to prioritize in the summary.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js` — `SUMMARIZATION_SYSTEM_PROMPT`)*

### F15: Improve
**"No preservation of user intent evolution"** — if the user's goal shifted during the session (e.g., from "implement feature X" to "debug issue Y"), the summary may not capture this transition well. The template has a single "Goal" section.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — SUMMARIZATION_PROMPT has single `## Goal` section)*

### F16: Improve
**"Turn prefix summary is separate from history summary" (split turns)** — when a turn is split, the prefix gets its own summary with "Original Request / Early Progress / Context for Suffix" structure, but this is a different template than the main summary. The two are concatenated with `---` separator.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — `TURN_PREFIX_SUMMARIZATION_PROMPT`, `compact()` merging)*

### F17: Preserve
**"Compaction preserves uncertainty and blockers" in the template** — the "Blocked" section explicitly captures issues preventing progress.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — SUMMARIZATION_PROMPT `### Blocked`)*

### F18: Improve
**"No evidence linking" — the summary does not reference specific messages, timestamps, or evidence IDs** — the summary is a free-text narrative with no way to trace back to the original conversation for verification.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — no evidence/reference tracking in prompts)*

---

## Known Gaps

- **G1:** Cannot verify actual summary quality without running compaction on real sessions. The code shows the mechanism but not the output quality.
- **G2:** Extension hook (`session_before_compact`) allows custom compaction content — this is a mechanism for improvement but not studied here.
- **G3:** Branch summarization is a separate feature — not covered in this baseline (covered in branch-summarization.js).