# Compaction Evolution — Phase 01: Behavioral Pilot & Prompt Optimization

> **Period:** 2026-07-02 → 2026-07-05
> **Status:** Complete
> **Parent:** [Compaction Evolution Index](./compaction-evolution.md)
> **Sessions:** `session-22to23-original-assessment.md`, `session-22to23-from-other-assessment.md`
> **Verbatim excerpts:** [`session-excerpts.md`](./session-excerpts.md)

---

## 1. The Core Finding: Rubric Scores ≠ Behavioral Utility

**Date:** 2026-07-03
**Source:** `concepts/behavioral-resumption-experiment.md`, pilot results

The static rubric evaluation showed smart compaction scoring higher than pi (4.26 vs 3.87). The behavioral pilot proved this was **inverted**:

| Strategy | Rubric Score | Behavioral Score (binary) | Behavioral Score (5-dim) |
|---|---|---|---|
| Pi | 3.87 | 3/3 | 18/25 |
| Smart (original) | 4.26 | 1/3 | n/a |
| Smart (optimized) | 4.26 | 3/3 | 22/25 |

**Root cause:** The smart prompt's "Next Steps" section listed post-session housekeeping (GCP cleanup) as #1, overshadowing the active debugging work. The resumed agent picked GCP cleanup as its goal — completely wrong.

**Key insight:** Rubric measures document quality (structure, decisions, anchoring). Behavioral test measures continuation utility. They can disagree.

---

## 2. Prompt Optimization Rounds

### Round 1: Binary Metrics (1/3 → 3/3)

**Iteration 1 — Structural Separation**
- Change: Split "Next Steps" into "Immediate Next Step" and "Later Tasks", added "What Is Unfinished"
- Result: Still 1/3. Structure changed but content wrong — agent picked "Update README"

**Iteration 2 — Anchor to Last Exchanges**
- Change: Rule forcing "Immediate Next Step" to derive from last exchanges, not strategic priorities
- Result: Still wrong. Agent picked "commit CSS fixes"

**Iteration 3 — Dedicated "Last Session Activity" Section**
- Change: Added mandatory section describing last 5-10 exchanges concretely
- Result: **3/3**. Agent correctly identified "verify AI response to test message"

**Lesson:** The compaction model needs a dedicated output slot to force it to describe the session tail. Without it, it defaults to holistic summarization that smooths over unresolved work.

### Round 2: 5-Dimension Rubric (22/25 ceiling)

Expanded scoring to 5 dimensions (Goal Precision, State Fidelity, Action Specificity, Context Retention, Drift Resistance), each 1-5.

**Smart scored 22/25:** GP:4, SF:4, AS:4, CR:4, DR:5
**Pi scored 18/25:** GP:4, SF:3, AS:3, CR:3, DR:5

Smart now leads pi on finer-grained metrics. The "Last Session Activity" section gives the resumed agent more concrete anchors.

**Iteration 4 — Error Signature Extraction**
- Change: Rules 11-12 demanding specific error details (HTTP codes, tracebacks, tmux names)
- Result: **Still 22/25**. No improvement.

**Structural ceiling discovered:** The deeper debugging context (404, `chat_model.py:151`, tmux 'meno-server') is in the **remaining 30%** of the session after the 70% split point. The compaction model literally cannot see this data.
- `conversation.txt` (visible to compaction): 4 mentions of debugging terms
- `remaining.txt` (invisible to compaction): 28 mentions

**Lesson:** Prompt changes cannot extract information the model cannot see. The 70% split is a structural bottleneck.

---

## 3. AI Ergonomics Insights (Canvas + Chat)

**Source:** `AI-Agent-Human-Interaction-Ergonomics-canvas.md`, `AI-Agent-Human-Interaction-Ergonomics-chat.md`

### The Problem
AI agents generate "performative meta-fluff" (announcing compliance: "Got the rules. Zero fluff from here on out.") when system prompts contain narrative text. The model treats narrative instructions as conversation to respond to, not constraints to internalize.

### The Four Mechanisms

| Mechanism | What it does | KV-Cache impact |
|---|---|---|
| **Static System Slotting** | Lock constraints at index 0 (system role) | Zero miss |
| **Tail-End Anchor Bumping** | Append tiny reminder at bottom of payload | Near-zero miss |
| **Constrained Decoding** | Mask forbidden output tokens via grammar | Zero miss |
| **Epoch-Based Chunk Eviction** | Append-only until threshold, then one-time collapse | One big miss per epoch |

### Mapping to Compaction

| Canvas Concept | Compaction Relevance |
|---|---|
| **Static Slotting** | Compaction prompt is the system instruction for the resumed session |
| **Tail-End Anchor** | "Last Session Activity" section *is* this — anchors session tail where attention is strongest |
| **Epoch Eviction** | Compaction IS the epoch reset. Validates: do it once, make it good, never touch prefix again |
| **Anti-Meta-Fluff** | Compaction output must be declarative state, not narrative — prevents resumed agent from treating it as conversation |

### Key Insight: Register Matters

The canvas proves: **narrative text triggers "response mode"** in the LLM. **Declarative state triggers "operation mode."**

If the compaction summary reads like a story ("The team discussed..."), the resumed agent tries to respond to it. If it reads as state ("Decision: X. Blocker: Y."), the agent uses it as operational context.

### Convergent validation from independent session

An independent review of the AI ergonomics canvas (session `session-22to23-from-other-assessment.md`) arrived at the same conclusion through a different path. Rather than starting from behavioral pilot data, it started from the canvas's mechanistic analysis of LLM interaction patterns and mapped directly to compaction concerns. The two paths converged on the same refinement:

> The compaction output format should enforce **declarative state language** (not narrative) to prevent the resumed agent from treating context as conversation.

See [`session-excerpts.md`](./session-excerpts.md) — "Three actionable insights from AI ergonomics canvas" for the verbatim exchange.

### Concrete prompt refinements proposed

Three targeted changes emerged from the convergence (verbatim from session):

**1. Writing posture rule**
> "Write as declarative state, not narrative. Use factual assertions ('Decision: X'), never story voice ('we decided...' or 'the user asked...'). The resumed agent must read this as operational context, not conversation to respond to."

**2. Strengthened anti-fluff ban**
> "Do NOT write acknowledgments, introductions, or meta-commentary ('Here is the summary...', 'Based on the session...'). Output only the template sections."

**3. Example pair (show, don't tell)**
> BAD: "The team discussed the approach and decided to use approach A because it performed better."
> GOOD: "Decision: Use approach A. Rationale: outperformed B in benchmark (see evidence)."

See [`session-excerpts.md`](./session-excerpts.md) — "Three targeted prompt changes and user expectation calibration" for the full exchange.

---

## 4. The Two Axes of Improvement

The optimization space has two orthogonal axes:

```
Axis 1: Encoding Quality (prompt)
  → How well the visible data is encoded into the summary
  → Register, error specificity, anti-fluff, diagnostic next step
  → Current ceiling: ~22/25 on Slot 2

Axis 2: Signal Quantity (data)
  → How much relevant data is visible to the compaction model
  → Split strategy, tail preservation, raw vs. compressed ratio
  → Current ceiling: structural (70% split cuts off debugging tail)
```

### Independent assessment confirms the split

A separate assessment concluded: **"The bottleneck is not the prompt — it's the 70% split."** This is not a contradiction but an orthogonal diagnosis. The two axes table from the convergence session:

| Prompt changes | The "70% split" assessment |
|---|---|
| **How** the summary is written (register, voice) | **What** proportion is compressed vs kept raw |
| Improves token encoding quality | Improves signal retention quantity |
| Affects how the resumed agent *reads* the summary | Affects how much the resumed agent *has* to read |

See [`session-excerpts.md`](./session-excerpts.md) — "Two-axis convergence: prompt quality vs split strategy" for the verbatim exchange.

### Axis 1: Prompt Precision Upgrades (Low Risk)

1. **Declarative state rule** — prevent narrative voice in the summary
2. **Anti-fluff ban** — ban meta-commentary ("Here is the summary...")
3. **Error signature extraction** — force capture of specific failure signals from visible data
4. **Diagnostic next step** — link "Immediate Next Step" to the last unresolved error

### Axis 2: Split Strategy (Medium Risk)

Current: Fixed 70% split — compress first 70%, keep last 30% raw.
Proposed: **Tail-preserving split** — keep last N tokens (e.g., last 20% or last 8K) raw, compress the rest. This ensures the debugging tail is always visible to the compaction model.

**Trade-off:** Requires harness changes and re-running all compactions.

---

## 5. Process Lessons (from original assessment session)

The original assessment session (`session-22to23-original-assessment.md`) surfaced a meta-problem worth recording: the work itself violated the precision standards the project demands.

### Test set integrity

The original test set was broken: all three sessions were identical ("find *.md and read all those Markdown files"). This meant the evaluation could only test one dimension (decision inflation resistance) and produced misleading scores. Replaced with four diverse real sessions covering distinct interaction styles.

See [`session-excerpts.md`](./session-excerpts.md) — "Broken test set diagnosis" for the verbatim exchange.

### Scale inconsistency

Old evaluation artifacts used a 0-10 scale with an 8.0 threshold. The rubric defines a 1-5 scale with a 4.0 threshold. The incompatibility was not caught until the user questioned it. Resolved by discarding the old artifacts and standardizing on the rubric's 1-5 scale.

See [`session-excerpts.md`](./session-excerpts.md) — "Scale inconsistency" for the verbatim exchange.

### User critique: precision in practice

> "So we are about to create a system that creates smart logic and structure and clarity but in the current work we do the exact opposite or what?"

This caught a real anti-pattern: building apparatus on broken foundations (wrong scale, obsolete files, untracked chaos) while designing a system that demands precision. The lesson is operational: **the discipline the compaction system enforces must be applied to the work of building it.**

See [`session-excerpts.md`](./session-excerpts.md) — "User critique: building precision systems while being imprecise" for the verbatim exchange.

---

## 6. Open Questions

1. **Optimal split ratio:** What percentage should be compressed vs. kept raw? 70/30 is arbitrary. Does 80/20 or 60/40 work better?
2. **Multi-session validation:** All findings are from Slot 2 only. Do they generalize?
3. **Automated harness:** The pilot is manual. Should we build an automated test for continuous regression detection?
4. **KV-cache implications:** How does the compaction output affect KV-cache efficiency in the resumed session? (Canvas suggests: compaction is the epoch reset — do it once, then append-only.)
5. **Register enforcement:** Can constrained decoding be used to ban narrative patterns in the compaction output?

---

## 7. Current State and Handoff

- Smart compaction prompt: 12 rules, 8 output sections (incl. "Last Session Activity", "What Is Unfinished", "Immediate Next Step", "Later Tasks")
- Behavioral score: Smart 22/25, Pi 18/25 on Slot 2
- User expectation: improvement to 22→23 or 22.5 is acceptable; evaluation setup acknowledged as narrow
- Structural ceiling: 70% split cuts off debugging tail (4 vs 28 debugging term mentions)
- Prompt precision upgrades: approved for implementation (3 targeted changes documented in §3)
- Next step: combine prompt precision upgrades + split strategy change for maximum effect

**Handoff to next phase:** implement prompt precision upgrades (Axis 1) and investigate split strategy changes (Axis 2).