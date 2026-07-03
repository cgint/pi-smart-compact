# Test Suite Manifest

## Active sessions

| Slot | Session JSONL | Gold standard |
|---|---|---|
| 1 | `testing/sessions/--Users-cgint-dev-external-pi-smart-compact--.jsonl` | `testing/gold_standard/session_slot1-smart-compact-setup_optimal.md` |
| 2 | `testing/sessions/--Users-cgint-dev-web-scrape-meno--.jsonl` | `testing/gold_standard/session_slot2-web-scrape-debug_optimal.md` |
| 3 | `testing/sessions/--Users-cgint-dev-external-pi-discuss-mode--.jsonl` | `testing/gold_standard/session_slot3-discuss-mode-extension_optimal.md` |
| 4 | `testing/sessions/--Users-cgint-dev-web-scrape-meno--deploy.jsonl` | `testing/gold_standard/session_slot4-web-scrape-deploy_optimal.md` |

## Rubric

All scores use the **1–5 scale**.

Weighted dimensions:
- Trajectory Fidelity — 2×
- Decision Accuracy — 2×
- Continuation Sufficiency — 2×
- Size Discipline — 1×
- Fact/Inference Separation — 1×
- Evidence Anchoring — 1×
- Structural Completeness — 0.5×

Thresholds:
- **≥ 4.0**: acceptable
- **3.0–3.9**: marginal
- **< 3.0**: fail
