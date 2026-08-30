import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import registerRetirePrompt from "../src/episode-retirement-prompt.js";

describe("/retire prompt template", () => {
  beforeEach(() => delete process.env.PI_EPISODE_RETIREMENT_ENABLED);
  afterEach(() => delete process.env.PI_EPISODE_RETIREMENT_ENABLED);

  it.each([undefined, "1", "TRUE", "false"])(
    "does not register discovery for %s",
    (value) => {
      if (value === undefined) {
        delete process.env.PI_EPISODE_RETIREMENT_ENABLED;
      } else {
        process.env.PI_EPISODE_RETIREMENT_ENABLED = value;
      }
      const handlers: unknown[] = [];
      registerRetirePrompt({
        on: (...args: unknown[]) => handlers.push(args),
      } as never);
      expect(handlers).toEqual([]);
    },
  );

  it("registers exactly one absolute retire template path", async () => {
    process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
    let handler: any;
    registerRetirePrompt({ on: (event: string, value: unknown) => { expect(event).toBe("resources_discover"); handler = value; } } as never);
    expect(handler).toBeTypeOf("function");
    const result = await handler({}, {});
    expect(result.promptPaths).toHaveLength(1);
    expect(result.promptPaths[0]).toMatch(/\/prompts\/retire\.md$/);
    expect(result.promptPaths[0]).not.toContain("smart-compaction-prompt.md");
  });

  it("contains the native template contract", async () => {
    const text = await readFile(
      new URL("../prompts/retire.md", import.meta.url),
      "utf8",
    );
    expect(text).toContain(
      "argument-hint: \"[optional continuation emphasis]\"",
    );
    for (const phrase of [
      "assess whether",
      "always call `inspect_episode_retirement` first",
      "page as needed",
      "independently decides",
      "oldest included completed episode",
      "continuation goal",
      "retire_episodes",
      "active or unresolved work",
      "safe or worthwhile",
      "what should remain salient or happen next",
      "never a boundary, goal, or count",
      "inspectionwitness",
      "pinnedworkingstate",
    ]) {
      expect(text.toLowerCase()).toContain(phrase);
    }
    expect(text).toContain("${ARGUMENTS:-");
  });

  it("RED: requires inspect paging and independently authored pinned working state", async () => {
    const text = await readFile(new URL("../prompts/retire.md", import.meta.url), "utf8");
    for (const phrase of [
      "inspect_episode_retirement",
      "page as needed",
      "pinnedWorkingState",
      "independently author",
      "fromEpisodeInclusive",
      "inspectionWitness",
    ]) expect(text).toContain(phrase);
  });
});
