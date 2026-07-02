# Findings: Implementation Code Strategies

Sources:
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/` (Pi's built-in compaction)
- `/Users/cgint/dev/decision-context-agent/derive_minimal_context_packs.py` (DSPy minimal context packs)
- `/Users/cgint/dev/decision-context-traces/synthesize_patterns.py` (pattern synthesis)

---

## Pi's Built-in Compaction (from Slice 1 baseline)

### F1: Preserve
**"Structured summary template with explicit sections" (Goal, Constraints, Progress, Decisions, Next Steps, Critical Context)** — the template forces the model to organize information, not just dump text. A better compaction prompt should use a similar but more flexible structure.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js` — `SUMMARIZATION_PROMPT`)*

### F2: Preserve
**"Incremental compaction preserves previous summaries"** — when compaction runs again, the previous summary is merged (not replaced). This prevents information loss across multiple compaction cycles.
*(Source: same — `UPDATE_SUMMARIZATION_PROMPT`, `generateSummary()` accepts `previousSummary`)*

### F3: Preserve
**"File operations are extracted and appended as XML tags"** — read/write/edit files are tracked separately from the narrative summary. This is a clean separation of concerns.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js` — `formatFileOperations()`)*

### F4: Remove
**"Tool results truncated to 2000 chars before summarization"** — tool outputs are heavily truncated, then the truncated version is summarized. Original content is lost.
*(Source: same — `TOOL_RESULT_MAX_CHARS = 2000`, `serializeConversation()`)*

### F5: Improve
**"Generic system prompt provides no strategy"** — "You are a context summarization assistant" gives the model no compaction strategy, no prioritization guidance, no awareness of what matters in an agentic session.
*(Source: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js` — `SUMMARIZATION_SYSTEM_PROMPT`)*

### F6: Improve
**"No session-type awareness"** — the same prompt is used for debugging, feature development, research, and deployment sessions. A better system would adapt the compaction strategy to session type.
*(Source: same — `SUMMARIZATION_PROMPT` is session-type agnostic)*

### F7: Improve
**"No evidence linking"** — the summary is free-text narrative with no references back to specific messages, timestamps, or evidence IDs. The resumed agent can't verify claims.
*(Source: same — no evidence/reference tracking in prompts)*

---

## Minimal Context Packs (decision-context-agent)

### F8: Preserve
**"Per-step minimal context with strict rules"** — the `PACK_CONTEXT_RULES_COMPRESSED` rules are excellent: focus on current step only, no tool args (unless anchors needed), no tool results, omit goal unless required. This is a compaction strategy that works at the step level.
*(Source: `/Users/cgint/dev/decision-context-agent/derive_minimal_context_packs.py` — `PACK_CONTEXT_RULES_COMPRESSED`)*

### F9: Preserve
**"Context pruning removes narrative markers and redundant info"** — `prune_context_lines()` removes lines with "previous step", "last step", "already", tool names in context bullets, and deduplicates. This is a principled approach to reducing noise.
*(Source: same — `prune_context_lines()` function)*

### F10: Preserve
**"Two context modes: compressed vs sufficient"** — compressed forbids arg anchors (pure principle); sufficient allows minimal anchors (paths, URLs, commands). This dual-mode approach lets you trade precision for generality.
*(Source: same — `PACK_CONTEXT_RULES_COMPRESSED` vs `PACK_CONTEXT_RULES_SUFFICIENT`)*

### F11: Preserve
**"Tool-specific context rendering"** — each tool type has custom context rendering (e.g., `google_web_search` gets "- Search query:", `write_file` gets "- Write to:", `replace` gets "- Replace in:" with truncated instruction). This is domain-aware compaction.
*(Source: same — `render_minimal_pack()` function with tool-specific branches)*

### F12: Preserve
**"Token ratio tracking"** — each step tracks full_tokens, minimal_tokens, and ratio. This provides quantitative evidence of compaction effectiveness (compression ratio).
*(Source: same — `MinimalPack` dataclass, `render_output()`)*

### F13: Improve
**"DSPy-dependent"** — the minimal context pack derivation uses DSPy (a machine learning framework), which is heavy infrastructure for what should be a prompt-based solution. The principles are valuable but the implementation is not portable.
*(Source: same — imports `dspy`, uses `dspy.Predict`, `dspy.Signature`)*

---

## Learned Patterns (from decision-context-traces)

### F14: Preserve
**"Holistic context gathering is the golden rule"** — successful agents "look before leaping" using multi-source inspection. A compaction prompt should encode this as a behavioral rule.
*(Source: `/Users/cgint/dev/decision-context-traces/docs/information/README_learned_patterns.md` — Point 1)*

### F15: Preserve
**"Environment-aware pivot on first failure"** — successful agents immediately switch to environment-native solutions after the first failure (e.g., pip → uv). This is a critical behavioral pattern to preserve in compaction.
*(Source: same — Point 2)*

### F16: Preserve
**"Trust but verify: manual fidelity check"** — high-performing agents read generated files to verify logical/format correctness, not just check exit codes. This is a compaction-relevant behavioral pattern.
*(Source: same — Point 3)*

### F17: Preserve
**"Empty is a valid terminal result"** — the "infinite loading" hang when background processes return empty results is a recurring failure mode. Compaction should preserve explicit empty-result signals.
*(Source: same — Point 4)*

### F18: Preserve
**"Local rules override general defaults"** — the pattern library prioritizes local `.mdc` and `.env` rules over general best practices. A compaction prompt should preserve local project conventions.
*(Source: same — Point 5)*

### F19: Preserve
**"Recursive synthesis preserves specialized wisdom"** — two-stage extraction (per-session then cross-session) preserves technical wisdom that would be lost in single-stage summarization. Compaction should use this approach.
*(Source: same — Point 6)*

---

## Compound Engineering (trace-v2)

### F20: Preserve
**"Representation precedes optimization"** — the fundamental principle of trace-v2: build faithful, reviewable traces first, then optimize. Compaction that sacrifices fidelity for size is counterproductive.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — Core synthesis)*

### F21: Preserve
**"Faithful, inspectable, evidence-linked representation"** — the working thesis: optimize for representation quality first. A compaction prompt should be inspectable and evidence-linked, not a black-box summary.
*(Source: same — Critical interpretation, Working thesis)*

### F22: Improve
**"Over-compression loses raw detail"** — if compaction removes too much, future reinterpretation is impossible. Compaction should preserve enough detail that the original intent can be reconstructed.
*(Source: same — Critical risks, item 4)*

### F23: Improve
**"No outcome linkage"** — decisions captured without success/failure feedback cannot become reliable organizational physics. A compaction system that doesn't track outcomes may preserve failed decisions and discard successful ones.
*(Source: same — Critical risks, item 7)*

---

## Known Gaps

- **G1:** Only `derive_minimal_context_packs.py` read. `derive_action_packs.py`, `replay_evaluation.py`, and `synthesize_patterns.py` not yet examined.
- **G2:** No actual minimal context pack outputs read — only the derivation code. The outputs would show what compaction actually looks like.
- **G3:** Pi's extension hook (`session_before_compact`) not examined — may provide custom compaction strategies.