# pi-smart-compact — Session Memory

## 2026-07-02 — Session state

### Current state
- Fresh git repo (re-initialized after removing stale history).
- Repo focused on **compaction strategy** — not a general knowledge base.
- Primary goal: design a **prompt-only compaction mechanism** that outperforms Pi's built-in compaction.
- Secondary: externalized lookup (curated snippets + raw log fallback) — only if prompt-only is insufficient.

### Key decisions
- **Prompt-only first milestone:** One prompt transforms an overloaded session into minimal, high-value continuation context. No side files, no lookup tables during compaction.
- **References, not copies:** Do not duplicate source material. Synthesize and reference exact paths.
- **`agent/` is tracked** (internal workspace), not ignored. Artifacts/cache are ignored.
- North Star updated: compaction = representation discipline, not text shortening.

### Source material (references, not copies)
- Local `pi-*` repos: `/Users/cgint/dev/concepts/pi-*`
- `decision-context-*` repos: `../../decision-context-traces/`, `../../decision-context-agent/`
- Original papers: referenced in sources/research-map.md

### Active work
- **Not yet started.** No research slices executed yet.
- Pending: pivot research plan to focus on prompt-only compaction design.

### Open questions
1. What exactly does Pi's built-in compaction do, and where does it fail?
2. Which trace-v2 / implementation patterns directly inform a better compaction prompt?
3. What do the original papers say about context window management and summarization?
4. How do we measure "better than built-in"?

### Timeline
- 2026-07-02T08:33Z — First Pi session started (see initial_session.md)
- 2026-07-02T11:20Z — Git re-initialized, North Star updated, .gitignore revised