## Purpose

Provides anchored, history-grounded inspection and witness-authorized newest-suffix retirement without guessing counts.

## ADDED Requirements

### Requirement: Witness-Scoped, Bounded Inspection
`inspect_episode_retirement` SHALL accept optional `{ cursor?: string }`. A cursorless call SHALL mechanically evaluate every count from 1 through the completed-episode maximum, replace the single in-memory current inspection grant, and return a new random opaque `inspectionWitness`. The grant SHALL contain its exact snapshot digest, all accepted anchor-to-preflight-selection bindings, aggregate refusal facts, and issued opaque cursors.

Candidates SHALL be newest-first. A witness-scoped `ep-N` identifies the Nth newest completed episode: `ep-1` retires one episode and `ep-2` retires `ep-2` plus `ep-1`. Unsafe candidates SHALL be omitted, so IDs can skip. Each candidate contains its witness-scoped ID, ISO 8601 UTC timestamp, mechanically extracted 45-character user-prompt preview, `retiresEpisodes`, and `sourceMessageBytes`; `sourceMessageBytes` SHALL equal the UTF-8 byte length of non-pretty `JSON.stringify(selectedProviderMessages)`.

A cursorless response SHALL contain `inspectionWitness`, bounded newest-first `candidates`, `activeEpisode`, aggregate counts and `refusalReasons`, and nullable `nextCursor`. The extension SHALL dynamically pack complete candidate records by independently measuring complete serialized provider-content and details payloads; each SHALL be at most 2048 UTF-8 bytes. It SHALL neither cap history evaluation nor split records. Pagination SHALL make every accepted candidate reachable; at least one candidate fits under the stated bounded fields. Cursor calls SHALL page the stored grant only: they SHALL not create a witness or repeat model/auth/append work. A new cursorless inspect invalidates the prior grant.

#### Scenario: Direction and omitted unsafe IDs
- **WHEN** `ep-2` is the second newest completed episode and `ep-3` is unsafe
- **THEN** `fromEpisodeInclusive: "ep-2"` selects `ep-2` and `ep-1`, while `ep-3` is absent and IDs may skip without renumbering.

#### Scenario: Full-envelope pagination
- **WHEN** accepted candidates exceed either 2048-byte serialized envelope
- **THEN** the response contains only complete newest-first records that fit both envelopes and a non-null cursor; cursor pages traverse every accepted candidate without re-evaluation.

### Requirement: Current Inspection Witness and Fresh Execution
The snapshot digest SHALL canonically cover the resolved local retirement snapshot through and including the active user root: active-context producer IDs/fingerprints and paired provider-visible message JSON fingerprints. It SHALL exclude entries/messages after that root, including inspect traffic and other active-episode-only traffic.

`retire_episodes` SHALL require `fromEpisodeInclusive`, `inspectionWitness`, `continuationGoal`, and `pinnedWorkingState`; it SHALL accept neither a bare count nor an anchor without a current witness. Before secondary-model egress, it SHALL require current in-memory witness, digest equality, exact stored anchor binding, shared preflight-result equality, valid continuation goal, and valid pin. Reload, a cursorless inspect, a new user root, or prefix/branch change through the active root invalidates a grant; cursors are witness-bound. The grant SHALL be consumed only after successful receipt append. A pre-append failure permits retry while the same grant remains fresh.

#### Scenario: Active tool traffic does not stale a witness
- **WHEN** only entries after the active user root change through inspect or other active-episode traffic
- **THEN** a matching witness and digest remain valid.

#### Scenario: Stale, unknown, reused, or mismatched authority fails closed
- **WHEN** the witness is absent, unknown, consumed, stale, cursor-mismatched, or its bound anchor/preflight differs
- **THEN** execution performs no secondary-model egress and appends no receipt.

### Requirement: Caller-Pinned Working State
The retirement tool SHALL require caller-authored `pinnedWorkingState` on every retirement. It SHALL be a string of at most 2000 characters whose trimmed form is non-empty. Before every retirement, the active agent SHALL independently author the smallest critical working state in its own words: verified findings, binding constraints or user instructions, rejected approaches not to repeat, unresolved work, and immediate dependencies. It SHALL NOT provide a generic summary, raw transcript, source/world knowledge, or filler; it SHALL NOT delegate this judgment to the capsule model.

Before secondary-model egress, the extension SHALL validate `pinnedWorkingState`. For accepted input, it SHALL persist the original string unchanged, including formatting, separately from the five-key model-authored `ContinuationCapsule`. The extension SHALL structurally emit one dedicated pinned-working-state field/block in provider-facing continuation output. The secondary-model request SHALL include a clearly delimited, default-redacted egress copy as guidance plus `continuationGoal`; the model SHALL author complementary, non-duplicative five-key state and no pinned field.

#### Scenario: Pin validation and structural projection
- **WHEN** a caller supplies a valid pin
- **THEN** its original formatting is persisted unchanged and projected in one dedicated block; missing, invalid, empty-after-trim, or over-2000-character pins cause zero model egress and zero receipt append.

### Requirement: V5 Receipts and Legacy Projection
Every new receipt SHALL be strict V5 and include `mode: initial|forward|recompose|deepen`, required original `pinnedWorkingState`, and mode-specific exact keys preserving the applicable V2/V3/V4 provenance/composition fields. Existing V1–V4 validators SHALL remain unchanged. A V5 parent may be V1–V5; no synthetic parent pin is created. The latest valid receipt SHALL project only its own pin and five-key capsule. Earlier pins remain append-only raw provenance, never accumulate or nest in projection; the active caller carries forward critical information. Recall remains cumulative raw provenance.

#### Scenario: V5 and mixed-chain compatibility
- **WHEN** V5 initial, forward, recompose, or deepen receipts are created, including mixed V2/V4/V5 chains
- **THEN** mode-specific strict validation succeeds, legacy validators are unchanged, latest-only pin projection holds, and cumulative recall remains available.

#### Scenario: Failed work is retryable before append
- **WHEN** model or parsing work fails before receipt append with an otherwise fresh grant
- **THEN** no receipt is appended, no grant is consumed, and execution may retry with that witness.
