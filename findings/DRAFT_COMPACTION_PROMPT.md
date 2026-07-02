# Draft Compaction Prompt

## Purpose
Transform an overloaded agentic session into a small but highly informative continuation context that preserves the bigger-picture objective, current phase, decisions, blockers, evidence, and next steps — while removing stale chatter, repeated explanations, and low-value narration.

## System Prompt

```
You are a session compaction specialist. Your task is to read a conversation between a user and an AI assistant, then produce a structured continuation context that enables another agent to pick up exactly where the work left off.

RULES:
1. Preserve the bigger-picture objective and the current work phase.
2. Preserve decisions with their rationale and evidence references.
3. Preserve unresolved blockers and uncertainty.
4. Preserve key file operations (read/write/edit) with exact paths.
5. Preserve the last ~20K tokens of conversation verbatim (do not summarize recent work).
6. Remove: stale planning chatter, repeated explanations, low-value tool narration, details that no longer influence the next decision, outdated hypotheses, redundant summaries.
7. Do NOT continue the conversation. Do NOT respond to questions. ONLY output the structured summary below.
```

## Output Format

```
## Session Context

### Big Picture
[What is the overarching goal? If the goal shifted during the session, note the evolution.]

### Work Stream Evolution
[How the session's active focus has migrated over time. E.g., "Goal initiated as X, transitioned to Y at step N due to error Z, currently active on W." Record the sequence of shifts, not just the current state. This preserves the full trajectory, not just a snapshot.]

### Constraints & Preferences
- [Any constraints, preferences, or requirements from the user]
- [Local project rules that override general defaults]
- [Or "(none)" if none]

### Progress
#### Completed
- [x] [Completed tasks/changes with exact file paths]

#### In Progress
- [ ] [Current work — what is actively being worked on?]

#### Blocked
- [ ] [Issues preventing progress, with evidence of what was tried]

### Key Decisions
- **[Decision]**: [What was decided] — Rationale: [why] — Evidence: [refs to messages/timestamps] — Outcome: [worked/failed/partial] — Confidence: [high/medium/low]
- [More decisions as needed]

### Next Steps
1. [Immediate next action]
2. [Subsequent action]
3. [Future consideration]

### Critical Context
- [Data, examples, or references needed to continue]
- [Environment specifics: Node version, OS, tool versions, path constraints]
- [Or "(none)" if not applicable]

### File Operations
<read-files>
- [file paths that were read]
</read-files>
<modified-files>
- [file paths that were written or edited]
</modified-files>

### Behavioral Patterns Observed
- [Patterns that helped: e.g., "look before leaping", "pivot on first failure", "trust but verify"]
- [Patterns that failed: e.g., "assumed environment was X", "ignored local rules"]

### Lessons Learned
- [Technical wisdom that would be lost without explicit capture]
- [Environment-specific knowledge]
- [Or "(none)" if no lessons emerged]
```

## Usage Instructions

### For the compaction system:
1. Serialize the conversation using the agent's standard message format.
2. Wrap in `<conversation>` tags.
3. Append the output format template.
4. Send to the LLM with the system prompt above.
5. Parse the structured output and store as the compaction summary.
6. Append file operations section (extracted separately from tool calls).
7. Store the last ~20K tokens of conversation as "kept context" (not summarized).

### Custom instructions (optional):
If the compaction system can detect recent activity patterns, append:
```
Additional focus: [recent activity] — e.g., "Recent activity shows debugging an error in X, then switching to implementing Y; prioritize both error traces and implementation details."
```
Note: This is not a session-type label (sessions are fluid). It describes what the agent has *actually been doing* in the recent past, which informs what to prioritize in the summary.

## Evaluation Against NORTH-STAR Criteria

| Criterion | Met? | How |
|---|---|---|
| Minimum characters with maximum information | ✅ | Structured sections force conciseness; only decision-relevant content preserved |
| Preservation of bigger-picture objective | ✅ | `## Big Picture` section captures overarching goal, including goal evolution |
| Preservation of current phase | ✅ | `### Current Phase` section explicitly identifies planning/implementation/debugging/review |
| Preservation of current-state detail | ✅ | Last ~20K tokens kept verbatim; recent work not summarized |
| Low noise / low irritation from stale history | ✅ | Explicit removal rules for stale chatter, repeated explanations, low-value narration |
| Clear orientation about what matters now | ✅ | `### Next Steps` section with ordered actions |
| Clear orientation about what was already decided | ✅ | `### Key Decisions` with rationale, evidence refs, outcomes |
| Preserves active north star and user intent | ✅ | `## Big Picture` and `### Constraints & Preferences` |
| Preserves decisions and constraints that bind future action | ✅ | `### Key Decisions` with rationale and evidence |
| Preserves unresolved blockers and uncertainty | ✅ | `#### Blocked` section with evidence |
| Preserves key evidence and provenance | ✅ | Evidence refs in decisions; file operations section; provenance markers |
| Preserves concise next-step orientation | ✅ | `### Next Steps` ordered list |
| Preserves enough surrounding big picture to prevent local optimization | ✅ | `## Big Picture` includes goal evolution; `### Behavioral Patterns` captures project-specific knowledge |
| Removes stale planning chatter | ✅ | Explicit removal rule |
| Removes repeated explanations | ✅ | Explicit removal rule |
| Removes low-value tool narration | ✅ | Explicit removal rule |
| Removes details that no longer influence next decision | ✅ | Explicit removal rule |
| Removes outdated hypotheses | ✅ | Explicit removal rule |
| Removes redundant summaries | ✅ | Explicit removal rule |

## Comparison to Pi's Built-in Compaction

| Aspect | Pi's Built-in | This Draft | Improvement |
|---|---|---|---|
| System prompt | Generic ("context summarization assistant") | Domain-specific ("session compaction specialist") | I1 |
| Structure | Fixed template (Goal/Constraints/Progress/Decisions/Next Steps/Critical Context) | Expanded template (adds Phase, Behavioral Patterns, Lessons Learned, evidence refs) | I2, I7 |
| Activity-aware prioritization | None | Custom instructions describe recent activity (not rigid session type) | I2, I4 |
| Evidence linking | None | Evidence refs in decisions (message/timestamp/outcome) | I3 |
| Incremental merge | Yes (UPDATE_SUMMARIZATION_PROMPT) | Yes (designed for merge) | P3 |
| File operations | XML tags appended | XML tags in dedicated section | P4 |
| Recent context | keepRecentTokens=20000 | Same (~20K tokens) | P5 |
| Removal rules | Implicit (LLM discretion) | Explicit (7 removal categories) | R1-R8 |
| Behavioral patterns | None | Dedicated section | P7 |
| Outcome linkage | None | Outcome field in decisions | P10 |
| Brevity bias resistance | Low (generic prompt) | High (explicit fidelity > brevity) | I8 |
| Over-compression prevention | None (aggressive truncation) | Explicit rules prevent over-removal | I9 |