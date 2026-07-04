## 1. Script implementation

- [x] 1.1 Create `testing/resumption_pilot.py` with argument parsing (compaction file path, condition type)
- [x] 1.2 Implement neutral resumption prompt template (identical across conditions, with control variant)
- [x] 1.3 Implement HTTP call to sparky:8001 with consistent model parameters (qwen36-35b-nvidia-nvfp4, temp=0.1)
- [x] 1.4 Implement response capture and saving to condition-specific output files
- [x] 1.5 Verify script works with a dry run (--help or test invocation)

## 2. Pilot execution

- [x] 2.1 Confirm sparky:8001 is reachable and model is available
- [x] 2.2 Run condition **control** (no compaction, workspace only) — save output
- [x] 2.3 Run condition **pi** (summary_pi.txt) — save output
- [x] 2.4 Run condition **smart** (summary_smart.txt) — save output

## 3. Scoring and results

- [x] 3.1 Score each condition on the three binary metrics (Goal Preservation, State Awareness, First Action Precision) against the gold standard
- [x] 3.2 Create `testing/behavioral_resumption_pilot.md` with raw outputs, metric scores, justification, and conclusion
- [x] 3.3 Apply TDD mindset: verify that scoring criteria are applied consistently across all conditions (no double standards)

## 4. Verification

- [x] 4.1 Verify all three output files exist and contain valid model responses
- [x] 4.2 Verify the results document addresses all three metrics for all three conditions
- [x] 4.3 Verify the conclusion references the stop signals from the concept (control≈smart, pi≈smart, smart>pi)
- [ ] 4.4 Final verification by the user: review `testing/behavioral_resumption_pilot.md` and confirm the behavioral difference (or lack thereof) is clearly documented