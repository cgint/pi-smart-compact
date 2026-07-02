# Consolidated Findings — Compaction Strategy

Derived from: 01-pi-compaction-baseline.md, 02-trace-v2-patterns.md, 03-implementation-code-strategies.md, 04-papers-research.md

---

## What to PRESERVE (keep in compaction output)

### P1: Structured sections with explicit categories
Pi's template (Goal, Constraints, Progress, Decisions, Next Steps, Critical Context) forces organization. Better compaction should use a similar but more flexible structure.
*(Sources: compaction.js SUMMARIZATION_PROMPT, derive_minimal_context_packs.py PACK_CONTEXT_RULES, papers-map Critical interpretation)*

### P2: Evidence-linked decisions
Every preserved decision should have: intent, rationale, evidence refs, confidence. 96.4% of messages in trace-v2 have rationale present — this is the signal to preserve.
*(Sources: trace-v2 README.md, representation_metrics.md, docs-papers-map Provenance is crucial)*

### P3: Incremental merge capability
Previous summaries should be merged (not replaced) across compaction cycles. Prevents information loss over multiple compactions.
*(Sources: compaction.js UPDATE_SUMMARIZATION_PROMPT, ACE paper 2510.04618)*

### P4: File operations as separate section
Read/write/edit files should be tracked separately from narrative summary. Clean separation of concerns.
*(Sources: compaction.js formatFileOperations(), derive_minimal_context_packs.py render_minimal_pack)*

### P5: Recent context kept intact
Last ~20K tokens of conversation should always be preserved verbatim. Only older history is summarized.
*(Sources: compaction.js DEFAULT_COMPACTION_SETTINGS keepRecentTokens=20000)*

### P6: Session-type awareness
Compaction should adapt to session type (debugging, feature dev, research, deployment). Different sessions prioritize different information.
*(Sources: papers-map Information-Centric Architecture, derive_minimal_context_packs.py tool-specific rendering)*

### P7: Learned behavioral patterns
Holistic context gathering ("look before leaping"), environment-aware pivot on failure, trust-but-verify fidelity checks, empty-is-valid-terminal-result, local-rules-over-defaults. These are the kinds of principles a compaction prompt should inject.
*(Sources: README_learned_patterns.md Points 1-5)*

### P8: Two-stage extraction (per-session then cross-session)
Recursive synthesis preserves specialized wisdom that single-stage summarization averages out. Compaction should use this approach.
*(Sources: README_learned_patterns.md Point 6, papers-map Compound Engineering)*

### P9: Representation before optimization
Faithful, reviewable traces first, then optimize. Compaction that sacrifices fidelity for size is counterproductive.
*(Sources: papers-map Working thesis, derive_minimal_context_packs.py PACK_CONTEXT_RULES_COMPRESSED)*

### P10: Outcome linkage
Decisions should be linked to their outcomes (success/failure). This distinguishes reliable decisions from plausible-but-wrong ones.
*(Sources: papers-map STRATUS/TNR, derive_action_packs.py status field)*

### P11: Semantic anchoring
Key concepts (file paths, function names, constraints) should be anchored to prevent drift across compaction boundaries.
*(Sources: compaction.js explicit preservation of paths/names/errors, papers-map UCCT)*

### P12: Provenance tracking
Each preserved information item should track origin and relation to decisions/actions.
*(Sources: papers-map Concept Memo, trace-v2 evidence_event_indices)*

---

## What to REMOVE (discard from compaction output)

### R1: Tool result content
Truncated to 2000 chars then summarized. Original content is lost. Discard unless critical context.
*(Sources: compaction.js TOOL_RESULT_MAX_CHARS=2000, serializeConversation)*

### R2: Thinking/reasoning content
Thinking blocks are serialized but then summarized away. The actual reasoning process is lost.
*(Sources: compaction.js serializeConversation thinking handling)*

### R3: Stale planning chatter
Repeated explanations, low-value tool narration, details that no longer influence the next decision.
*(Sources: NORTH-STAR.md, compaction.js no explicit removal strategy)*

### R4: Outdated hypotheses
Hypotheses that were disproven or superseded should be removed, not preserved.
*(Sources: NORTH-STAR.md, derive_minimal_context_packs.py prune_context_lines narrative markers)*

### R5: Redundant summaries
Already-settled work repeated in multiple messages.
*(Sources: NORTH-STAR.md, derive_minimal_context_packs.py dedup logic)*

### R6: Per-message granularity
Not every message is a decision. 73% explicit, 23% implicit in trace-v2. Per-message annotation is noisy; multi-turn decision spans are where compaction value emerges.
*(Sources: representation_metrics.md, docs-papers-map Decision inflation risk)*

### R7: Narrative markers and self-references
Lines with "previous step", "last step", "already", "has been performed" add noise.
*(Sources: derive_minimal_context_packs.py prune_context_lines narrative_markers)*

### R8: Tool names in context bullets
Context should focus on what's needed to execute, not what tools were used.
*(Sources: derive_minimal_context_packs.py PACK_CONTEXT_RULES_SUFFICIENT)*

---

## What to IMPROVE (change from current approach)

### I1: System prompt is minimal and generic
"You are a context summarization assistant" gives no compaction strategy, no prioritization guidance, no awareness of agentic session dynamics.
*(Source: compaction.js SUMMARIZATION_SYSTEM_PROMPT)*

### I2: No session-type awareness
Same prompt for debugging, feature development, research, deployment. Should adapt strategy to session type.
*(Source: compaction.js SUMMARIZATION_PROMPT is session-type agnostic)*

### I3: No evidence linking
Free-text narrative with no references back to specific messages, timestamps, or evidence IDs.
*(Source: compaction.js no evidence/reference tracking in prompts)*

### I4: No awareness of session phase
Doesn't know if session is in planning, implementation, debugging, or review phase.
*(Source: compaction.js SUMMARIZATION_PROMPT)*

### I5: No custom instructions hook for session-specific strategy
customInstructions parameter exists but is rarely used. No automatic injection of session-type-specific instructions.
*(Source: agent-session.js compact(customInstructions))*

### I6: Token estimation is rough heuristic
chars/4 overestimates tokens, triggering compaction earlier than necessary.
*(Source: compaction.js estimateTokens()*

### I7: No preservation of user intent evolution
Single "Goal" section can't capture goal shifts during session (e.g., feature → debugging).
*(Source: compaction.js SUMMARIZATION_PROMPT)*

### I8: Brevity bias drops domain insights
Prior approaches prioritize short summaries over domain-specific insights.
*(Source: ACE paper 2510.04618)*

### I9: Over-compression loses raw detail
If compaction removes too much, original intent cannot be reconstructed later.
*(Source: papers-map Critical risks item 4)*

### I10: Proxy metric hacking
High coverage rates may not mean useful representation.
*(Source: papers-map Critical risks item 2)*

### I11: Premature ontology
Imposing fixed schemas before enough evidence accumulates.
*(Source: papers-map Critical risks item 3)*

### I12: Narrative hallucination
LLM rationales sound plausible but may not be source-grounded.
*(Source: papers-map Critical risks item 1)*

---

## Compaction Design Principles (derived)

1. **Structured sections > free-text narrative** — Force organization with explicit categories.
2. **Evidence-linked > standalone claims** — Every preserved decision has intent, rationale, evidence refs.
3. **Incremental merge > one-shot rewrite** — Previous summaries are merged, not replaced.
4. **Separation of concerns** — File operations, decisions, next steps in separate sections.
5. **Recent context preserved > summarized** — Last ~20K tokens kept verbatim.
6. **Session-type adaptive > one-size-fits-all** — Different sessions need different compaction strategies.
7. **Two-stage extraction > single-pass** — Per-session extraction, then cross-session synthesis.
8. **Fidelity > brevity** — Preserve domain-critical information even if it increases output size.
9. **Outcome-linked > rationale-only** — Track what worked, not just what was planned.
10. **Provenance > anonymous facts** — Every preserved item has origin tracking.