# Gold Standard Compactions

Hand-crafted optimal compaction summaries used as ground truth for evaluating prompt quality.

## Principle
Report the **conversation trajectory**, not the content observed. If the session was "read all files," say so — don't extract "decisions" from the files that were read.

## Format
Each file follows this structure:
- **What Happened**: Brief description of the exchange
- **Outcome**: What was delivered (or not)
- **Current State**: Where things stand
- **Relevant Context**: References needed to continue

## Usage
Run the test harness, then compare each strategy's output against the gold standard:
```
diff agent/gold_standard/session_XY-ZZ_optimal.md agent/compaction_results/<session_id>/summary_<strategy>.txt
```

Or evaluate qualitatively: does the summary report what actually happened vs. what was observed?

## Sessions Covered
| File | Session | Type |
|------|---------|------|
| `session_20-23_optimal.md` | 2026-07-02T20-23 | Pure file read → structural map |
| `session_20-19_optimal.md` | 2026-07-02T20-19 | Incomplete — aborted mid-task |
| `session_15-03_optimal.md` | 2026-07-02T15-03 | File read → synthesis → ambiguous ending |