# Plan — Prompt-Only Compaction Research

## Status
Draft 2026-07-02. Aligned to NORTH-STAR: prompt-only compaction as first milestone.

## Objective
Design a compaction prompt that outperforms Pi's built-in compaction by leveraging knowledge from existing code, traces, and papers.

## Research slices

### 1. Understand Pi's built-in compaction (baseline)
- Find and read Pi's compaction implementation (prompt templates, strategies, limitations).
- Identify where it succeeds and where it fails (stale content retention, context window waste, loss of decision state).
- **Output:** documented baseline of what Pi does now and known failure modes.

### 2. Extract compaction-relevant patterns from trace-v2 data
- Read trace-v2 sessions for evidence of: what gets lost, what's preserved, where compaction helps or harms.
- Look for patterns in representation_metrics.md: span counts, episode boundaries, decision coverage.
- **Output:** list of actionable insights that inform what a compaction prompt should preserve/remove.

### 3. Study implementation code for compaction strategies
- Search referenced repos for: minimal context packs, session builders, context window management, summarization prompts.
- Extract prompt patterns, strategies, and design decisions that directly apply to compaction.
- **Output:** catalog of compaction strategies with source references.

### 4. Review relevant papers
- Consult papers referenced in sources/research-map.md for context window management, summarization, and agent memory theories.
- **Output:** theoretical grounding for the compaction approach.

### 5. Synthesize: draft the compaction prompt
- Combine insights from slices 1-4 into a single compaction prompt.
- Test: run against a real Pi session (if possible) or evaluate against criteria from NORTH-STAR.
- **Output:** draft compaction prompt + evaluation notes.

## Pre-flight check
- Verify all relative paths resolve from repo root before starting.

## Risks
- Pi's compaction code may not be easily findable or well-documented.
- Trace-v2 data may not directly address prompt compaction.
- Paper insights may be theoretical; need to bridge to practical prompt design.