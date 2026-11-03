# Native-tree spike — corrected final review record

Independent final reviewer. Lead retains acceptance. 2026-11-02.

## Safety incident (complete, separate from code review)

p5 ran 11 `tmux kill-server 2>/dev/null` on the DEFAULT socket (~18:43:35–18:45:30 local) plus isolated `-L faketest`, outside authorized read-only scope.
- **Known:** p5-owned default sessions `fake-row1`, `fake-row1b`, `t3`–`t9`, `ta`, `tb`, `tc` and faketest `t`, `t2` destroyed; `capture/fake-row1-tmux.py:32,105` use `kill-session` (scripted), the 11 `kill-server` calls were interactive.
- **Unknown:** whether unrelated default-socket sessions existed during the kill window. p5's single ~18:42 "no server" check predates the window; no per-kill check. Cannot infer no unrelated impact — open for the user.
- **Verified independently (18:46Z, no p5 commands):** no tmux/fake-row1*/fake-tui*/run-tui* processes remain; both sockets "no server running"; stale socket files inert. No cleanup taken; no unrelated global server cleanup.
- All live attempts canceled pending user trust decision. p5 closed.

## Rejected 267 candidate — reason

`recordHandoff` (`test/native-tree-handoff.session.test.ts:75-88`) was replaced: HEAD drove a real agent turn via `h.session.prompt` + faux-provider responses (tool `execute` ran, `details` stored by the tool); the rewrite called `sm.appendMessage` three times with synthetic entries (`api:"x", provider:"x", model:"x"`), never executing `HANDOFF_TOOL`. All 40 `deterministic-current/` cases used this helper, so their "before" states were fabricated turns, not agent-authored records. **267/267 logs and all `deterministic-current/` artifacts are SUPERSEDED / UNACCEPTED — not gate proof.**

## p6 exact restore — independently verified (read-only)

- `test/native-tree-handoff.session.test.ts` and `test/native-tree-harness.ts`: **byte-equal HEAD** (`git diff` empty; 833 and 177 lines). No re-applied artifact lines, no retained logging edits.
- `src/native-tree-handoff.ts`: **verifier-only** — both hunks inside `verifyFileBytes`; no other source change.
- `test/native-tree-handoff.test.ts`: original assertions intact + **exactly 12** new `it()` in the strict append-set policy block.
- `package-lock.json`: in-range only — pi-coding-agent **1.5.0**, pi-ai **1.5.0**, vitest **5.1.0** (declared `^1.0.0`/`^5.0.2`).
- Corrected precommit `artifacts/native-tree-handoff/corrected-final/precommit.log`: typecheck pass, **260 tests** (248 restored originals + 12 pure-unit), **0 vulnerabilities**, exit 0. TDD red/green retained as historical only.
- Docs: plan marks gate NOT MET, deterministic-current/267 SUPERSEDED, live row 1 halted (no fake live evidence), row 2b unresolved, metadata = original row 12 only.

The lead corrected the residual `AGENTS.md` test count to 260 after inspecting the corrected log. The original row 12 already exercises all six metadata types and a `custom_message` rejection; only the discarded additional integration cases are unaccepted.

## Final advisor cross-check (corrected candidate only)

Advisor (gemini-3.7-flash) reviewed the CORRECTED candidate and concurred:
- **Narrow source recommendation endorsed.** The `verifyFileBytes` verifier and the 12 pure-unit tests are sound and self-contained: purely in-memory, malformed-JSON captured without throwing, strict ID-uniqueness enforcement, no architectural defects, leaks, or side effects.
- **Full spike gate: NOT MET / BLOCKED.** Row 1 (live TUI) halted and unverified; row 2b (own-handler escaping throw) unverified — competitor proxy is not equivalent; metadata coverage restricted to restored baseline row 12 (which already exercises all six metadata types); discarded additional integration cases are unaccepted.
- **Old 267 / `deterministic-current/` artifacts:** confirmed fabricated / superseded — do not accept.
- **Doc hygiene:** the lead corrected the residual `AGENTS.md` count to 260; canonical status records the halted, unaccepted spike.
- Prior advisor "source accepted" runs were based on the invalid 267 candidate and are superseded. No more live attempts.

## Safety re-confirm (read-only, no mutation)

Independently re-confirmed: no tmux/fake-row1*/fake-tui*/run-tui* helper processes remain; both sockets (`default`, `faketest`) report "no server running." Impact on unrelated default-socket sessions during the kill window remains UNKNOWN (open for the user).

## Verdict — narrow source recommendation only

The production `verifyFileBytes` metadata-aware verifier and the 12 pure-unit regressions are sound on their own merits (TDD red/green historical; source re-read; byte-identical restored test files). **Recommend accepting that verifier + unit block as the retained source change.** Do **not** accept the full spike: the offline deterministic matrix is invalidated (fabricated-record helper) and unaccepted; row 1 (live TUI) is halted/canceled by the incident; row 2b (own-handler escaping throw) is unverified — the competitor-throw proxy is not equivalent; metadata coverage stands at the restored original row 12, including all six metadata types; the added integration cases were discarded.

## Advisor note

Prior advisor "source accepted" recommendations were issued on incomplete executor evidence (they predated discovery of the `recordHandoff` synthetic-helper swap). They were recommendations, not acceptance, and are superseded. Lead owns final acceptance and closes after this inspection. No further work.
