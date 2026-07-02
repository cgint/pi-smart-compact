# Gold Standards

Optimal compaction outputs for each test session. Used as reference points for evaluating compaction quality.

## Structure

Every gold standard has four sections:

| Section | Purpose |
|---|---|
| **What Happened** | Trajectory — what the user asked and what the agent did |
| **Outcome** | Final result — delivered, incomplete, or failed |
| **Current State** | Where things stand now |
| **Relevant Context** | Concrete pointers the next agent needs |
| **Uncertainty** | *(when applicable)* Explicitly marked unknowns or inferences |

Sections are kept minimal. No metadata bloat (session IDs, message counts, file op stats) — those don't help the next agent act.

## Principle

Report the **conversation trajectory**, not the content observed. If the session was "read all files," say so — don't extract "decisions" from the files that were read.

## Sessions Covered

| Slot | Type | Description |
|------|------|-------------|
| 1 | Heavy steering | 139 messages, constant redirections, decision accuracy test |
| 2 | Debugging spiral | Parse errors → fixes → new bugs, trajectory fidelity test |
| 3 | Structural negotiation | Tri-state design, reset removal, decision accuracy test |
| 4 | Infra debates + critical requirements | OpenSpec, Cloud Run removal, continuity sufficiency test |

## Usage

Compare compaction outputs against the gold standard using the rubric in `testing/compaction_evaluation_rubric.md`.