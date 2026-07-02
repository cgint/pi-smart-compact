# Handoff context brief

## Status

Initial pattern extracted from subagent coordinator experiments. This is a compaction pattern for transferring work between agents without dumping full history.

## Intent

A handoff brief is a compact, authority-aware context package from one agent/session to another.

Good handoff is not “send less context.” It is transferring the minimum sufficient combination of:

- outcome;
- authority;
- scope;
- known evidence;
- uncertainty;
- stop rules;
- verification contract;
- reporting contract.

## Why this matters for compaction

Subagent handoff is context compaction under pressure. If the brief omits decision rights, constraints, evidence, or acceptance criteria, the receiver pays a **Verification Tax** by rediscovering context and revalidating intent.

If the brief includes too much, the receiver gets context rot, duplicated analysis, and higher token cost.

## Compact handoff shape

```markdown
# HANDOFF BRIEF

Outcome: <one sentence>
Done state: <observable acceptance criteria>
Why this matters: <failure mode or user intent>

Decision rights:
- You may: <bounded decisions>
- Ask before: <escalation boundary>
- Never: <hard constraints>

Scope:
- Allowed paths/actions: <short list>
- Forbidden paths/actions: <short list>

Known evidence:
- <fact> — <path/log/test pointer>
- Do not rediscover: <facts already established>

Uncertainty:
- Assumptions: <short list>
- Confidence/capability fit: high | medium | low + reason

Stop rules:
- Stop if: <conditions>

Verification contract:
- Commands/checks: <exact or acceptable substitutes>
- Expected result: <observable>

Comprehension check:
- Restate target, scope, stop rules, and first verification step before execution.

Required report:
- Status; changed files; verification evidence; deviations; residual risks; next step.
```

## Routing rule

Coordinator/subagent workflows are not automatically cheaper. Use them when ambiguity, distributed context, high blast radius, or validation risk justify the overhead.

Default routing implication:

- Localized one-function or fast-validation task → baseline single agent often wins.
- Ambiguous, cross-file, high-risk, or reusable-planner-evidence task → handoff may pay off.

## Source-derived findings

- Improved handoff protocol produced cleaner delegation behavior: scoped worker execution, confidence/capability check, comprehension check, and clearer report artifacts.
- The same run still cost more end-to-end than a capable baseline on a localized regression.
- Worker containment and auditability can improve before total token/cost savings appear.
- Handoff should include “known evidence / do-not-rediscover” but keep it short and authoritative.

## Compaction use

Use this pattern when a compaction must support another agent, future session, or reviewer.

Do not include full source history. Include only the handoff fields plus pointers to evidence artifacts.

## Source evidence

- `../../pi-subagent-coordinator/agent/delegation-handoff-research.md` — sections `Executive takeaway`, `Information-flow criteria for good delegation`, and `Recommended handoff skeleton for next coordinator experiment`; source for authority/responsibility/context/verification transfer and handoff skeleton.
- `../../pi-subagent-coordinator/agent/coordinator-strategy-experiment-003-results.md` — sections `Fair solver comparison`, `Handoff protocol result`, and `Evidence-backed findings`; source for measured token/cost overhead and improved delegation quality.
- `../../pi-subagent-coordinator/agent/coverage.md` — section `Evidence Log`; source for run artifacts, validation logs, and coverage status.
