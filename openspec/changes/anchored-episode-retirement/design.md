## Context
The engine already selects a contiguous newest completed suffix before the active user root. This design names that existing boundary without changing its semantics.

## Decisions

### 1. Selection
`fromEpisodeInclusive` is the oldest included completed episode. It retires that episode and every newer completed episode through the newest completed episode; active work is excluded. Inspect order is newest-first; witness-local `ep-N` is Nth newest completed episode. Unsafe candidates are omitted without renumbering, so IDs may skip.

### 2. Inspection Grant, Pagination, and Bound
A cursorless inspect evaluates all counts, creates/replaces exactly one process-local grant, and returns its random opaque witness plus first page. The grant stores digest, accepted anchor-to-shared-preflight bindings, aggregate refusal facts, and opaque cursors. Cursor calls only page this immutable grant. Greedy dynamic packing measures complete serialized provider-content and details envelopes independently; both remain <=2048 UTF-8 bytes. No candidate history cap or partial record is permitted.

### 3. Freshness and Consumption
The digest canonically covers resolved local state through active user root: producer IDs/fingerprints and paired provider-visible message JSON fingerprints. Later active-episode traffic is excluded. Reload, new cursorless inspect, new user root, or prefix/branch change through root invalidates. Execution requires witness/digest/binding/shared-preflight equality and valid goal/pin before egress. Consume only after append; pre-append failures are retryable. One grant means no TTL/LRU is needed.

### 4. Metric
`sourceMessageBytes` is `Buffer.byteLength(JSON.stringify(selectedProviderMessages))`; it is source size, not freed bytes.

### 5. Pin and V5
Keep the settled 2000-character unchanged pin behavior. V5 is a strict new receipt version with `mode: initial|forward|recompose|deepen`, original pin, and mode-specific exact keys preserving legacy V2/V3/V4 provenance/composition. Legacy validators are unchanged. V5 parents may be V1–V5; latest projection includes only its own pin/capsule; recall stays cumulative raw provenance.

## Risks / Implementation Questions
No design blocker remains. Implementation must choose concrete token encoding and TypeScript representations without changing these invariants.
