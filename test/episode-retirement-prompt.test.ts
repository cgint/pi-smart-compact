import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import registerRetirePrompt from "../src/episode-retirement-prompt.js";

describe("/retire prompt template", () => {
  beforeEach(() => delete process.env.PI_EPISODE_RETIREMENT_ENABLED);
  afterEach(() => delete process.env.PI_EPISODE_RETIREMENT_ENABLED);

  it.each([undefined, "1", "TRUE", "false", "true"])(
    "registers discovery unconditionally for env=%s (no gate)",
    (value) => {
      if (value === undefined) delete process.env.PI_EPISODE_RETIREMENT_ENABLED;
      else process.env.PI_EPISODE_RETIREMENT_ENABLED = value;
      const handlers: unknown[] = [];
      registerRetirePrompt({
        on: (...args: unknown[]) => handlers.push(args),
      } as never);
      expect(handlers).toHaveLength(1);
    },
  );

  it("registers exactly one absolute retire template path", async () => {
    let handler: any;
    registerRetirePrompt({ on: (event: string, value: unknown) => { expect(event).toBe("resources_discover"); handler = value; } } as never);
    expect(handler).toBeTypeOf("function");
    const result = await handler({}, {});
    expect(result.promptPaths).toHaveLength(1);
    expect(result.promptPaths[0]).toMatch(/\/prompts\/retire\.md$/);
    expect(result.promptPaths[0]).not.toContain("smart-compaction-prompt.md");
  });

  it("guides the native-tree handoff path with explicit user confirmation and no false 'applied' claim", async () => {
    const text = await readFile(
      new URL("../prompts/retire.md", import.meta.url),
      "utf8",
    );
    expect(text).toContain(
      "argument-hint: \"[optional continuation emphasis]\"",
    );
    for (const phrase of [
      "native_tree_targets",
      "handoff_record",
      "/tree-handoff <handoffId>",
      "explicitly confirm",
      "not applied automatically",
      "Never report a branch switch as done",
      "safe or worthwhile",
      "${ARGUMENTS:-",
    ]) {
      expect(text).toContain(phrase);
    }
    // The removed episode-retirement creation tools must not be referenced.
    expect(text).not.toContain("inspect_episode_retirement");
    expect(text).not.toContain("retire_episodes");
    expect(text).not.toContain("inspectionWitness");
    expect(text).not.toContain("pinnedWorkingState");
  });
});

// Real Pi resource discovery + prompt argument expansion (offline, no live model).
// Uses the installed package's prompt-template unit APIs directly. The package `exports` map
// does not expose this internal module, so it is imported by resolved file path from node_modules.
describe("/retire via real Pi prompt-template APIs", () => {
  const promptTemplatesPath = new URL(
    "../node_modules/@earendil-works/pi-coding-agent/dist/core/prompt-templates.js",
    import.meta.url,
  ).href;

  it("discovers /retire from the extension promptPath and expands ${ARGUMENTS:-...}", async () => {
    const pt: any = await import(promptTemplatesPath);
    const retirePath = new URL("../prompts/retire.md", import.meta.url).pathname;

    // Discover exactly as Pi does from the path the extension returns from resources_discover.
    const { templates, diagnostics } = pt.loadPromptTemplates({
      cwd: process.cwd(),
      agentDir: "/nonexistent-agent-dir",
      promptPaths: [retirePath],
      includeDefaults: false,
    });
    expect(diagnostics).toEqual([]);
    expect(templates).toHaveLength(1);
    const template = templates[0];
    expect(template.name).toBe("retire");
    expect(template.description).toBe("Ask the active agent to assess a native-tree branch handoff");
    expect(template.argumentHint).toBe("[optional continuation emphasis]");
    expect(template.filePath).toBe(retirePath);

    // No args -> ${ARGUMENTS:-...} default is substituted.
    const withDefault = pt.expandPromptTemplate("/retire", templates);
    expect(withDefault).toContain("No extra continuation emphasis supplied");
    expect(withDefault).not.toContain("${ARGUMENTS");

    // Supplied args -> expanded verbatim into the emphasis slot.
    const withArgs = pt.expandPromptTemplate("/retire keep the failing tests as the focus", templates);
    expect(withArgs).toContain("keep the failing tests as the focus");
    expect(withArgs).not.toContain("${ARGUMENTS");
    expect(withArgs).not.toContain("No extra continuation emphasis supplied");

    // Non-template text is returned unchanged.
    expect(pt.expandPromptTemplate("just a normal message", templates)).toBe("just a normal message");
  });
});
