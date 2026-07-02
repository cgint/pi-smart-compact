# Findings: Papers & Research

Sources:
- `/Users/cgint/dev/decision-context-traces/papers/` (PDFs and text extracts)
- `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` (paper summaries)
- ArXiv: 2510.04618 (ACE — Agentic Context Engineering)
- ArXiv: 2511.18423 (GAM — General Agentic Memory)
- ArXiv: 2506.02009 (STRATUS/TNR — Transactional No-Regression)
- ArXiv: 2512.05765 (UCCT — Coordination Physics)
- `/Users/cgint/dev/decision-context-agent/docs/claude-code-learnings-prompt-caching.pdf`

---

## ACE — Agentic Context Engineering (2510.04618)

### F1: Preserve
**"Contexts should be evolving playbooks, not one-shot summaries"** — ACE treats contexts as accumulating artifacts that grow through generation, reflection, and curation. This supports the two-stage compaction approach: extract → refine → curate, rather than single-pass summarization.
*(Source: ArXiv 2510.04618 abstract — "contexts as evolving playbooks that accumulate, refine, and organize strategies through a modular process of generation, reflection, and curation")*

### F2: Preserve
**"Structured, incremental updates prevent context collapse"** — Iterative rewriting erodes details over time (context collapse). ACE prevents this by using structured, incremental updates that preserve detailed knowledge. A compaction prompt should use structured sections with incremental merge capability, not free-text rewrites.
*(Source: same — "prevents collapse with structured, incremental updates that preserve detailed knowledge")*

### F3: Preserve
**"Natural execution feedback enables self-improvement without labeled supervision"** — ACE adapts effectively using execution feedback alone, not requiring labeled training data. A compaction prompt could benefit from feedback loops: if a resumed agent fails, that failure should inform future compaction.
*(Source: same — "adapt effectively without labeled supervision and instead by leveraging natural execution feedback")*

### F4: Improve
**"Brevity bias drops domain insights for concise summaries"** — Prior approaches suffer from brevity bias: they prioritize short summaries over domain-specific insights. A compaction prompt must resist brevity bias and preserve domain-critical information even if it increases output size.
*(Source: same — "suffer from brevity bias, which drops domain insights for concise summaries")*

### F5: Improve
**"Context collapse is cumulative"** — Each round of iterative rewriting erodes more detail. This means compaction shouldn't be done repeatedly on already-compacted output; each cycle degrades quality. Compaction should operate on raw session data, not previous summaries.
*(Source: same — "context collapse, where iterative rewriting erodes details over time")*

---

## GAM — General Agentic Memory (2511.18423)

### F6: Preserve
**"Preserve history and retrieve/compile just-in-time"** — GAM's approach: don't over-compress raw sessions too early. Keep source references and provenance so future analyses can rehydrate detail. This validates the "externalized lookup" idea: preserve raw detail behind pointers, not inline.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — GAM theme summary)*

### F7: Preserve
**"Keep source references and provenance"** — Raw sessions should retain links to their origins so detail can be rehydrated on demand. A compaction prompt should include provenance markers, not just narrative summaries.
*(Source: same — "Keep source references and provenance so future analyses can rehydrate detail")*

---

## STRATUS / TNR (2506.02009)

### F8: Preserve
**"Outcome linkage is essential"** — STRATUS emphasizes transactional no-regression: decisions should be linked to their outcomes. A compaction system that doesn't track success/failure may preserve failed decisions and discard successful ones.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — STRATUS theme summary)*

### F9: Improve
**"Did the decision work?" matters more than "was the rationale plausible?"** — STRATUS shifts evaluation from plausible reasoning to actual outcomes. A compaction prompt should prioritize outcomes over rationale: what worked vs. what sounded good.
*(Source: same — "The signal moves from 'did you generate good text' to 'did the decision work'")*

---

## UCCT — Coordination Physics (2512.05765)

### F10: Preserve
**"Semantic anchoring stabilizes reasoning"** — UCCT's coordination layer uses semantic anchoring to maintain reasoning stability across context boundaries. A compaction prompt should anchor key concepts (file paths, function names, constraints) to prevent drift.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — UCCT theme summary)*

---

## Claude Code Learnings: Prompt Caching (PDF)

### F11: Preserve
**"Prompt caching rewards stable structure"** — Claude Code's prompt caching system benefits from stable, repeated structure in prompts. A compaction prompt with consistent section ordering and formatting would benefit from caching, reducing latency and cost.
*(Source: `/Users/cgint/dev/decision-context-agent/docs/claude-code-learnings-prompt-caching.pdf` — title/theme)*

### F12: Improve
**"Prompt structure affects caching efficiency"** — If the compaction prompt structure varies significantly between sessions, caching benefits decrease. A standardized compaction prompt template would maximize caching.
*(Source: same — title/theme implies caching sensitivity to prompt structure)*

---

## Concept Memo: Information-Centric Agent Architecture (v3)

### F13: Preserve
**"Information Pool + Control Mechanism replaces brittle multi-agent hierarchy"** — The architecture separates information (where knowledge lives) from control (who acts on it). A compaction prompt should separate preserved information (facts, decisions, evidence) from control signals (next steps, priorities).
*(Source: `/Users/cgint/dev/decision-context-traces/papers/Concept Memo_ An Information-Centric Agent Architecture (v3).pdf` — key architecture concept)*

### F14: Preserve
**"Provenance is crucial: each information item should track origin and relation to decisions/actions"** — Every preserved piece of information should have provenance tracking. A compaction prompt should include origin markers for preserved facts.
*(Source: same — "Provenance is crucial: each information item should track origin and relation to decisions/actions")*

### F15: Improve
**"Central issue is not just context size but context coherence and accessibility"** — The problem isn't purely about reducing tokens; it's about maintaining coherent, accessible context. A compaction prompt should optimize for coherence and accessibility, not just size.
*(Source: same — "Central issue is not just context size but context coherence and accessibility")*

---

## Critical Risks from Papers (docs-papers-map)

### F16: Improve
**"Narrative hallucination" — LLM rationales sound plausible but are not source-grounded** — Papers warn that extracted rationales may be hallucinated. A compaction prompt should require evidence links for all preserved claims.
*(Source: `/Users/cgint/dev/decision-context-traces/agent/docs-papers-map.md` — Critical risks, item 1)*

### F17: Improve
**"Proxy metric hacking" — high coverage may not mean useful representation** — Optimizing for coverage metrics (e.g., "all sections filled") can produce summaries that look complete but lack decision-relevant content.
*(Source: same — Critical risks, item 2)*

### F18: Improve
**"Premature ontology" — imposing fixed schemas before enough evidence accumulates** — Papers warn against defining rigid structures too early. A compaction prompt should be flexible enough to adapt to different session types.
*(Source: same — Critical risks, item 3)*

### F19: Improve
**"Over-compression" — losing raw detail needed for future reinterpretation** — If compaction removes too much, the original intent cannot be reconstructed later.
*(Source: same — Critical risks, item 4)*

---

## Known Gaps

- **G1:** PDF papers could not be read directly (binary format). Text-based summaries from docs-papers-map were used instead.
- **G2:** ACE paper (2510.04618) only read at abstract level — full paper would reveal more specific techniques.
- **G3:** STRATUS/TNR (2506.02009) and UCCT (2512.05765) only read at theme level from docs-papers-map.
- **G4:** Claude Code prompt caching PDF not read (binary). Theme inferred from title.