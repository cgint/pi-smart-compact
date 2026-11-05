---
name: repo-maintenance
description: Self-sufficient routine for dependency upgrades, audit hygiene and verified push in this repository. For agents working on this repo; never deployed to extension users.
---

# Repository maintenance routine (self-sufficient)

This skill is the single source of truth for maintaining this repository.
It must remain fully self-sufficient: never depend on resources outside
this repository (no central skill, no external memory).

## Goal & hard rules
- All npm dependencies at latest published versions, MAJOR bumps included.
- npm audit green (exit 0), fixed at ROOT CAUSE (upgrade the vulnerable
  package itself). Never via: lowered audit level, --force, npm audit
  ignore/suppressions, overrides that mask advisories, or downgrade-to-dodge.
- NO restrictions may be loosened to get green. If a temporary measure is
  truly unavoidable, flag it explicitly in the evidence file and name the
  real fix.
- Never bend a test to pass. Failures are either pre-existing (prove it via
  a stash/HEAD baseline) or regressions (fix root cause or stop and report).

## Procedure
1. git fetch origin; ensure local branch is even with origin before starting.
2. Record BEFORE-state: package versions (npm ls --depth=0), npm audit
   output, full test verdict on the clean tree.
3. Bump deps to latest (majors included). Regenerate lockfile fresh
   (remove package-lock.json, npm install).
4. Typecheck/build + full test suite. Compare against BEFORE-state; any
   new failure is a regression. Investigate root cause before touching code.
5. npm audit must exit 0.
6. Commit (conventional message) and push ONLY when: tests no worse than
   baseline, audit exit 0, tree clean.

## Evidence contract
Commit agent/dep-refresh-YYYYMMDD.md containing: before/after table per
changed package, audit before/after, test verdict incl. pre-existing
failures with proof they pre-date the change, residual risks/overrides
kept and why.

## Acceptance protocol (verifier duties - NEVER trust a worker self-report)
- git fetch, then HEAD == origin on the working branch
- zero dirty tracked files
- re-run npm audit (expect exit 0)
- inspect the diff for loosened restrictions (audit config, skipped
  tests, downgraded pins)
- spot-check the evidence file exists and matches reality

## Repo-specific facts
- Verified 2026-11-05: `npm run precommit` (typecheck + 114 tests, 5 files)
  green on a clean tree; `npm audit --audit-level=moderate` exits 0 with
  0 vulnerabilities. Use `npm run precommit` as the test+audit gate; do not
  run `npm audit` bare — it uses error-level and is weaker than the
  repo's declared moderate floor.
- Baseline versions (devDependencies, all installed):
  @earendil-works/pi-ai 1.5.0, @earendil-works/pi-coding-agent 1.5.0,
  @earendil-works/pi-tui 1.5.0, @sinclair/typebox 0.34.52, @types/node
  26.6.6, typescript 7.0.2, vitest 5.1.0.
- Node v22.22.1 is the known-working runtime (no .nvmrc, no engines field
  in package.json — pin nothing, just verify with `node --version` before
  running).
- peerDependencies are FLOORS, not targets: `@earendil-works/pi-ai`,
  `pi-coding-agent` are `>=0.74.0`; `pi-tui` and `typebox` are `*`. Local
  installs are driven by devDependencies only. Upgrading must never lower a
  floor — `pi-tui: "*"` in particular means typebox/tui versions can move
  freely without a floor to check.
- No `overrides` key, no `.npmrc`, no `.nvmrc` in the repo — do not create
  any of these as a maintenance shortcut; if you find one during an
  upgrade, it is either a regression or a flagged temporary measure and
  must be documented in the evidence file.
- The `pi` manifest (`"pi": { "extensions": ["./index.ts"] }`) and the root
  `skills/` directory (if ever present) are the extension-user channel.
  Never add maintainer-facing skills, docs or config there; this skill
  lives in `.pi/skills/` precisely because it must stay out of that
  channel.
