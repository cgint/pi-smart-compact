# Findings: Trace-v2 Patterns

Source: `/Users/cgint/dev/decision-context-traces/data/trace-v2/gemini/` (sessions: dep-mgmt, ui-debug, remote-ssh, tech-sync, web-research, etc.)

---

## Architecture Overview

trace-v2 produces two parallel representations:
- **ContextTrace ("Physics")**: observable events from the raw session log — what happened
- **DecisionTrace ("Cognition")**: LLM-extracted decision signals — why it happened

Episodes = spans between user messages. Decision spans = multi-turn decision clusters.

---

## Findings

### F1: Preserve
**"Decision traces preserve intent, rationale, and evidence links per message"** — every AI message gets extracted intent, rationale, confidence, and evidence_event_indices pointing back to the raw log. This is a rich signal for compaction: the "why" is preserved alongside the "what".
*(Source: `/Users/cgint/dev/decision-context-traces/data/trace-v2/README.md` — decision_trace.json spec)*

### F2: Preserve
**"Evidence-backed decisions are high-confidence"** — 96.4% of messages in dep-mgmt session have rationale present, 96.4% have evidence refs. High rationale/evidence coverage means compaction can safely preserve evidence-backed decisions over un-backed ones.
*(Source: `/Users/cgint/dev/decision-context-traces/data/trace-v2/gemini/session-dep-mgmt/representation_metrics.md`)*

### F3: Preserve
**"Episodes provide natural compaction boundaries"** — each episode starts at a user message and spans until the next user message. This gives a principled way to segment sessions for compaction: summarize within episodes, preserve inter-episode transitions.
*(Source: `/Users/cgint/dev/decision-context-traces/data/trace-v2/README.md` — episode_trace.json)*

### F4: Preserve
**"Decision spans group multi-turn decisions"** — 56 events in dep-mgmt compress to 19 decision spans (2.11 spans/episode). This shows compaction is achievable: 56 events → 19 spans = 66% reduction while preserving decision structure.
*(Source: `/Users/cgint/dev/decision-context-traces/data/trace-v2/gemini/session-dep-mgmt/representation_metrics.md`)*

### F5: Remove
**"Per-message annotation is noisy"** — explicit decision signals at 73.2% (dep-mgmt) and 52.6% (ui-debug) suggest that not every message is a decision. The per-message level captures operational intent, but multi-turn decision spans are where real compaction value emerges.
*(Source: `/Users/cgint/dev/decision-context-traces/data/trace-v2/gemini/session-dep-mgmt/representation_metrics.md`, `/Users/cgint/dev/decision-context-traces/data/trace-v2/gemini/session-ui-debug/representation_metrics.md`)*

### F6: Remove
**"Implicit decision signals are abundant but lower signal"** — 23.2% of messages have implicit decisions (dep-mgmt), 39.5% (ui-debug). These are inferred from behavior, not stated. Compaction should deprioritize implicit signals.
*(Source: same as F5)*

### F7: Improve
**"Episode boundaries may not match real work units"** — episodes are segmented by user messages, but a single user message can spawn multiple distinct work threads. This is a known risk in the trace-v2 design.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — Critical risks, item 5)*

### F8: Improve
**"No outcome linkage in current trace-v2"** — decisions are captured with intent/rationale/evidence, but there's no success/failure feedback. A compaction system needs to know which decisions worked and which didn't to prioritize preservation.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — Critical risks, item 7)*

### F9: Preserve
**"Representation before optimization is the correct priority"** — trace-v2's core thesis: build faithful, reviewable traces first, then optimize. Compaction that sacrifices fidelity for size is counterproductive.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — Critical interpretation, Working thesis)*

### F10: Preserve
**"Separation of 'how' (observable) from 'why' (interpreted) is critical"** — ContextTrace captures what happened (facts, tool calls, outputs). DecisionTrace captures what was inferred (intent, rationale). A good compaction prompt should preserve both layers separately.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — What trace-v2 is)*

### F11: Remove
**"Over-compression loses raw detail needed for future reinterpretation"** — trace-v2 warns against over-compression: if you lose the raw detail, you can't re-interpret it later when new questions arise.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — Critical risks, item 4)*

### F12: Improve
**"Decision inflation is a real risk"** — labeling every instruction, plan, or observation as a "decision" inflates the signal. Compaction needs a stricter definition of what constitutes a decision worth preserving.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — Critical risks, item 6)*

### F13: Preserve
**"Pattern lift experiment proves knowledge patterns beat blind guessing"** — Blind context: 31% exact match rate. Patterned context: 44% (+13% lift). When patterns are injected, the model correctly selects tools 100% of the time (6/6).
*(Source: `/Users/cgint/dev/decision-context-traces/docs/benchmarks/20260119_pattern_vs_directive_experiment.md`)*

### F14: Preserve
**"Learned patterns capture 'physics' of a project"** — The pattern library encodes tacit knowledge: "look before leaping," "pivot to environment-native solutions," "trust but verify," "empty is a valid terminal result." These are the kinds of principles a compaction prompt should inject.
*(Source: `/Users/cgint/dev/decision-context-traces/docs/information/README_learned_patterns.md`)*

### F15: Preserve
**"Recursive synthesis preserves specialized wisdom"** — Extracting learnings per-session first, then synthesizing cross-session, preserves technical wisdom that would be averaged out in a single-stage pass. Compaction should use the same two-stage approach.
*(Source: `/Users/cgint/dev/decision-context-traces/docs/information/README_learned_patterns.md` — Point 6)*

### F16: Improve
**"Context graphs are not graph databases"** — Learned ontologies emerge from how work happens, not from a predefined schema. A compaction system shouldn't impose a rigid structure; it should preserve the flexibility for structure to emerge.
*(Source: `/Users/cgint/dev/decision-context-agent/docs/information/IDEA.md`)*

### F17: Preserve
**"You can't reliably capture the 'why'; you can capture the 'how'"** — One-shot rationale extraction is unreliable. Start from low-level activity/process traces and use repeated patterns in "how" to approximate "why" over time.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — Context_is_the_next_data_platform.txt)*

### F18: Improve
**"Proxy metric hacking is a real danger"** — High coverage rates (96% rationale present) may not mean useful representation. A compaction system that optimizes for coverage metrics may produce summaries that look complete but lack decision-relevant content.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — Critical risks, item 2)*

---

## Known Gaps

- **G1:** Only 2 sessions (dep-mgmt, ui-debug) fully read. More sessions would reveal session-type-specific compaction patterns (debugging vs. feature dev vs. research).
- **G2:** Episode context_trace.json and decision_span_trace.json not read — these may contain richer compaction signals.
- **G3:** No outcome labels in trace data — can't distinguish successful from failed decisions.