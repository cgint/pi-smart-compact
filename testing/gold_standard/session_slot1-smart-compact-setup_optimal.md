# Slot 1 — Smart Compact Setup (2026-07-02)

## What Happened

User initialized a fresh Pi project for designing a prompt-only compaction mechanism. Loaded four skills (quality-discipline, critical-constructive-partner, start-self-organising, grounded-pairing-discipline). Established repo structure: git init, .gitignore (track agent/, ignore artifacts), committed instruction files.

User redirected planning: instead of jumping to implementation, collect compaction-relevant findings from papers, syntheses, and baselines first. Defined goal: "Collect compaction-relevant findings from the four described sources" with synthesis.

User constrained output to repository subdirectories only. Compared draft compaction prompt against Pi's built-in compaction instructions. User rejected agent's tendency to infer session types from context — insisted on user-provided compaction instructions instead.

Agent attempted to publish as a public GitHub extension. User corrected: don't install from local dir (breaks schema). Tested compaction in a separate cmux session ("xy1"). Agent struggled with cross-session communication — tried sending commands to wrong cmux tab.

User became increasingly frustrated: agent kept producing verbose outputs when asked for short answers, couldn't see compaction output, looped on troubleshooting. User ran `pi -e ./ 'call find . -name "*.md" And read all those Markdown files.'` in a test session to trigger compaction.

Agent then built a test harness: discovered sessions dir structure, wrote `compaction_test_harness.py`, `simulate_compaction.py`, compaction prompt. Installed a local model server (sparky/qwen36) for evaluation. User corrected: don't use ollama models that don't exist, use sparky 8001. Agent wrote files with bash instead of edit/write tool — user corrected.

User directed agent to create gold standards for the three existing test sessions and save them near the harness. Agent placed files in agent/ directory — user corrected: testing artifacts belong in the repo, not agent/.

## Outcome

Compaction MVP prompt drafted and tested via simulation. Test harness scaffolded (harness, simulation script, compaction prompt, gold standards). Repository published to GitHub as `pi-smart-compact` extension.

## Current State

Draft compaction prompt is complete. Next phase: field testing in live Pi sessions. Test harness exists but hasn't been validated against real sessions — the three test sessions were all identical ("find *.md and read"). Gold standards created but not yet evaluated against the rubric.

## Relevant Context

- Compaction prompt: `testing/compaction_test_prompt.md`
- Test harness: `testing/compaction_test_harness.py`
- Simulation script: `testing/simulate_compaction.py`
- Evaluation rubric: `testing/compaction_evaluation_rubric.md`
- Operational procedure: `testing/operational_evaluation_procedure.md`
- GitHub repo: `pi-smart-compact` (extension registered via `pi -e .`)
- Model server: sparky 8001 (`qwen36-35b-nvidia-nvfp4`)

## Uncertainty

- Whether the compaction prompt actually outperforms Pi's built-in compaction (untested in field)
- Whether the test harness correctly mimics Pi's token calculation and file-op extraction (agent admitted not knowing Pi's internals)
- Gold standard quality: created by the same agent who designed the prompt — potential bias