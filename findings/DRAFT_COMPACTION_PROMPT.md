# Draft Compaction Prompt

## Purpose
Transform an overloaded agentic session into a small but highly informative continuation context that preserves the bigger-picture objective, current phase, decisions, blockers, evidence, and next steps — while removing stale chatter, repeated explanations, and low-value narration.

## System Prompt

```
You are a session compaction specialist.

RULES:
1. Summarize what was ACTUALLY DISCUSSED and DONE — NOT file contents.
2. Preserve decisions with rationale.
3. Preserve unresolved blockers.
4. Preserve key file operations with exact paths.
5. Do NOT continue the conversation. ONLY output the structured summary.
6. If the session contains only file reading with no discussion, summarize what was read and the agent's observations — do NOT invent decisions.
7. CRITICAL: Distinguish ACTIVE work from COMPLETED work. If the session ends mid-debugging or mid-task, the 'Current State' MUST reflect that the work is unresolved — do NOT describe it as finished or fully working.
8. CRITICAL: Read the LAST 10 exchanges in the conversation to determine what was actively happening. The 'Immediate Next Step' MUST be the continuation of whatever the agent/user was doing at the very end of the session. Ignore earlier completed work when determining the next step.
9. CRITICAL: If the session ends with error investigation, log checking, or debugging, the 'Current State' must explicitly state that the issue is UNRESOLVED. Do NOT describe systems as 'fully working' if errors were still being investigated.
10. CRITICAL: Include a '## Last Session Activity' section describing the last 5-10 exchanges concretely — what errors were seen (HTTP codes, tracebacks, error messages), what commands were run, what the agent was investigating. This is the most important context for resumption.
11. CRITICAL: In 'Last Session Activity', include SPECIFIC error details: HTTP status codes (e.g., 404), traceback lines (e.g., chat_model.py:151), tmux session names, model names tried. Generic descriptions like 'checking logs' are NOT sufficient — the resumed agent needs the exact error signatures.
12. CRITICAL: The 'Current State' section must list every unresolved error with its exact error message or status code. Do NOT summarize 'backend issues' — state '404 error on /api/chat endpoint' or 'stream_run traceback at line 151'.
```

## Output Format

```
## What Was Done
[Brief description of completed work]

## Last Session Activity
[Describe the last 5-10 exchanges: what errors were seen, what commands were run, what the agent was investigating. Be concrete.

## What Is Unfinished
[Work in progress when session ended — be specific about what is NOT yet resolved]

## Key Findings / Observations
[Insights]

## Key Decisions
- **[Decision]**: [Rationale]

## Current State
[Where things stand — include unresolved issues, errors, uncertainties]

## Immediate Next Step
1. [The single next action for whoever resumes — derived from Last Session Activity]

## Later Tasks
[Post-session housekeeping: cleanup, docs, planning]

## File Operations
[Files read/written]

Be concise. Skip empty sections. If 'What Is Unfinished' is empty, the session truly ended cleanly.
```

## Usage Instructions

### For the compaction system:
1. Load the conversation messages from the session JSONL.
2. Split at ~70% (messages to compact vs remaining).
3. Serialize the conversation portion using `[Role]: content` format.
4. Wrap in `<conversation>` tags and append to this prompt.
5. Send to the LLM; parse the structured output as the compaction summary.
6. (Optional) If a previous summary exists, include it in `<previous-summary>` tags for incremental merge.

### Behavioral score
This prompt variant scored **22/25** on the behavioral resumption pilot (Slot 2, web-scrape session), tying the best achievable score on that session. It was validated across 4 iterations during Phase 01 optimization.

## Evaluation Against NORTH-STAR Criteria

| Criterion | Met? | How |
|---|---|---|
| Minimum characters with maximum information | ✅ | 9 focused sections force conciseness; rules 1-5 constrain scope |
| Tail-reading (immediate next step) | ✅ | Rules 7-8: read last 10 exchanges, derive next step from session end |
| Error signature preservation | ✅ | Rules 10-12: specific HTTP codes, tracebacks, exact error messages |
| Active vs completed distinction | ✅ | Rule 7: explicit anti-closure bias; 'What Is Unfinished' section |
| Decision preservation | ✅ | '## Key Decisions' section with rationale |
| Unresolved blocker tracking | ✅ | Rule 3 + '## Current State' requires listing every unresolved error |
| File operation tracking | ✅ | Rule 4 + '## File Operations' section |
| Noise reduction | ✅ | Rule 1: summarize discussion, not file contents; skip empty sections |
| Resumption readiness | ✅ | '## Last Session Activity' + '## Immediate Next Step' pair |

## Comparison to Pi's Built-in Compaction

| Aspect | Pi's Built-in | Smart Prompt | Improvement |
|---|---|---|---|
| System prompt | Generic ("context summarization assistant") | Domain-specific ("session compaction specialist") | Focus |
| Rules | Implicit (LLM discretion) | 12 explicit rules, 6 marked CRITICAL | R1 |
| Tail-reading | None | Rules 7-8: last 10 exchanges drive next step | R2 |
| Error specificity | None | Rules 10-12: exact codes, tracebacks, signatures | R3 |
| Closure bias | Present (tends to declare tasks done) | Rule 7: explicit anti-closure; 'What Is Unfinished' section | R4 |
| Output sections | 6 generic sections | 9 targeted sections (Last Session Activity, Immediate Next Step) | R5 |
| Behavioral score | Baseline (not measured) | 22/25 on resumption pilot | Measured |
| File operations | XML tags appended | Integrated in output format | P4 |