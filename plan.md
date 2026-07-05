# Plan — Prompt-Only Compaction Research

## Status
Draft 2026-07-02, updated 2026-07-05. Aligned to NORTH-STAR: prompt-only compaction as first milestone.

## Evolution tracking
Phase-scoped evolution documents in [`docs/compaction-evolution.md`](docs/compaction-evolution.md). Current phase: 01 (Behavioral Pilot & Prompt Optimization) — complete. See handoff point for next phase entry.

## Phased approach

### Phase 1 — Collect (information gathering)
Gather findings from all sources. No synthesis or drafting yet. Accumulate evidence.

### Phase 2 — Synthesize (combine → draft)
Combine collected findings into a compaction prompt. Evaluate against NORTH-STAR criteria.

## Phase 1: Research slices

### 1. Baseline: Pi's built-in compaction
- Find and read Pi's compaction implementation (prompt templates, strategies, limitations).
- Identify where it succeeds and where it fails (stale content retention, context window waste, loss of decision state).
- **Finding to capture:** documented baseline of what Pi does now and known failure modes.

### 2. Trace-v2 patterns
- Read trace-v2 sessions for evidence of: what gets lost, what's preserved, where compaction helps or harms.
- Look for patterns in representation_metrics.md: span counts, episode boundaries, decision coverage.
- **Finding to capture:** list of actionable insights that inform what a compaction prompt should preserve/remove.

### 3. Implementation code strategies
- Search referenced repos for: minimal context packs, session builders, context window management, summarization prompts.
- Extract prompt patterns, strategies, and design decisions that directly apply to compaction.
- **Finding to capture:** catalog of compaction strategies with source references.

### 4. Papers
- Consult papers referenced in sources/research-map.md for context window management, summarization, and agent memory theories.
- **Finding to capture:** theoretical grounding and specific techniques applicable to prompt-based compaction.

## Phase 2: Synthesize
- Combine findings from slices 1-4 into a single compaction prompt.
- Test: run against a real Pi session (if possible) or evaluate against criteria from NORTH-STAR.
- **Output:** draft compaction prompt + evaluation notes.

## Phase 2.5: Behavioral Pilot (complete)
- Ran behavioral resumption experiments proving rubric scores ≠ behavioral utility.
- Optimized prompt through 4 iterations; discovered structural ceiling (70% split).
- Converged two-axis framework from independent sessions.
- **Output:** [`docs/compaction-evolution-01-behavioral-pilot.md`](docs/compaction-evolution-01-behavioral-pilot.md)

## Phase 3: Field Testing (next phase)
- Deploy the draft prompt in live Pi sessions.
- Observe: does the resumed agent pick up smoothly? Any confusion or drift?
- Compare: run Pi's built-in compaction on the same sessions and note differences in UX.
- Iterate: refine the prompt based on real usage, not synthetic benchmarks.
- **Output:** field notes, prompt revisions, and a verdict on whether it's actually better.

## Pre-flight check
- Verify all relative paths resolve from repo root before starting.

## Risks
- Pi's compaction code may not be easily findable or well-documented.
- Trace-v2 data may not directly address prompt compaction.
- Paper insights may be theoretical; need to bridge to practical prompt design.