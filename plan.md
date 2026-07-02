# Plan — Prompt-Only Compaction Research

## Status
Draft 2026-07-02. Aligned to NORTH-STAR: prompt-only compaction as first milestone.

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

## Pre-flight check
- Verify all relative paths resolve from repo root before starting.

## Risks
- Pi's compaction code may not be easily findable or well-documented.
- Trace-v2 data may not directly address prompt compaction.
- Paper insights may be theoretical; need to bridge to practical prompt design.