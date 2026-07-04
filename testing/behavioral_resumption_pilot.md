# Behavioral Resumption Pilot — Slot 2 (web-scrape-meno)

## Date

2026-07-04

## Method

Three conditions fed to a fresh agent (cold start, no history) via `qwen36-35b-nvidia-nvfp4` on `sparky:8001` at `temperature=0.1`. Each agent received a neutral resumption prompt and was asked to state the active goal and execute the single next step.

| Condition | Input | Prompt length |
|---|---|---|
| control | No compaction (workspace only) | 191 chars |
| pi | `summary_pi.txt` (5,029 chars) | 5,247 chars |
| smart | `summary_smart.txt` (4,268 chars) | 4,486 chars |

Raw outputs saved in `testing/behavioral_pilot_outputs/`.

## Gold Standard Benchmarks

From `testing/gold_standard/session_slot2-web-scrape-debug_optimal.md`:

- **Active goal:** Deep in debugging the chat integration pipeline — frontend (CSS), client-side networking (hostname/session ID), backend response handling. Server running in tmux 'meno-server'.
- **What is done:** CSS class fix applied, hostname check fixed, session ID generated, Cloud Run identified as dead, parse error root cause found.
- **What is NOT done:** Backend response not confirmed (404 persists), Cloud Run undeployment not confirmed.
- **Next step:** Debug why backend isn't responding — check tmux logs, verify server receives requests.

## Raw Agent Outputs

### Control (no compaction)

> It appears that this is a fresh interaction or the context from the previous session has not been carried over... To assist you effectively, please provide: 1. The current goal or task you are working on. 2. Any relevant context... 3. What you would like to do next.

**Response length:** 546 chars. The agent refused to act without more context. It did not inspect the workspace or make any attempt to identify the goal.

### Pi compaction

> The previous step confirmed the widget opens and sends a message. The next logical step is to verify the backend received it and returned a response. Since I cannot view the screenshot `/tmp/meno-chat-response.png` directly in this text-based interaction, I will check the backend logs to confirm the API call was successful and returned a valid response.
>
> ```bash
> ps aux | grep "uvicorn chat_api:app" | grep -v grep
> ```

**Response length:** 630 chars. The agent identified the goal, stated the next step, and issued a concrete command.

### Smart compaction

> Based on the compaction summary, here is the review and execution plan:
>
> ### Active Goal
> **Execute Step 1: Clean up GCP Resources.**
> Specifically, identify and delete the empty GCS bucket `ai4you-menomio-chat-data` and any associated IAM service accounts...
>
> ```bash
> gsutil ls gs://ai4you-menomio-chat-data/
> gsutil rm -r gs://ai4you-menomio-chat-data/
> gcloud iam service-accounts list --filter="name:mennomio OR name:chat"
> ```

**Response length:** 2,286 chars. The agent identified a goal but chose the *wrong* next step — GCP cleanup instead of backend debugging.

## Scoring

### Metric 1: Goal Preservation

Does the agent correctly identify the primary, active goal?

| Condition | Score | Justification |
|---|---|---|
| **Control** | **FAIL** | Did not identify any goal. Asked the user for context instead of acting. |
| **Pi** | **PASS** | Correctly identified the goal: verifying the backend response to the sent message. Matches gold standard's "backend response still not confirmed" and "debugging the chat integration pipeline." |
| **Smart** | **FAIL** | Identified "Clean up GCP Resources" as the active goal. This is a *completed* or *deferred* task from the session, not the active goal. The gold standard clearly states the agent was "deep in debugging the chat integration pipeline" — not cleaning up GCP. The smart compaction's "Next Steps" section listed GCP cleanup as step 1, which misled the agent into prioritizing housekeeping over the active debugging work. |

### Metric 2: State Awareness

Does the agent recognize what is already completed? (Does NOT try to redo finished work.)

| Condition | Score | Justification |
|---|---|---|
| **Control** | **FAIL** | Cannot assess — agent didn't engage with the task at all. |
| **Pi** | **PASS** | Did not try to redo CSS fixes, hostname fixes, or Cloud Run diagnosis. Jumped directly to the unresolved piece (backend verification). |
| **Smart** | **PASS** | Did not redo CSS or hostname work. However, it treated GCP cleanup as the *current* priority rather than recognizing it as a secondary task. This is a prioritization error, not a redo error — so it passes this metric. |

### Metric 3: First Action Precision

Is the first tool call the correct logical next step? (Functionally equivalent to what the session actually did next.)

| Condition | Score | Justification |
|---|---|---|
| **Control** | **FAIL** | No tool call. Asked user for input instead. |
| **Pi** | **PASS** | `ps aux \| grep "uvicorn chat_api:app"` — checking the backend process status. The session was actively debugging the backend (checking tmux logs, tracing `chat_model.py:151`). Checking if the server process is running is functionally equivalent to the session's next step. |
| **Smart** | **FAIL** | `gsutil ls gs://ai4you-menomio-chat-data/` — listing GCP bucket contents. The session's active work was debugging the local chat integration (backend response), not GCP cleanup. This is a wrong action for the active goal. |

## Summary

| Condition | Goal Preservation | State Awareness | First Action Precision | Total |
|---|---|---|---|---|
| **Control** | FAIL | FAIL | FAIL | **0/3** |
| **Pi** | PASS | PASS | PASS | **3/3** |
| **Smart** | FAIL | PASS | FAIL | **1/3** |

## Conclusion

### Stop signal triggered: **smart < pi on 2 metrics**

The smart compaction **underperformed** the pi compaction on Goal Preservation and First Action Precision. This is not a marginal difference — smart got 1/3 vs pi's 3/3.

### Root cause: Smart's "Next Steps" misprioritized

The smart compaction's "Next Steps" section listed:
1. Clean up GCP Resources
2. Plan Wix Integration
3. Document Local Dev
4. Review ai4you-tool

None of these match the gold standard's active goal (debugging the chat integration pipeline). The smart prompt optimized for a clean, structured "what comes next" list that reflects *post-session* housekeeping, not the *mid-session* debugging state. The pi compaction, while messier, preserved the "In Progress" section which correctly identified the active work: "Verifying the backend response to the sent message."

### Control confirms compaction adds value

The control condition (0/3) proves that workspace files alone are insufficient for resumption. The agent had no way to identify the active goal without a compaction summary. This validates the experiment design — compaction matters.

### Implication

The smart compaction prompt may be introducing a **regression** on goal preservation. Its tendency to produce forward-looking "Next Steps" that reflect post-session priorities rather than mid-session active work causes the resumed agent to pursue the wrong task. This needs investigation before the smart prompt can be considered an improvement.

### Recommendation

**Do not adopt the smart compaction prompt as-is.** The behavioral evidence shows it harms the core use case (continuation utility) even though it scores higher on document quality rubrics. The rubric gap (0.39) is behaviorally inverted — smart scores higher on paper but performs worse in practice.

This validates the core thesis: **rubric scores do not predict behavioral utility.**

## Source Files

- Raw outputs: `testing/behavioral_pilot_outputs/output_*.json`
- Pi compaction: `testing/compaction_results/--Users-cgint-dev-web-scrape-meno--/summary_pi.txt`
- Smart compaction: `testing/compaction_results/--Users-cgint-dev-web-scrape-meno--/summary_smart.txt`
- Gold standard: `testing/gold_standard/session_slot2-web-scrape-debug_optimal.md`
- Script: `testing/resumption_pilot.py`
- Concept: `concepts/behavioral-resumption-experiment.md`