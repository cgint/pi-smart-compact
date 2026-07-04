## ADDED Requirements

### Requirement: Script accepts a compaction file path and condition type
The resumption runner SHALL accept a compaction file path and a condition type (pi, smart, control) as input parameters.

#### Scenario: Valid compaction file provided
- **WHEN** the script is invoked with a valid compaction file path and condition type
- **THEN** it loads the compaction content and proceeds to send it to the model endpoint

#### Scenario: Control condition provided
- **WHEN** the script is invoked with condition type "control"
- **THEN** it uses the control prompt (no compaction summary) instead of loading a file

### Requirement: Script sends compaction to model endpoint with neutral prompt
The resumption runner SHALL send the compaction content to the model endpoint (sparky:8001) using a neutral resumption prompt that is identical across all conditions.

#### Scenario: Pi condition executed
- **WHEN** the script runs with condition "pi" and a pi compaction file
- **THEN** it sends the compaction content wrapped in the neutral resumption prompt to `http://sparky:8001/v1/chat/completions`

#### Scenario: Smart condition executed
- **WHEN** the script runs with condition "smart" and a smart compaction file
- **THEN** it sends the compaction content wrapped in the neutral resumption prompt to the same endpoint

### Requirement: Script captures the agent's first turn output
The resumption runner SHALL capture and save the model's first turn response, including any stated goal and first tool call.

#### Scenario: Response saved to file
- **WHEN** the model returns a response
- **THEN** the script saves the raw response to a condition-specific output file (e.g., `output_pi.json`, `output_smart.json`, `output_control.json`)

### Requirement: Script uses consistent model parameters
The resumption runner SHALL use the same model ID (`qwen36-35b-nvidia-nvfp4`) and temperature across all conditions to isolate compaction as the only variable.

#### Scenario: Model parameters are consistent
- **WHEN** the script runs any condition
- **THEN** it uses `model=qwen36-35b-nvidia-nvfp4` and a fixed temperature (e.g., 0.1) for determinism