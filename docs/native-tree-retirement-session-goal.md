# Session goal: native tree retirement spike

## Description

Bring the existing bounded native-tree handoff spike to an evidence-backed acceptance decision. The contract and runtime matrix remain in [native-tree-retirement-plan.md](native-tree-retirement-plan.md); this session does not authorize full `/retire` migration.

Success means the spike's pass gate is satisfied with inspectable evidence and independent review. If that cannot be achieved, document the specific unresolved blocker and evidence rather than weaken the gate.

## Plan

1. Delegate a read-only implementation and evidence review. Establish what exists in this checkout, the installed runtime, and which reported results can be reproduced. Distinguish absent historical artifacts from failed behavior.
2. After orientation, consult the advisor on the implementation approach. Close concrete acceptance gaps in small verified slices through supervised workers, with regression tests and real-runner checks. Preserve the existing `/retire` behavior and original branches.
3. Exercise the matrix on the relevant runtime, including the escaping-handler throw and metadata classification. Capture the required live handoff, provider payload, reload, branch-preservation, and footer evidence. Keep private logs and transient artifacts out of tracked delivery. Never expose credentials or introduce external calls into ordinary automated tests.
4. Resolve dependency-audit failures within the spike's dependency scope without hiding findings or blindly upgrading. Run precommit, independently review results, and update the canonical design/status document with criterion-to-evidence links and remaining limitations.

The lead retains strategy and acceptance; workers perform bounded investigations, implementation, and verification. Consult the user only for material requirement/scope decisions, necessary access or spending authorization, or severe blockers that cannot be resolved safely. Do not commit unless requested.

## Status

**Personal-use trial approved; full evidence gate NOT MET (row 2b only).** Production source is frozen at `8123a434…`. The user authorized a branch commit, not a `/retire` migration.

- **Live row 1 accepted:** agent-authored handoff, native summary, provider wrapper, confirmation, footers, reload and original-branch preservation verified through Herdr.
- **Row 18 accepted:** real EACCES and three persisted-state verification modes; direct red/green evidence preserves the uncertainty assertions.
- **Row 15 now accepted:** the command's own navigation hit the real SDK busy guard during `before_agent_start`. Actual `Session.isStreaming=true`, core token streaming false. Unchanged disk, non-noop ordinary recovery and same-record reapplication prove outcome reporting, pending cleanup and single-flight release. No production change or new seam was needed; my earlier claim that both remaining cases required new seams was unsupported.
- **Current checks:** 265 tests, zero audit vulnerabilities; 37 session tests. Saved logs: `artifacts/native-tree-handoff/matrix-herdr-current/streaming-command-final/{precommit-final.log,full-session-suite-final.log}`. Its `manifest-final.json` resolves the coherent row-15 evidence. Prior `final-uncertain-verification/` captures remain valid prior-case evidence, not a new 265-test artifact count.

**User decision — proceed as-is for personal use.** After discussing the practical risk, the user approved a branch commit and personal installation. Row 2b's own-handler escaping exception remains unobserved, not passed. Pi may fall back to its own summary if such an exception escapes; post-navigation verification is not a rollback guarantee. This residual risk is accepted for the trial, not erased from the formal gate. No new fault seam, source variant or weakened catch is authorized.

**Trial and rollback:** enable `PI_NATIVE_TREE_HANDOFF_ENABLED=true` to expose the two handoff tools and `/tree-handoff <handoffId>`; ordinary `/retire` remains unchanged. Reinstalling from `main` rolls back code, not session writes already made. Preserve the affected session file if something goes wrong; original tree branches remain available.

**Historical:** the unauthorized `tmux kill-server` incident remains recorded; unrelated-session impact is UNKNOWN. The 267-test candidate and `deterministic-current/` are rejected/superseded evidence.

Criterion-to-evidence details: [native-tree-retirement-plan.md](native-tree-retirement-plan.md). Independent review: [../agent/native-tree-herdr-review.md](../agent/native-tree-herdr-review.md).

## Boundaries

- Bounded opt-in spike only; no full migration, production-readiness claim, or cache-benefit claim.
- Preserve the pass gate; do not redefine success to accommodate failures.
- Keep detailed acceptance evidence and final status in `docs/native-tree-retirement-plan.md`; this file owns session scope and approach, not a duplicate evidence log.

## Current-state addendum (2026-07-06) — native-tree is now sole/default

The above records the spike's acceptance phase and remain valid history. A later user decision moved native-tree handoff from an opt-in spike to the **sole and default** context-retirement creation path:

- `index.ts` registers `registerNativeTreeHandoff` unconditionally; `PI_NATIVE_TREE_HANDOFF_ENABLED` is no longer read.
- The episode-retirement **creation** tools (`inspect_episode_retirement`, `retire_episodes`) are no longer registered; `PI_EPISODE_RETIREMENT_ENABLED` no longer gates anything.
- Historical episode-retirement receipts remain projectable and recallable via the read-only `recall_episode` tool and `context` projection handler (no appends, no model/network egress) — **only while the receipt chain is valid and reachable on the current branch**; a branch switch that drops the receipts makes their projection/recall unavailable there.
- `/retire` is always available and now guides the active agent to `native_tree_targets` → `handoff_record` → tell the user the exact `/tree-handoff <handoffId>` to run and explicitly confirm; the agent must not claim it was applied.

The formal row-2b gate status above is unchanged; this addendum records a product-path decision, not a gate pass. The historical acceptance evidence above was gathered for the opt-in spike and was **not verified against this migration**; row 2b remains unobserved (the own-handler escaping-throw hazard still stands). Removed creation-path tests are not retained in-tree; git history holds the originals, and the still-live read path is covered by active offline regressions (including authentic V5 initial→forward/recompose/deepen chains).
