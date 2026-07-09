import { describe, it, expect, vi } from "vitest";
import { loadPrompt } from "../src/smart-compact.js";

describe("loadPrompt", () => {
  it("loads the smart compaction prompt", () => {
    const prompt = loadPrompt();
    expect(prompt).toBeTruthy();
    expect(prompt!.length).toBeGreaterThan(100);
  });

  it("contains the 12 rules", () => {
    const prompt = loadPrompt();
    expect(prompt).toContain("RULES:");
    expect(prompt).toContain("CRITICAL:");
    expect(prompt).toContain("Last Session Activity");
  });

  it("contains the output format sections", () => {
    const prompt = loadPrompt();
    expect(prompt).toContain("## What Was Done");
    expect(prompt).toContain("## Last Session Activity");
    expect(prompt).toContain("## What Is Unfinished");
    expect(prompt).toContain("## Current State");
    expect(prompt).toContain("## Immediate Next Step");
  });
});

describe("register", () => {
  it("registers session_before_compact handler", async () => {
    const mockPi: any = {
      on: vi.fn((_event: string, _handler: any) => {}),
    };

    const mod = await import("../src/smart-compact.js");
    mod.default(mockPi);

    expect(mockPi.on).toHaveBeenCalledWith("session_before_compact", expect.any(Function));
  });
});

describe("iterative compaction", () => {
  it("prompt includes conditional merge instruction for previous-summary", () => {
    const prompt = loadPrompt();
    expect(prompt).toContain("IF <previous-summary> TAGS ARE PRESENT");
    expect(prompt).toContain("PRESERVE all existing");
    expect(prompt).toContain("MERGE the new conversation");
  });
});