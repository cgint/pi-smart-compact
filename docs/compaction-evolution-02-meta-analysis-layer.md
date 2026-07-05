# Compaction Evolution — Phase 02: Meta-Analysis Layer

> **Period:** 2026-07-05 →
> **Status:** Exploration
> **Parent:** [Compaction Evolution Index](./compaction-evolution.md)
> **Inspiration:** `criticalthink` skill pattern
> **Axis:** 1 (Encoding Quality)

---

## 1. Motivation

The behavioral pilot (Phase 01) revealed that operational summaries alone are insufficient. The resumed agent needs **meta-awareness** — not just "here's where we are" but "here's the quality of our reasoning and what to watch for."

The `criticalthink` skill (`agent/skills/criticalthink-retro/SKILL.md`) demonstrates a proven pattern: force structured self-skepticism through a fixed 6-section scaffold. The AI can't skip to "looks good" because the format demands it find weaknesses first.

**Opportunity:** Adapt this pattern for session-level compaction. Add a lightweight meta-analysis layer that encodes reasoning quality, assumptions, risks, and uncertainty zones — giving the resumed agent guardrails alongside operational state.

---

## 2. Source Pattern: criticalthink Framework

The criticalthink skill uses this structure:

| Section | Purpose | Session-Level Translation | Value |
|---|---|---|---|
| §1 Core Thesis | Name the claim + confidence | → Already captured by "Goal" section | Redundant |
| §2 Assumptions | What must be true for this to work | → **Working Assumptions** | **High** |
| §3 Logical Gaps | Does reasoning connect? | → **Reasoning Gaps** | **High** |
| §4 AI Pitfalls | Evasion, happy path, over-engineering | → **Session Blindspots** | **Medium** |
| §5 Risks | Overlooked risks + alternatives | → **Known Risks & Alternatives** | **High** |
| §6 Synthesis | Revise confidence after analysis | → **Uncertainty Zones** | **Medium** |

Not all sections translate equally. The compaction already captures operational state. We need the **meta-layer** — the parts that are currently missing.

---

## 3. Proposed Design

### New section: `## Session Integrity Check`

Appended to the existing compaction output format, after operational sections (Goal, Progress, Decisions, Next Steps).

```markdown
## Session Integrity Check

### Working Assumptions
- [Key assumptions the current path depends on, with fragility noted]
- Format: "Assumption: X. Fragile if: Y."
- Max 4 items. Prioritize assumptions that, if wrong, would invalidate the current direction.

### Reasoning Gaps
- [Where decisions were made on incomplete evidence or where the session may have evaded a harder problem]
- Format: "Gap: [what was decided]. Weakness: [why the reasoning may be thin]."
- Max 3 items. Focus on decisions with thin evidence chains.

### Known Risks & Alternatives
- [Approaches considered but discarded, with rationale; risks not yet addressed]
- Format: "Risk: X. Alternative considered: Y (discarded because Z)."
- Max 3 items. Surface near-misses and deferred decisions.

### Uncertainty Zones
- [Areas where the session lacks conclusive evidence]
- Format: "Uncertain: X. Needs verification: Y."
- Max 3 items. Flag what the resumed agent should re-check before proceeding.
```

### Design principles

1. **Structured format, not narrative** — follows the declarative-state rule from AI ergonomics work (Phase 01, §3). Each item has a template shape so the resumed agent can parse it mechanically.

2. **Forward utility** — not "here's what went wrong" but "here's what to watch for when continuing." Each subsection answers a question the resumed agent would ask.

3. **Bounded length** — 3-4 items max per subsection. Forces prioritization, prevents fluff.

4. **Axis 1 scope** — improves encoding quality without changing the split strategy. Low risk to implement.

---

## 4. Example: Applied to a Real Session

*Based on the behavioral pilot session (Slot 2) where the agent was debugging a 404 error in `chat_model.py:151`.*

**Without meta-analysis (current):**

```markdown
## Next Steps
1. Verify AI response to test message
2. Check tmux session 'meno-server' for error logs
```

**With meta-analysis (proposed):**

```markdown
## Next Steps
1. Verify AI response to test message
2. Check tmux session 'meno-server' for error logs

## Session Integrity Check

### Working Assumptions
- Assumption: The 404 originates from chat_model.py:151. Fragile if: the error is actually upstream (proxy/load balancer) and the traceback is misleading.
- Assumption: Node 18 is the CI constraint causing build failures. Fragile if: CI environment has been upgraded since the session.

### Reasoning Gaps
- Gap: Decision to patch chat_model.py directly. Weakness: Root cause of the 404 was not confirmed — patch addresses symptoms, not source.

### Known Risks & Alternatives
- Risk: Patch may break other endpoints. Alternative considered: restart the service first (deferred because tmux session was unstable).

### Uncertainty Zones
- Uncertain: Whether the 404 is reproducible. Needs verification: curl the endpoint before applying patch.
- Uncertain: Exact tmux session state after crash. Needs verification: `tmux list-sessions` on reconnect.
```

The resumed agent now knows: the next step is clear, but the reasoning behind it is thin, and there are specific things to verify before committing.

---

## 5. Key Decisions to Resolve

### 5.1 Mandatory vs Conditional

**Question:** Should "Session Integrity Check" always appear, or only when the session has detectable uncertainty/risks?

| Approach | Pros | Cons |
|---|---|---|
| **Mandatory** | Consistent output shape; resumed agent always knows what to expect | Adds tokens to simple sessions where all subsections would be "(none)" |
| **Conditional** | Saves tokens on straightforward sessions | Risks under-reporting; compaction model may miss subtle risks |

**Tentative leaning → Measured conclusion:** Mandatory. Evidence from all 4 sessions:
- Simplest sessions (small base output) benefit most from meta-analysis — there's less operational detail anchoring the resumed agent
- Absolute cost (~600 tokens avg) is well within Pi's 16K reserve
- Arbitrary size thresholds risk cutting the sessions that benefit most (see §7.3 conditional mode analysis)
- Allow "(none)" when a subsection has nothing to report, to avoid forced fluff

### 5.2 Token Budget (Measured)

Actual measurements across all 4 test sessions (see §7.3 for full breakdown):

| Session | smart | smart_meta | Meta-only chars | Meta-only tokens (≈) |
|---|---|---|---|---|
| Slot 1 (discuss-mode) | 2768 | 5647 | +2879 | ~720 |
| Slot 2 (web-scrape) | 4940 | 7876 | +2936 | ~734 |
| Slot 3 (smart-compact) | 5628 | 8041 | +2413 | ~603 |
| Slot 4 (deploy) | 5497 | 6181 | +684 | ~171 |
| **Average** | 4458 | 6936 | **+2478** | **~617** |

**Key finding:** The meta-analysis adds a roughly **constant floor of ~2400-2900 chars** (~600-730 tokens) across sessions. It is not proportional to session complexity — it's a fixed overhead. The *percentage* varies wildly (12%→104%) purely because the denominator changes.

Pi's `reserveTokens` default is 16,384. Even the largest smart_meta output (~8000 chars ≈ ~2000 tokens) is well within budget. No overflow risk.

**Token cost vs Axis 2 trade-off:** The ~600 token meta-analysis floor consumes reserve budget that could otherwise go to raw tail preservation (Axis 2: split strategy). If we later reduce the compressed portion to keep more tail raw, the meta-analysis overhead becomes a larger fraction of the reserved zone. Monitor if pursuing both axes simultaneously.

### 5.3 Prompt Integration

The compaction prompt (`testing/compaction_test_prompt.md`) needs:
1. The new output section added to the template
2. A rule in the RULES block instructing the compaction model to perform meta-analysis
3. Examples (show/don't tell) to calibrate the output quality

---

## 6. Test Plan

### 6.1 Experiment Design

**Hypothesis:** Adding the Session Integrity Check section improves behavioral resumption by surfacing reasoning quality, assumptions, and uncertainty zones — giving the resumed agent guardrails alongside operational state.

**Variable:** Only the prompt changes (smart → smart+meta). Same model, same session, same 70% split.

**Control:** `smart` (iteration 3, current baseline at 22/25 on Slot 2)
**Treatment:** `smart_meta` (smart + meta-analysis rules + output section)

### 6.2 Expected Impact by Dimension

| Dimension | Prediction | Rationale |
|---|---|---|
| Goal Precision | → Neutral | Meta-analysis doesn't change goal extraction |
| State Fidelity | ↑ Improve | Uncertainty zones surface what's unresolved more explicitly |
| Action Specificity | ↑ Improve | Reasoning gaps flag thin decisions, agent acts more precisely |
| Context Retention | → Neutral | Meta-analysis adds meta-context, not operational anchors |
| Drift Resistance | ↑ Improve | Risks/alternatives section prevents pivoting to discarded paths |

**Expected delta:** +1 to +2 points (22→23 or 22→24), primarily on State Fidelity and Drift Resistance.

### 6.3 Test Scope

- **Primary:** Slot 2 (`--Users-cgint-dev-web-scrape-meno--`) — established baseline, 22/25
- **Secondary:** Slots 1, 3, 4 — check generalization after primary validates

### 6.4 Implementation Steps

1. **Create `smart_meta` prompt variant** — copy of `get_smart_prompt()` with:
   - Additional rules (13-15) for meta-analysis generation
   - `## Session Integrity Check` section appended to output format
2. **Register in harness** — add `smart_meta` to `STRATEGIES` dict
3. **Run harness** — `python3 testing/compaction_test_harness.py --sessions --Users-cgint-dev-web-scrape-meno-- --strategies smart smart_meta`
4. **Compare outputs** — qualitative review of both compaction summaries
5. **Behavioral evaluation** — score both on 5-dimension rubric against gold standard
6. **Record results** — update this document with scores and diagnosis

### 6.5 Success Criteria

- **Minimum:** smart_meta ≥ smart on all dimensions (no regression)
- **Target:** smart_meta ≥ 23/25 on Slot 2 (≥ +1 improvement)
- **Stretch:** smart_meta ≥ 23/25 across all 4 slots (generalizes)

### 6.6 Failure Modes

| Failure | Signal | Response |
|---|---|---|
| Null result | smart_meta = smart (22/25) | Revisit format; maybe meta-analysis is too abstract for the resumed agent |
| Negative result | smart_meta < smart | Meta-analysis introduces noise; simplify or make conditional |
| Token overflow | Output exceeds model limits | Reduce item bounds (3→2 per subsection) |
| Generic fluff | Meta-analysis sections are vague/unspecific | Add stronger examples to prompt; tighten format templates |

---

## 7. Test Results — Slot 2 (Primary)

### 7.1 Size Impact

| Metric | smart | smart_meta | Delta |
|---|---|---|---|
| Chars | 5053 | 6957 | +1904 (+38%) |
| Words | 648 | 941 | +293 (+45%) |

### 7.2 5-Dimension Scores (Slot 2)

| Dimension | smart | smart_meta | Delta |
|---|---|---|---|
| Goal Precision | 4 | 4 | → |
| State Fidelity | 4 | **5** | +1 |
| Action Specificity | 4 | 4 | → |
| Context Retention | 4 | **5** | +1 |
| Drift Resistance | 5 | 5 | → |
| **Total** | **22/25** | **23/25** | **+1** |

Improvement on State Fidelity (uncertainty zones surface what's unknown) and Context Retention (meta-analysis adds operational anchors like GCS bucket status, Wix integration mechanism).

See [`testing/behavioral_resumption_5dim_scores_meta.md`](testing/behavioral_resumption_5dim_scores_meta.md) for full evaluation.

### 7.3 Cross-Session Size Impact (All 4 Slots)

| Session | smart | smart_meta | Delta chars | Delta % |
|---|---|---|---|---|
| Slot 1 (discuss-mode) | 2768 | 5647 | +2879 | **+104%** |
| Slot 2 (web-scrape) | 4940 | 7876 | +2936 | +59% |
| Slot 3 (smart-compact) | 5628 | 8041 | +2413 | +43% |
| Slot 4 (deploy) | 5497 | 6181 | +684 | +12% |

### 7.3 Cross-Session Size Impact (All 4 Slots)

| Session | smart | smart_meta | Delta chars | Delta % |
|---|---|---|---|---|
| Slot 1 (discuss-mode) | 2768 | 5647 | +2879 | **+104%** |
| Slot 2 (web-scrape) | 4940 | 7876 | +2936 | +59% |
| Slot 3 (smart-compact) | 5628 | 8041 | +2413 | +43% |
| Slot 4 (deploy) | 5497 | 6181 | +684 | +12% |

**Pattern: constant floor, not proportional.** The meta-analysis adds ~2400-2900 chars regardless of session complexity. The percentage explosion on Slot 1 (+104%) is purely mathematical — dividing a fixed ~2500 by a small denominator (2768). Absolute cost is ~700 tokens, well within Pi's 16K reserve.

#### Per-session quality assessment

**Slot 1 (discuss-mode) — highest relative cost, highest relative value:**
The simplest session (straightforward refactor: remove `reset` mode). Base smart output was small (2768 chars) because there was little operational complexity. Meta-analysis added genuinely useful content:
- Real fragilities: `bash` tool rationale requirement, user workflow assumptions around `reset`/`off`
- Real reasoning gaps: why the agent failed to provide `rationale` for bash
- Concrete uncertainty zones: git state after failed bash loop, test coverage for consolidation

**Is doubling 2768→5647 worth it?** Yes if context window has room. The simplest sessions are often where meta-analysis adds the *most relative value* — there's less operational detail to anchor the resumed agent, so the meta-layer fills the context gap. Paradox: the sessions with smallest base output benefit most from meta-analysis.

**Slot 2 (web-scrape) — the benchmark:**
Rich debugging session. Meta-analysis added 2936 chars of high-signal content (assumptions about data_store integrity, Cloud Run deletion gaps, Wix integration uncertainties). Drove the +1 rubric improvement.

**Slot 3 (smart-compact) — moderate session:**
Design/planning session. Meta-analysis added 2413 chars (Pi API assumptions, prompt verbosity concerns, extension API stability). Solid signal.

**Slot 4 (deploy) — lowest delta, most complete session:**
Nearly complete session (deployed, 143 tests passing, committed). Less uncertainty to surface, so meta-analysis is leaner (+684 chars, +12%). The session had fewer gaps because most work was finished.

#### Conditional mode analysis

If we skip meta-analysis for sessions where smart output < X chars:

| Threshold | Sessions skipped | Tokens saved | Risk |
|---|---|---|---|
| < 3000 | Slot 1 only | ~720 | Loses the session with highest relative meta value |
| < 5000 | Slots 1, 2 | ~1454 | Loses the benchmark session (Slot 2) where we proved +1 improvement |
| < 5500 | Slots 1, 2, 3 | ~2057 | Only Slot 4 keeps meta — defeats the purpose |

**Conclusion:** Arbitrary thresholds risk cutting the sessions that benefit most. The paradox is that simple sessions (small base) gain the most from meta-analysis, because there's less operational detail anchoring the resumed agent. **Recommendation: keep mandatory.** The absolute cost (~600 tokens avg) is well within reserve budget. If context pressure becomes real, revisit.

**Quality check:** Spot-checked all 4 sessions. Meta-analysis is high-signal across session types — specific assumptions, real reasoning gaps, grounded risks. No generic fluff detected.

### 7.5 Competitive context: smart_meta vs Pi

The real benchmark is Pi, not smart. Compared to Pi's output:

| Session | pi | smart | smart_meta | smart_meta vs pi |
|---|---|---|---|---|
| Slot 1 (discuss-mode) | 4554 | 2768 | 5647 | **+1093** |
| Slot 2 (smart-compact) | 7684 | 5628 | 8045 | +361 |
| Slot 3 (web-scrape) | 5029 | 4944 | 7882 | +2853 |
| Slot 4 (deploy) | 8836 | 5497 | 6181 | **-2655** |
| **AVG** | **6525** | **4709** | **6938** | **+413 (+6%)** |

**On average, smart_meta (6938) is only +6% larger than Pi (6525).** And on Slot 4 it's actually *smaller* than Pi (-30%). The +100% headline on Slot 1 is smart→smart_meta, not smart_meta→Pi.

**Perspective:** smart was intentionally lean (4709 avg, -28% vs Pi). Adding meta-analysis brings us to roughly Pi's size (6938 vs 6525) while delivering +1 rubric improvement. We're trading ~6% more tokens for measurable quality gain — that's a good deal.

### 7.4 Conclusion

The meta-analysis layer delivers **+1 on the 5-dimension rubric** for Slot 2 (22→23/25), with high-quality signal across all 4 sessions. Key findings:

- **vs Pi (real benchmark):** smart_meta averages only +6% larger than Pi (6938 vs 6525 chars). On some sessions it's smaller than Pi. We're trading ~6% more tokens for measurable quality gain.
- **vs smart (our baseline):** smart was intentionally lean (-28% vs Pi). Meta-analysis brings us to roughly Pi's size while beating Pi on rubric score.
- **Constant overhead:** ~2400-2900 chars (~600-730 tokens) regardless of session complexity
- **No overflow risk:** Largest output (8045 chars) well within Pi's 16K reserve
- **Simplest sessions benefit most:** Paradox — small base output sessions gain the most relative value
- **Recommendation: keep mandatory** at current bounds (max 3 items per subsection)

---

## 8. Risks

1. **Generic fluff:** The compaction model may produce vague meta-analysis ("There may be risks") instead of specific insights. Mitigation: format templates force concrete structure; examples calibrate quality.

2. **Over-confident meta-analysis:** The compaction model may misidentify assumptions or gaps, leading the resumed agent down wrong paths. Mitigation: bound to observable session content; ban speculation not grounded in the conversation.

3. **Token budget pressure:** Measured at ~600 tokens average (+40-60% for rich sessions, +100% for minimal). Well within Pi's 16K reserve even at worst case (~8000 chars). Risk only materializes if pursuing Axis 2 (larger raw tail) simultaneously, as meta-analysis floor competes with tail preservation for reserve budget.

4. **Compaction model capability:** The meta-analysis requires the model to think critically about the session's reasoning — a harder task than summarization. May not work well on weaker models. Mitigation: test across model tiers; degrade gracefully if quality is low.

---

## 9. Open Questions

1. Should the meta-analysis be generated by the **same model** that does the compaction, or a **separate pass** with a stronger model?
2. Can we measure meta-analysis quality independently, or only through downstream behavioral effects?
3. Does the format need different subsections for different session types (debugging vs planning vs implementation)?
4. Should the resumed agent be instructed to **explicitly check** the integrity check before acting, or is passive exposure sufficient?
5. How does this interact with Axis 2 (split strategy)? If we keep more tail raw, does the meta-analysis have better input data?

---

## 10. Done Criteria

- [ ] Revised `compaction_test_prompt.md` with Session Integrity Check section
- [ ] Sample output demonstrating the new section on at least 2 test sessions
- [ ] Token cost measured and documented
- [ ] Behavioral evaluation showing improvement (or neutral) vs 22/25 baseline
- [ ] User confirmation that the added context feels valuable, not verbose