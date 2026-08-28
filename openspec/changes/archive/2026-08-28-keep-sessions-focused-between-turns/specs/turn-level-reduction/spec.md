> **Historical, discontinued requirement set.** This feature is not supported on `main`;
> incomplete backup code is retained only in `wip/turn-reduction-prototype`.

## ADDED Requirements

### Requirement: Reduction is off unless explicitly enabled

Turn-level reduction SHALL be disabled by default and SHALL be controlled by a switch independent of the compaction switch, so the two mechanisms can be enabled, disabled, and measured separately.

#### Scenario: Switch not set

- **WHEN** a pre-request context event fires and the reduction switch is not enabled
- **THEN** the messages are returned unmodified and no model call is attempted

#### Scenario: Compaction enabled, reduction not

- **WHEN** the compaction switch is enabled and the reduction switch is not
- **THEN** compaction behaves exactly as before and no message is reduced

### Requirement: Only settled tool results are reduced

Reduction SHALL apply only to tool-result content the session has already moved past. The newest turn, user-authored messages, and assistant text SHALL be returned unmodified.

#### Scenario: Newest turn is protected

- **WHEN** the context event contains the tool results of the turn currently being reasoned over
- **THEN** those results are returned unmodified

#### Scenario: User message is protected

- **WHEN** the context event contains user-authored messages of any age
- **THEN** they are returned unmodified

### Requirement: A reduced message keeps a route back to the original

A reduced tool result SHALL contain a bounded excerpt together with a reference identifying the full original, and SHALL NOT be replaced by prose that cannot be traced back.

#### Scenario: Reduced result is traceable

- **WHEN** a settled tool result is reduced
- **THEN** the replacement carries both the excerpt and a reference to the unreduced original

### Requirement: Named content is never dropped

Reduction SHALL preserve exact error signatures, status codes, traceback locations, file paths, command invocations, and user-authored text, regardless of what the reducing model proposes.

#### Scenario: Error detail survives reduction

- **WHEN** a settled tool result contains a non-zero exit code and a traceback location
- **THEN** both appear verbatim in the reduced message

#### Scenario: Model proposes dropping protected content

- **WHEN** the reducing model returns an excerpt omitting a file path present in the original
- **THEN** the protected content is retained rather than the model's proposal being taken as given

### Requirement: Each message is reduced at most once

Reduction SHALL be computed at most once per message, cached by a stable key, and reused unchanged thereafter, so that the message prefix sent to the provider is stable across requests.

#### Scenario: Repeated requests produce identical context

- **WHEN** two consecutive pre-request context events occur with no intervening turn
- **THEN** the returned message arrays are byte-identical and exactly one reduction call was made

### Requirement: Failure leaves the context untouched

Any failure of the reduction path SHALL result in the original messages being returned, and SHALL NOT abort the request or raise out of the handler.

#### Scenario: Reducing model errors

- **WHEN** the reduction model call fails, times out, or returns unusable output
- **THEN** the original messages are returned and the request proceeds

### Requirement: Reductions are auditable from outside

Each reduction SHALL be logged with what was removed and from which message, so that its behaviour can be reviewed without re-running the session.

#### Scenario: Session is reviewed after the fact

- **WHEN** a session ran with reduction enabled
- **THEN** the log states, per reduced message, what content was removed

### Requirement: The stored session is never modified

Reduction SHALL affect only the messages sent to the provider. The session transcript SHALL remain complete, so that every reduced span stays recoverable.

#### Scenario: Transcript checked after a reduced session

- **WHEN** a session has run with reduction enabled
- **THEN** the stored transcript contains the original unreduced tool results
