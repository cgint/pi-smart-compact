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
- **MVP prompt complete.** Draft compaction prompt designed, grounded in all findings, tested with simulation pipeline.
- **Behavioral pilot complete.** Prompt optimized through 4 iterations; two-axis framework converged (see evolution docs).
- **Next:** Field testing — deploy refined prompt in live Pi sessions, observe resumed agent behavior, iterate based on real usage.
- **Evolution docs:** [`docs/compaction-evolution.md`](docs/compaction-evolution.md) — phase-scoped development history.
- **Open questions remain** — see below.

### Open questions
1. What exactly does Pi's built-in compaction do, and where does it fail?
2. Which trace-v2 / implementation patterns directly inform a better compaction prompt?
3. What do the original papers say about context window management and summarization?
4. How do we measure "better than built-in"?

### Timeline
- 2026-07-02T08:33Z — First Pi session started (see initial_session.md)
- 2026-07-02T11:20Z — Git re-initialized, North Star updated, .gitignore revised
- 2026-07-02T18:00Z — MVP prompt complete; transitioning to field testing phase
- 2026-07-03 — Behavioral pilot: rubric ≠ behavioral utility discovered; prompt optimized (1/3 → 3/3 → 22/25)
- 2026-07-05 — AI ergonomics convergence; two-axis framework; evolution docs created in `docs/`

## Precommit checks

```bash
npm run precommit
```

Runs TypeScript typecheck, tests, then `npm audit --audit-level=moderate`; all must pass.

## Regular maintenance

### Dependency refresh (run monthly or before releases)

```bash
bash ~/.local/bin/node_update_reinstall.sh
npm run precommit
```

Resets `node_modules` + lockfile, upgrades to latest semver-compatible versions, and runs audit. Keeps transitive vulnerabilities from accumulating.

### Dependency audit (current)

Last checked: 2026-11-02 — **0 vulnerabilities** after the in-range lock refresh to `@earendil-works/pi-coding-agent` **1.5.0** (declared `^1.0.0`). `npm run precommit` passes typecheck and **265 tests**. The native-tree spike's live row 1 is accepted; row 15 exact is now OBSERVED and ACCEPTED (SDK pre-token guard race, `manifest-final.json` / `hjqcw7r` harness). The full evidence gate remains unmet because row 2b (own escaping throw) is unobserved. The user approved an as-is personal-use branch trial with that risk documented; this is not a passed gate or `/retire` migration. See `docs/native-tree-retirement-session-goal.md` for current status and `docs/native-tree-retirement-plan.md` for the full criterion-to-evidence record. The 2026-07-06 zero-vulnerability check was against the then-current `^0.80.3` range; it is historical, not the current baseline.