# Native-Tree Handoff Spike — Final Independent Evidence Review

**Verdict:** Row 1 ACCEPTED. Row 18 rootfix PROVEN (direct supplemental red + green, 3 modes, assertions not weakened). **Row 15 EXACT ACCEPTED (pF independent review)** — the exact streaming-command guard race is now OBSERVED (manifest-final.json / hjqcw7r harness: own native guard throw, byte-identical persisted raw, non-noop ordinary recovery, same-id reapply). **SPIKE GATE NOT MET** — blocked on row 2b (own escaping throw) ONLY. Observed matrix-case evidence verified; the full matrix is not claimed all-verified / all-gates-pass.

**Subsequent use decision:** the user approved an as-is personal-use branch trial and commit after discussing the residual hazard. The evidence verdict above is unchanged. Returning to `main` restores code, not already-written session state.

## Provenance

| Hash | Role |
|---|---|
| `2ef670bce…` | Accepted live-run source, before the navigation-error fix |
| `0c3617e6…` | Intermediate: navError re-read added, messages still "Tree handoff failed:" |
| `8123a434…` | **Final**: two uncertain-branch messages changed to "Tree handoff uncertain:" |

Delta `0c` → `8123`: **exactly 2 lines** (764, 767) — `"Tree handoff failed:"` → `"Tree handoff uncertain:"`. Line 769 (thrown, byte-identical) correctly retains `"Tree handoff failed:"`. Row 1 success path (line 798+) is control-flow identical to `2ef`. No provider re-run needed.

## Accepted Evidence

- **Row 1 (live, agent-authored):** byte-prefix, model-authored text, real `handoff_record` tool execution, Pi wrapper, 3 distinct footers, SDK reload + branch proof. All from raw `.jsonl`.
- **Row 18 rootfix (3 TDD modes):**
  - **Mode A** (EACCES, readable, byte-identical): `"Tree handoff failed: …Persisted file unchanged (byte-identical to preflight). In-memory leaf: …"` → `status:"thrown"`. Correct: definitive failure, persisted state verified unchanged (not a rollback claim).
  - **Mode B** (EACCES, re-read throws): `"Tree handoff uncertain: …Persisted state unverified: injected verification-read failure. In-memory leaf: …"` → `status:"uncertain"`.
  - **Mode C** (EACCES, re-read returns changed buffer): `"Tree handoff uncertain: …Persisted state unverified: file bytes differ from preflight snapshot. In-memory leaf: …"` → `status:"uncertain"`.
  - All 3: real `chmod 444` EACCES, `callCount toBe(2)` (reader called), disk separately proven unchanged, permissions restored, NON-NOOP recovery nav proves pending cleared, same command re-applies proves inFlight released.
- **Prior deterministic evidence (`final-uncertain-verification/`):** 116 phases / 34 full test names / all notices retained; 264 tests and 36 session tests passed. This remains prior-case evidence, not complete gate proof.
- **Current checks (`streaming-command-final/`):** `precommit-final.log`: 265 tests, zero vulnerabilities; `full-session-suite-final.log`: 37 session tests. Row-15 raw evidence is indexed by `manifest-final.json` (harness `hjqcw7r`).

## Artifact base paths (resolved once)

All artifact paths below are relative to `artifacts/native-tree-handoff/matrix-herdr-current/` (ignored by `.gitignore`).

| Artifact | Path |
|---|---|
| Full verification run | `final-uncertain-verification/{suite.log,precommit.log,exits.json,MANIFEST.json,rawcase dirs}` |
| Direct supplemental red (on `0c3617e6…`) | `final-uncertain-red/{red.log,red-exit.json}` |
| Direct supplemental green (on `8123a434…`) | `final-uncertain-green/{green.log,green-exit.json}` |
| Live row 1 (separate base) | `artifacts/native-tree-handoff/herdr-live-current/agent-authored-attempt/` |

## Direct Supplemental Red/Green (the TDD parity proof)

| Run | Result |
|---|---|
| **RED** (on `0c`, before prefix fix) | B: FAILS `/uncertain/i` (received `"Tree handoff failed: …"`). C: FAILS `/uncertain/i`. A: PASSES. Exit 1. `callCount toBe(2)` passes in both — reader was called, message lacked "uncertain". |
| **GREEN** (on `8123`, after prefix fix) | All 3 pass. Exit 0. |
| **Full verification** | Suite 36/36. Precommit 264/0. Manifest 116/34/0. |

**Assertions not weakened between red and green.** The identical assertions (`callCount toBe(2)`, `/uncertain/i`, `/Persisted state unverified/`, `/Persisted file unchanged/`) ran against both code versions. Red failed on the message prefix; green passes on the corrected prefix. No assertion was removed or relaxed.

## Helper & Assertion Parity

`buildHistory` and `recordHandoff` are **unchanged** (text-identical to the baseline). `runCommand` and `createHarness` are **intentionally instrumented** with additive artifact logging (`artifactLog.before/after` tokens); the original `h.session.prompt` call and lifecycle calls (`h1.session.dispose`, `h2.dispose`) are retained. No synthetic replacement of the normal fixture — the original negative/metadata fixtures legitimately use SDK `append` to construct test state. All 32 original session test cases and all their assertions are preserved. No private fields, no observer mutation.

## Remaining blocker and closed gap

1. **Row 2b — own escaping throw: UNVERIFIED.** No ordinary supported-API path **demonstrated** that forces our handler to throw an exception that escapes its own `try/catch` without a source mutation or dedicated fault-injection seam (both prohibited by the test architecture). Not claimed impossible or runner-immune. The competitor-throw proxy exercises the runner's swallow of a *competitor's* escaping throw — not ours. The remaining decision is a fault-model / test-architecture requirement.
2. **Row 15 exact composite: OBSERVED & ACCEPTED (pF independent review).** Canonical: "Throws; pending cleared in `finally`; report states outcome." All three now demonstrated in `hjqcw7r`: (a) the command's own `navigateTree` hits the real SDK guard throw while `Session.isStreaming=true` (PREPARING RUN, `Core.isStreaming=false` — not a provider-token claim); (b) pending cleared in `finally` — proven by the NON-NOOP ordinary recovery navigation `9804a85d -> 415f7c75` (noSummary / no `fromExtension`); (c) the same-id reapply (`f8254dfd`, `fromHook=true`, `parentId=386c8d29`, `fromExtension=true`) proves the in-flight lock was released. The earlier "new seams necessary for both 2b/15" claim was UNSUPPORTED — the ordinary race sufficed (no new seam).

**Lead owns full acceptance.** No further redesign or scope expansion.
