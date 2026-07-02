# Budget and storage aware compaction

## Status

Initial note from token/budget and session-storage sources. This is a supporting concept, not a full measurement design.

## Thesis

Smart compaction should account for both **context quality** and **context cost**.

A compact context is better only if it preserves task sufficiency while reducing avoidable token, latency, cost, or cognitive overhead.

## Budget signals

Possible budget signals for a Pi harness:

- input/output token counts when provider metadata is available;
- approximate token counts from text length when metadata is unavailable;
- per-turn or per-session cost estimates;
- latency caused by extra verifier/reflector/probe calls;
- failed tool calls and duplicate rediscovery as indirect waste;
- environment/energy estimates as rough order-of-magnitude communication.

## Storage/retrieval signals

Pi-based systems may persist session artifacts in files that compaction can point to later:

- Pi session JSONL files;
- per-task session files in controller UIs;
- trace artifacts;
- judge inputs/outputs;
- run records;
- dashboards or reports;
- knowledge-base notes like this directory.

A compaction strategy should prefer stable file pointers over active-context payloads when detail is not immediately needed.

## Design implications

1. **Budget controls should throttle expensive side channels.**
   Reflection, verifier suites, and multi-model probes should be risk-triggered or cadence-limited, not run indiscriminately on every turn.

2. **Token savings must be checked against task sufficiency.**
   A shorter context that causes rediscovery, failed tools, or wrong next actions is not actually cheaper.

3. **Provider metadata is preferable; approximations must be labeled.**
   If exact token usage is unavailable, approximate and disclose assumptions.

4. **Session files are retrieval infrastructure.**
   Per-task/session JSONL files and persisted artifacts allow compaction outputs to externalize detail safely.

5. **Cost can justify suppression.**
   If a verifier or consortium probe adds no materially new information, suppressing it protects both token budget and human attention.

## Source evidence

- `../../pi-extension-environment/pi-extension-diesel-km-brief.md` — sections `What the Pi extension should do`, `Token-to-energy estimation options`, `Recommended MVP approach`, and `Caveats for presentation/use`; source for token usage collection, approximation caveats, and session-scope questions.
- `../../pi-coding-agent-container-ui-git/docs/research.md` — section `Existing LiveView wrapper (agent-coding-gui)`; source for per-task Pi session files and resume path via `--session <file>` / `--continue`.
- `../../pi-ai-consortium/README.md` — sections `Planning assumptions` and `Open questions`; source for latency/token cost as primary attack surface and need for throttle/trigger mechanisms.
- `../../pi-subagent-coordinator/agent/coordinator-strategy-experiment-003-results.md` — sections `Fair solver comparison` and `Evidence-backed findings`; source for measured token/cost overhead of coordinator workflows.
