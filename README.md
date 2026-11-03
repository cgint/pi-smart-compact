# pi-smart-compact

Pi extension that replaces built-in compaction with a smarter prompt-driven summary.

## How it works

Intercepts Pi's `session_before_compact` event and generates a summary using a custom prompt optimized for behavioral resumption — preserving decisions, blockers, active work state, and specific error details. Summarizes with a Gemini Flash model (the model ID is hard-coded in `src/smart-compact.ts`; there is no env var for it) and falls back to the session's current model if that model is unavailable.

Graceful degradation: if the LLM call fails, Pi's built-in compaction runs instead.

## Installation

```bash
cd pi-smart-compact
npm install
pipa install -c .
```

## Configuration

Enable the extension by setting the environment variable:

```bash
export PI_SMART_COMPACT_ENABLED=true
```

By default the extension is **disabled** (Pi's built-in compaction runs). Set the env var to `true` to activate.

Edit `prompts/smart-compaction-prompt.md` to change compaction behavior. No code changes needed — reload Pi with `/reload`.

### Native-tree retirement (sole/default creation path)

Native-tree branch handoff is the **sole and default** context-retirement path and is registered unconditionally — **no environment flag is required** (`PI_NATIVE_TREE_HANDOFF_ENABLED` is no longer read). Two agent tools and one user command are always available:

- `native_tree_targets` — lists candidate non-user ancestors on the current branch (newest first) with entry ids and excerpts.
- `handoff_record` — records an exact handoff text for a chosen assistant `targetId`; its tool-result `details` carry `{ schema, handoffId, targetId, text, sha256 }`.
- `/tree-handoff <handoffId>` — the **explicit user confirmation** that applies a recorded handoff (re-validates the branch, then navigates). The agent never applies it and must never claim it was applied.

Use the `/retire` prompt (always available) to guide the active agent: it calls `native_tree_targets`, authors the handoff text, calls `handoff_record` once, then tells the user the exact `/tree-handoff <handoffId>` command to run and confirm themselves. Optional `/retire <text>` adds continuation emphasis (never a boundary or count). See `docs/native-tree-retirement-plan.md` for the runtime contract and evidence record.

### Episode retirement (legacy read-only)

The episode-retirement **creation** tools (`inspect_episode_retirement`, `retire_episodes`) and the `PI_EPISODE_RETIREMENT_ENABLED` gate are retired; native-tree handoff replaces them. Historical sessions that already contain episode-retirement receipts (V1–V5) stay projectable and recallable with no env flag: `recall_episode` returns the exact original messages covered by the latest valid stored receipt, and a `context` handler projects the latest valid receipt’s pin and capsule into the provider input — **only while that receipt chain is valid and reachable on the current branch**. A branch switch that drops the receipts makes their projection/recall unavailable there. This read path appends no receipts and performs no model/network egress. A malformed, inactive, tampered, or natively compacted chain is ignored for projection and refused for recall.

Projection uses only the latest valid receipt’s pin and capsule; recall remains cumulative raw provenance. Receipts pair public `ReadonlySessionManager.buildContextEntries()` producers with `buildSessionContext()` messages, preserving the resolved provider-input prefix exactly and validating only the selected source-to-active interval; nonstandard slots (discuss metadata, `custom_message`, compaction, branch-summary, old-image prefixes) are opaque and permitted but never eligible as sources. Capsules have exactly five fields bounded to 2,000 characters, items to 1,000, arrays to 32, serialized JSON to 8,000. Legacy projection and `recall_episode` work only while the receipt chain is valid and reachable on the current branch.

## Structure

- **`index.ts`** — Entry point (delegates to `src/`)
- **`src/smart-compact.ts`** — Smart compaction logic (env-var toggle, summary model selection, fallback)
- **`src/episode-retirement.ts`** — Legacy read-only episode retirement (receipt projection + `recall_episode`; creation tools retired)
- **`src/episode-retirement-prompt.ts`** — Registers the `/retire` prompt unconditionally (guides native-tree handoff)
- **`src/native-tree-handoff.ts`** — Native-tree handoff (sole/default creation path): `native_tree_targets`, `handoff_record`, `/tree-handoff`
- **`prompts/smart-compaction-prompt.md`** — The compaction prompt (single config point)
- **`prompts/retire.md`** — The `/retire` prompt template
- **`test/`** — Active offline suite: registration, read-path projection/recall regressions (malformed, multi-chain, opaque prefixes, source tamper), and authentic V5 initial→forward/recompose/deepen chains. Removed creation-path tests are not retained in-tree; git history holds the originals.