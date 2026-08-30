## 1. Test Setup & TDD Preparation
- [x] 1.1 Add failing TDD tests for newest-first anchored inspect: literal preview/timestamp, active exclusion, omitted unsafe IDs, direction (`ep-2` selects ep-2 + ep-1), canonical `sourceMessageBytes`, aggregate refusals, and full-envelope <=2048-byte boundaries. RED: current inspect lacks candidates/witness/cursors and retire retains count schema.
- [x] 1.2 Add failing TDD pin/V5 tests: required/min/max/whitespace, unchanged persistence/projection, default-redacted egress, zero egress/append failures, all four V5 modes, V1–V4 unchanged validators, mixed V2/V4/V5 chains, latest-only pin, and cumulative recall. RED: anchored schema/authority, pin persistence/projection, and V5 writes are not implemented.
- [x] 1.3 Record testable suffix direction, complete-envelope pagination, and session-bound witness/freshness contract.

## 2. Anchored Inspection Implementation
- [x] 2.1 Implement mechanical preview/timestamp helpers and all-count evaluation.
- [x] 2.2 Implement one in-memory grant with opaque witness/cursors, accepted bindings, aggregate refusal facts, and complete-record dual-envelope packing.
- [x] 2.3 Implement active-root canonical digest and invalidation rules; cursor calls page only and no history cap applies.

## 3. Retirement and V5 Implementation
- [x] 3.1 Replace count schema with `fromEpisodeInclusive`, `inspectionWitness`, `continuationGoal`, and `pinnedWorkingState`; require inspect first and validate all authority before model egress. Evidence: focused retirement suites (175/175), TypeScript.
- [x] 3.2 Add `/retire` and tool wording: inspect and page as needed, independently author pin, then choose anchor. Evidence: prompt and retirement focused suites (183/183).
- [x] 3.3 Implement shared-preflight anchor execution, retryable pre-append failures, and consume-on-append semantics. Evidence: focused retirement suites (175/175), TypeScript.
- [x] 3.4 Implement settled pin persistence/projection and redacted five-key model guidance. Evidence: focused retirement suites (175/175), TypeScript.
- [x] 3.5 Implement strict V5 modes and legacy-compatible reading/projection/recall. Evidence: focused retirement suites (175/175), TypeScript.

## 4. Verification & Documentation
- [x] 4.1 Run focused and full tests/precommit after implementation. Evidence: focused suites (183/183), full suite (193/193), `npm run precommit` (TypeScript, tests, audit: 0 vulnerabilities), strict OpenSpec, and diff check.
- [x] 4.2 Verify stale/unknown/reused witness, cursor mismatch, reload/new inspect/new user/prefix invalidation, active-tool-traffic validity, and zero-append/egress failures. Evidence: focused suites (183/183), including fresh-extension reload witness refusal before find/auth/stream/append.
- [x] 4.3 Update anchored API, V5/pin, pagination/metric, default/configuration, and RFC status documentation. Evidence: README, findings, plan, RFC, and current diagram reviewed.
- [ ] 4.4 [User Verification] Verify in live Pi: exact pin projection, inspect/page/anchor flow, and V1–V4 compatibility.
