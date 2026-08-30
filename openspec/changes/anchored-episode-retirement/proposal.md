# Anchored Episode Retirement for Predictable Working Memory Management

## Why
The current scalar count interface requires agents to guess hidden history counts. Anchored inspection supplies mechanical conversation facts and a witness-authorized boundary.

## What Changes
- **Selection:** `fromEpisodeInclusive` names the oldest completed episode in the selected newest suffix. Candidates are newest-first; `ep-N` means Nth newest completed episode and selects that completed episode through `ep-1`. Unsafe candidates are omitted without renumbering IDs; active work is excluded.
- **Inspection:** Cursorless `inspect_episode_retirement({ cursor? })` evaluates every count, creates the one current in-memory witness grant, and returns bounded candidate pages, active episode, aggregate counts/refusals, witness, and nullable cursor. Cursor calls page the stored grant only.
- **Bound and metric:** Complete candidate records are dynamically packed after measuring complete provider-content and details payloads separately; each is <=2048 UTF-8 bytes. `sourceMessageBytes` is UTF-8 bytes of non-pretty `JSON.stringify(selectedProviderMessages)`, never bytes freed.
- **Freshness:** Grant digest covers canonical resolved local state through active user root and excludes later active traffic. Execution requires the current witness, matching digest, stored anchor/preflight binding, valid goal, and valid pin; grant consumption occurs only after append.
- **Pinned state and V5:** Preserve the settled pin contract. Every new receipt is strict V5 with a mode and original pin; V1–V4 validators remain unchanged, mixed chains remain valid, and projection is latest-receipt-only.

## Impact
Planned source and tests: `src/episode-retirement.ts`, retirement test suites, README/docs. Implementation is authorized; TDD is pending.
