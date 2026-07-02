# pi-smart-compact North Star

## Status

This document is the guiding intent for `pi-smart-compact`. It corrects the goal hierarchy: the first and most important milestone is a smarter **prompt-only compaction mechanism** for Pi sessions, not a side-storage or lookup system.

## Main objective

Use the knowledge already present in the local Pi-related repositories, decision-context repositories, and relevant papers to design a compaction approach that is better than Pi’s built-in compaction.

The desired first result is a compaction prompt or prompt strategy that can transform an overloaded agentic session into a very small but highly informative continuation context.

The compacted output should aim for:

- minimum characters with maximum information;
- preservation of the bigger-picture objective;
- preservation of the current phase or sub-part of that bigger picture;
- enough current-state detail for the agent to continue intelligently;
- low noise and low irritation from stale or unnecessary session history;
- clear orientation about what matters now, what was already decided, and what should happen next.

## First milestone: prompt-only smart compaction

The first milestone is to create a better compaction mechanism using **one prompt**.

That prompt should contain the distilled knowledge, strategies, and design lessons derived from existing code, repositories, notes, and papers. It should guide the model to produce a compacted context that is smarter than a generic summary.

Important constraint for this milestone:

- Do **not** rely on storing additional snippets, side files, lookup tables, or external retrieval created during compaction.
- The compaction output itself must carry the essential continuation context.
- The prompt can use the research and strategy captured in this repository, but the runtime compaction act should initially be a direct prompt-based transformation.

This milestone may be sufficient by itself. If prompt-only compaction works well enough, later storage/retrieval phases may not be needed.

## What “better than built-in Pi compaction” means

Pi’s built-in compaction is understood here as prompt-based compaction over the session. The goal is not merely to imitate it, but to improve the compaction prompt with stronger strategy.

A better compaction should preserve:

- the active north star and user intent;
- the current work phase;
- decisions and constraints that still bind future action;
- unresolved blockers and uncertainty;
- key evidence and provenance when needed for correctness;
- concise next-step orientation;
- enough of the surrounding bigger picture to prevent local optimization or goal drift.

It should aggressively remove:

- stale planning chatter;
- repeated explanations;
- low-value tool narration;
- details that no longer influence the next decision;
- outdated hypotheses;
- redundant summaries of already-settled work.

## Source material to use

The knowledge base should derive strategy from:

- local `pi-*` repositories in `/Users/cgint/dev/concepts`;
- `decision-context-*` repositories adjacent to `/Users/cgint/dev/concepts`;
- papers and research-derived measures that informed those repositories;
- existing experiments around traces, minimal context packs, handoffs, reflection, supervisor traces, and context preservation.

Do not duplicate detailed source material here. Keep concise synthesis and exact source references so future agents can inspect the original when needed.

## Secondary idea: externalized lookup after prompt-only compaction

The externalized lookup idea is important, but it is a **future phase**, not the primary goal.

After reaching the first milestone, evaluate whether prompt-only compaction is enough. If it is not enough, consider a second-level design where compaction can store curated snippets or extracted information outside the compacted output and point the future agent to them.

This may help when:

- preserving all useful information inline would make the compacted output too large;
- removing information would lose important links to specific prior details;
- the future session may branch in ways that are hard to foresee;
- the user later refers to something discussed before compaction that was not judged central at compaction time.

A possible later hierarchy:

1. **Level 1 — compacted output:** smallest possible high-value continuation context.
2. **Level 2 — curated lookup:** selected snippets or extracted facts stored separately and referenced from the compacted output.
3. **Level 3 — raw session log:** fallback source for information not preserved in either the compacted output or curated lookup.

This future design should be considered only after the first milestone has produced and evaluated a better prompt-only compaction mechanism.

## Knowledge-base rules

- Keep this repository focused on compaction strategy, not generic documentation.
- Synthesize learnings into compact, agent-usable notes.
- Reference exact source paths for claims and design lessons.
- Preserve uncertainty explicitly.
- Separate the primary prompt-only compaction milestone from future storage/retrieval ideas.
- Optimize for a future agent quickly understanding how to design or test a better compaction prompt.

## Appendix A — user clarification, verbatim

Please also drop a hand-off file in there because another agent will continue there from a clean session.

I don't see my initial idea and goal setting well covered in the North Star that you created so there seem to be some minor uncertainties still. 

First and foremost I want to use the information we already have and some papers to come up with a very smart idea of how to do compaction better than the built-in compaction of PI. 
This does not store anything for lookup on the side. It just does a compaction based on one or multiple prompts. Let's start with one prompt that contains the knowledge and the strategies that are behind existing code to come up with a compaction that, to say it bluntly, has minimum characters with maximum information, oriented on the bigger picture but also the current phase or sub-part of that bigger picture the system is currently in. 

---

This is the first and most important milestone to reach and maybe we are done after that. 


---

What I then mentioned was an idea for the future, potentially, that I wanted to have noted down but not as the main goal. I want us to think if we could then, after we reached the first milestone of having a better compaction mechanism, without additionally storing information during that compaction. 
So this is meant as a second step. If we see that compaction alone is not ideal for what we want to do because we either would have to preserve a lot of information still in the output or we would lose even the connections to specific pieces of information and not only how it's currently listing files that were attached. 
So we could then extend further and for example store snippets of information out of the noise of the full session that we are about to compact into files or some lookup and then point the AI to this specific information in the output. This can give us a good mix of information contained in the compacted output and a second level of curated lookup. The third phase or step could be even pointing it to the raw session log so that the agent can afterwards decide where to find information based on how the session continues, which we can just foresee to some extent. In case something takes a completely different way, we can just prepare for that in this way to make it better and support multiple situations better. For example if the user refers to something that has been discussed in the session but was prior to compaction and wasn't seen as majorly interesting and relevant for the next steps, ultimately this could then be found in the third level of the raw log if it's not contained in the second level of our curated lookup. Note that done verbatim in the North Star as an appendix and rephrase the main North Star information with your own words.
