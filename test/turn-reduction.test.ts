import { describe, it, expect, afterEach } from "vitest";
import { deriveProtectedToolCallIds } from "../src/smart-compact.js";
import {
  AFTER_N_VAR,
  DEFAULT_MIN_INPUT_CHARS,
  DEFAULT_MIN_GAIN_RATIO,
  MAX_RESTORED_TOKENS,
  originalFilename,
  pointerLine,
  sessionDirName,
  MIN_CHARS_VAR,
  worthKeeping,
  ENABLED_VAR,
  TurnTracker,
  applyFloor,
  eligibleIndices,
  formatReduction,
  reductionFilename,
  loadReductionPrompt,
  protectedTokens,
  readConfig,
  reduceContext,
} from "../src/turn-reduction.js";

afterEach(() => {
  delete process.env[ENABLED_VAR];
  delete process.env[AFTER_N_VAR];
});

const toolResult = (id: string, text: string, toolName = "bash") => ({
  role: "toolResult" as const,
  toolCallId: id,
  toolName,
  content: [{ type: "text", text }],
});

describe("readConfig", () => {
  it("is off by default", () => {
    expect(readConfig({})).toEqual({ enabled: false, afterN: 1, minInputChars: DEFAULT_MIN_INPUT_CHARS, minGainRatio: DEFAULT_MIN_GAIN_RATIO });
  });

  it("defaults N to 1 — reduce as soon as the turn is over", () => {
    expect(readConfig({ [ENABLED_VAR]: "true" }).afterN).toBe(1);
  });

  it("takes N from the environment", () => {
    expect(readConfig({ [ENABLED_VAR]: "true", [AFTER_N_VAR]: "3" }).afterN).toBe(3);
  });

  it("falls back to 1 for junk or out-of-range N rather than disabling silently", () => {
    for (const bad of ["0", "-2", "abc", "1.5", ""]) {
      expect(readConfig({ [AFTER_N_VAR]: bad }).afterN).toBe(1);
    }
  });
});

describe("TurnTracker", () => {
  it("stamps every tool call of one turn with the same turn — a turn yields many calls", () => {
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }, { toolCallId: "b" }]);
    t.endTurn([{ toolCallId: "c" }]);
    expect(t.turnsBehind("a")).toBe(1);
    expect(t.turnsBehind("b")).toBe(1);
    expect(t.turnsBehind("c")).toBe(0);
  });

  it("reports an unseen tool call as unknown, not as zero", () => {
    expect(new TurnTracker().turnsBehind("never-seen")).toBeUndefined();
  });
});

describe("eligibleIndices", () => {
  const messages = [
    { role: "user", content: [] },
    toolResult("a", "old"),
    { role: "assistant", content: [] },
    toolResult("b", "new"),
  ];

  it("selects only tool results at least N turns behind", () => {
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([{ toolCallId: "b" }]);
    expect(eligibleIndices(messages, 1, (id) => t.turnsBehind(id))).toEqual([1]);
  });

  it("selects nothing when N is larger than any result's age", () => {
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([{ toolCallId: "b" }]);
    expect(eligibleIndices(messages, 5, (id) => t.turnsBehind(id))).toEqual([]);
  });

  it("never selects an unplaceable tool call — a resumed session must not lose content", () => {
    expect(eligibleIndices(messages, 1, () => undefined)).toEqual([]);
  });

  it("never selects user or assistant messages", () => {
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }, { toolCallId: "b" }]);
    t.endTurn([]);
    const picked = eligibleIndices(messages, 1, (id) => t.turnsBehind(id));
    expect(picked.every((i) => messages[i].role === "toolResult")).toBe(true);
  });
});

describe("the floor", () => {
  it("finds error signatures, paths and file:line", () => {
    const found = protectedTokens("ENOENT at src/app.ts:42 reading ./config.json, exit code 2");
    expect(found).toContain("ENOENT");
    expect(found).toContain("src/app.ts:42");
    expect(found.some((t) => t.includes("./config.json"))).toBe(true);
    expect(found.some((t) => /exit code 2/i.test(t))).toBe(true);
  });

  it("restores protected content the model dropped instead of rejecting the whole reduction", () => {
    const original = "Traceback at src/app.ts:42\nENOENT: no such file\n" + "filler ".repeat(200);
    const result = applyFloor(original, "It failed.");
    expect(result).not.toBeNull();
    expect(result!).toContain("src/app.ts:42");
    expect(result!).toContain("ENOENT");
    expect(result!.length).toBeLessThan(original.length);
  });

  it("only enforces the floor; judging the trade is worthKeeping's job", () => {
    expect(applyFloor("plain text", "shorter")).toBe("shorter");
  });
});

describe("reduceContext", () => {
  const settled = (id = "a") => {
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: id }]);
    t.endTurn([]);
    return t;
  };

  it("returns messages untouched when disabled, and makes no model call", async () => {
    let calls = 0;
    const messages = [toolResult("a", "x".repeat(500))];
    const out = await reduceContext(messages, {
      config: { enabled: false, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: () => 5,
      reduce: async () => { calls++; return "short"; },
    });
    expect(out).toEqual(messages);
    expect(calls).toBe(0);
  });

  it("reduces a settled tool result", async () => {
    const out = await reduceContext([toolResult("a", "y".repeat(500))], {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => settled().turnsBehind(id),
      reduce: async () => "listed 3 files",
    });
    expect((out[0] as any).content[0].text).toBe("listed 3 files");
  });

  it("reduces each message at most once — the prefix must stay byte-identical", async () => {
    let calls = 0;
    const cache = new Map<string, string>();
    const messages = [toolResult("a", "z".repeat(500))];
    const options = {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id: string) => settled().turnsBehind(id),
      reduce: async () => { calls++; return `reduced ${calls}`; },
      cache,
    };
    const first = await reduceContext(messages, options);
    const second = await reduceContext(messages, options);
    expect(calls).toBe(1);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("leaves the message untouched when the model call fails", async () => {
    const messages = [toolResult("a", "q".repeat(500))];
    const out = await reduceContext(messages, {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => settled().turnsBehind(id),
      reduce: async () => { throw new Error("model exploded"); },
    });
    expect(out).toEqual(messages);
  });

  it("reports what it removed so the behaviour can be audited", async () => {
    const seen: Array<{ before: number; after: number }> = [];
    await reduceContext([toolResult("a", "w".repeat(500))], {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => settled().turnsBehind(id),
      reduce: async () => "tiny",
      onReduced: (r) => seen.push({ before: r.before, after: r.after }),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].before).toBeGreaterThan(seen[0].after);
  });
});

describe("the reduction prompt", () => {
  it("loads and states the floor and the shorter-or-original rule", () => {
    const prompt = loadReductionPrompt();
    expect(prompt).toBeTruthy();
    expect(prompt).toContain("KEEP, always and verbatim");
    expect(prompt).toContain("exit codes");
    expect(prompt).toContain("return the original unchanged");
  });
});

describe("formatReduction — the audit entry", () => {
  const r = {
    toolCallId: "chatcmpl-tool-abcdef123456",
    toolName: "read",
    before: 1000,
    after: 250,
    restored: 2,
    originalText: "ORIGINAL BODY",
    reducedText: "REDUCED BODY",
  };

  it("shows both texts in full so the trade can be judged, not just counted", () => {
    const out = formatReduction(r, "2026-08-11T21:00:00.000Z");
    expect(out).toContain("ORIGINAL BODY");
    expect(out).toContain("REDUCED BODY");
  });

  it("states the saving and names the floor when it fired", () => {
    const out = formatReduction(r, "2026-08-11T21:00:00.000Z");
    expect(out).toContain("1000 → 250 chars (−750, 75%)");
    expect(out).toContain("2 protected token(s) restored");
  });

  it("identifies the call by its distinguishing tail, not the shared prefix", () => {
    expect(formatReduction(r, "t")).toContain("abcdef123456".slice(-10));
  });
});

describe("reductionFilename — one file per reduction", () => {
  const r = {
    toolCallId: "chatcmpl-tool-abcdef123456", toolName: "read",
    before: 1, after: 1, restored: 0, originalText: "", reducedText: "",
  };

  it("sorts chronologically and names the tool and the distinguishing id tail", () => {
    const name = reductionFilename(r, "2026-08-11T21:44:19.123Z");
    expect(name.startsWith("2026-08-11T21-44-19-123Z")).toBe(true);
    expect(name).toContain("__read__");
    expect(name).toContain("abcdef123456".slice(-10));
    expect(name.endsWith(".md")).toBe(true);
  });

  it("produces a filesystem-safe name even for an awkward tool name", () => {
    const name = reductionFilename({ ...r, toolName: "we/ird name" }, "2026-08-11T21:44:19.123Z");
    expect(name).not.toContain("/");
    expect(name).not.toContain(" ");
  });

  it("gives two reductions in the same millisecond different files", () => {
    const a = reductionFilename(r, "2026-08-11T21:44:19.123Z");
    const b = reductionFilename({ ...r, toolCallId: "chatcmpl-tool-999888777" }, "2026-08-11T21:44:19.123Z");
    expect(a).not.toBe(b);
  });
});

describe("worthKeeping — a reduction must earn the risk of a wrong recap", () => {
  it("rejects a marginal saving even though it is shorter (the 537 → 519 case)", () => {
    expect(worthKeeping("x".repeat(537), "x".repeat(519))).toBe(false);
  });

  it("rejects a large absolute saving that is a small proportion", () => {
    expect(worthKeeping("x".repeat(10_000), "x".repeat(9_400))).toBe(false);
  });

  it("judges on proportion alone — one rule, no interacting second bar", () => {
    expect(worthKeeping("x".repeat(500), "x".repeat(250))).toBe(true);
    expect(worthKeeping("x".repeat(500), "x".repeat(400))).toBe(false);
  });

  it("accepts a reduction that is substantial both ways", () => {
    expect(worthKeeping("x".repeat(9_000), "x".repeat(900))).toBe(true);
  });
});

describe("deciding in place — no message may stay pending", () => {
  const settledTracker = () => {
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([]);
    return t;
  };
  const run = (opts: Partial<Parameters<typeof reduceContext>[1]> & { text: string; minInputChars?: number }) => {
    const verdicts: Array<{ kind: string; cause?: string }> = [];
    const cache = new Map<string, string | null>();
    const t = settledTracker();
    return reduceContext([toolResult("a", opts.text)], {
      config: { enabled: true, afterN: 1, minInputChars: opts.minInputChars ?? 0, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: opts.reduce ?? (async () => "tiny"),
      onVerdict: (_id, _tool, v) => verdicts.push(v as { kind: string; cause?: string }),
      cache,
    }).then((out) => ({ out, verdicts, cache }));
  };

  it("never sends a result below the size gate to the model", async () => {
    let calls = 0;
    const { verdicts } = await run({
      text: "x".repeat(500), minInputChars: 800,
      reduce: async () => { calls++; return "tiny"; },
    });
    expect(calls).toBe(0);
    expect(verdicts[0].kind).toBe("too-small");
  });

  it("keeps the original and records why when the trade is not worth it", async () => {
    const { out, verdicts } = await run({ text: "x".repeat(1_000), reduce: async () => "x".repeat(980) });
    expect((out[0] as any).content[0].text).toBe("x".repeat(1_000));
    expect(verdicts[0].kind).toBe("not-worth-it");
  });

  it("retries in place, then records the real cause instead of swallowing it", async () => {
    let calls = 0;
    const { verdicts } = await run({
      text: "x".repeat(2_000),
      reduce: async () => { calls++; throw new Error("gateway timeout"); },
    });
    expect(calls).toBe(2);
    expect(verdicts[0].kind).toBe("failed");
    expect(verdicts[0].cause).toContain("gateway timeout");
  });

  it("caches the verdict so no further reduction call is ever spent on that message", async () => {
    let calls = 0;
    const { cache } = await run({
      text: "x".repeat(2_000),
      reduce: async () => { calls++; throw new Error("boom"); },
    });
    expect(cache.get("a")).toBeNull();
    const t = settledTracker();
    await reduceContext([toolResult("a", "x".repeat(2_000))], {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: async () => { calls++; return "tiny"; },
      cache,
    });
    expect(calls).toBe(2); // the two in-place attempts only — never revisited
  });

  it("a verdicted message still reaches the main model in full", async () => {
    const original = "x".repeat(1_000);
    const { out } = await run({ text: original, reduce: async () => "x".repeat(995) });
    expect((out[0] as any).content[0].text).toBe(original);
  });
});

describe("the floor refuses rather than patches when the result is dense", () => {
  const dense = Array.from({ length: 40 }, (_, i) => `src/file${i}.ts:${i + 1}`).join("\n");

  it("returns null when restoring would bury the excerpt in bare references", () => {
    // The measured failure: ~150 `file:line` tokens restored with their lines stripped.
    expect(applyFloor(dense, "some files matched")).toBeNull();
  });

  it("still patches a handful of missing tokens", () => {
    const original = "failed with ENOENT at src/app.ts:42\n" + "filler ".repeat(200);
    expect(applyFloor(original, "It failed.")).toContain("ENOENT");
  });

  it("records too-protected as a verdict rather than emitting noise", async () => {
    const verdicts: Array<{ kind: string }> = [];
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([]);
    const out = await reduceContext([toolResult("a", dense)], {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: async () => "some files matched",
      onVerdict: (_i, _t, v) => verdicts.push(v),
    });
    expect(verdicts[0].kind).toBe("too-protected");
    expect((out[0] as any).content[0].text).toBe(dense);
  });
});

describe("attempt accounting", () => {
  it("reports an attempt only when the model is actually called", async () => {
    const attempts: string[] = [];
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([]);
    const cache = new Map<string, string | null>();
    const opts = {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id: string) => t.turnsBehind(id),
      reduce: async () => "tiny",
      onAttempt: (id: string) => attempts.push(id),
      cache,
    };
    await reduceContext([toolResult("a", "x".repeat(2_000))], opts);
    await reduceContext([toolResult("a", "x".repeat(2_000))], opts);
    expect(attempts).toEqual(["a"]); // second pass is served from cache, costs nothing
  });

  it("never attempts a result below the size gate", async () => {
    const attempts: string[] = [];
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([]);
    await reduceContext([toolResult("a", "x".repeat(900))], {
      config: { enabled: true, afterN: 1, minInputChars: DEFAULT_MIN_INPUT_CHARS, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: async () => "tiny",
      onAttempt: (id) => attempts.push(id),
    });
    expect(attempts).toEqual([]);
  });
});

describe("the pointer back to the original", () => {
  it("names the path and states that presence is not guaranteed", () => {
    const line = pointerLine(".pi/turn-reduce/s1/abc.original.txt", 8197);
    expect(line).toContain(".pi/turn-reduce/s1/abc.original.txt");
    expect(line).toContain("8197");
    expect(line).toMatch(/if still present/i);
  });

  it("derives the original's filename from the tool call, not from a timestamp", () => {
    // Stable across requests, so the pointer baked into the cached value stays valid.
    expect(originalFilename("chatcmpl-tool-abcdef123456")).toBe("cdef123456.original.txt");
  });

  it("appends the pointer to the kept reduction and persists the untouched original", async () => {
    const stored = new Map<string, string>();
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([]);
    const original = "y".repeat(3_000);
    const out = await reduceContext([toolResult("a", original)], {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: async () => "a short summary",
      pointer: (id, text) => {
        stored.set(originalFilename(id), text);
        return pointerLine(`dir/${originalFilename(id)}`, text.length);
      },
    });
    const text = (out[0] as any).content[0].text as string;
    expect(text).toContain("a short summary");
    expect(text).toContain("dir/a.original.txt");
    expect(stored.get("a.original.txt")).toBe(original); // byte for byte
  });

  it("bakes the pointer into the cached value so requests cannot differ", async () => {
    const cache = new Map<string, string | null>();
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([]);
    let pointerCalls = 0;
    const opts = {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id: string) => t.turnsBehind(id),
      reduce: async () => "summary",
      pointer: () => { pointerCalls++; return `[pointer ${pointerCalls}]`; },
      cache,
    };
    const first = await reduceContext([toolResult("a", "y".repeat(3_000))], opts);
    const second = await reduceContext([toolResult("a", "y".repeat(3_000))], opts);
    expect(pointerCalls).toBe(1);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("writes no original for a message that was verdicted", async () => {
    let stored = 0;
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([]);
    await reduceContext([toolResult("a", "y".repeat(3_000))], {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: async () => "y".repeat(2_990), // below the gain bar
      pointer: () => { stored++; return "[p]"; },
    });
    expect(stored).toBe(0);
  });
});

describe("compaction boundary — turn-reduce must not shred what compaction just protected", () => {
  const compactionEntry = (id: string, firstKeptEntryId: string) => ({
    id,
    type: "compaction" as const,
    summary: "summary",
    firstKeptEntryId,
    tokensBefore: 50000,
  });
  const messageEntry = (id: string) => ({ id, type: "message" as const });

  it("derives kept tool-call IDs from the original branch, excluding post-compaction material", async () => {
    const entries = [
      { id: "older", parentId: null, timestamp: "2026-08-12T00:00:00Z", type: "message", message: toolResult("older-tool", "older") },
      { id: "first-kept", parentId: "older", timestamp: "2026-08-12T00:00:01Z", type: "message", message: toolResult("kept-tool", "x".repeat(2000)) },
      { id: "model-change", parentId: "first-kept", timestamp: "2026-08-12T00:00:02Z", type: "model_change", provider: "test", modelId: "test-model" },
      { id: "also-kept", parentId: "model-change", timestamp: "2026-08-12T00:00:03Z", type: "message", message: toolResult("also-kept-tool", "y".repeat(2000)) },
      { id: "custom", parentId: "also-kept", timestamp: "2026-08-12T00:00:04Z", type: "custom", customType: "test" },
      { id: "compaction", parentId: "custom", timestamp: "2026-08-12T00:00:05Z", type: "compaction", summary: "summary", firstKeptEntryId: "first-kept", tokensBefore: 50000 },
      { id: "after", parentId: "compaction", timestamp: "2026-08-12T00:00:06Z", type: "message", message: toolResult("after-tool", "z".repeat(2000)) },
    ] as any[];

    const protectedToolCallIds = deriveProtectedToolCallIds(entries, entries[5]);
    expect(protectedToolCallIds).toEqual(new Set(["kept-tool", "also-kept-tool"]));

    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "kept-tool" }, { toolCallId: "also-kept-tool" }, { toolCallId: "after-tool" }]);
    t.endTurn([]);
    const reduced: string[] = [];
    const out = await reduceContext([
      toolResult("kept-tool", "x".repeat(2000)),
      toolResult("also-kept-tool", "y".repeat(2000)),
      toolResult("after-tool", "z".repeat(2000)),
    ], {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: async (_text, toolName) => { reduced.push(toolName); return "reduced"; },
      protectedToolCallIds,
    });

    expect(reduced).toEqual(["bash"]);
    expect((out[0] as any).content[0].text).toBe("x".repeat(2000));
    expect((out[1] as any).content[0].text).toBe("y".repeat(2000));
    expect((out[2] as any).content[0].text).toBe("reduced");
    expect(deriveProtectedToolCallIds(entries, null)).toEqual(new Set());
  });

  it("never reduces a tool result inside the compaction-protected range", async () => {
    // Fixture from measured case: session 019ff644, three tool results kept by compaction
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "tool-a" }]);
    t.endTurn([{ toolCallId: "tool-b" }]);
    t.endTurn([{ toolCallId: "tool-c" }]);
    // Extra turns so they are eligible by turnsBehind
    t.endTurn([]);
    t.endTurn([]);

    const sessionEntries = [
      compactionEntry("comp-entry", "entry-a"),
      messageEntry("entry-a"),
      messageEntry("entry-b"),
      messageEntry("entry-c"),
    ];

    const messages = [
      toolResult("tool-a", "x".repeat(50_590), "read"),
      toolResult("tool-b", "y".repeat(4423), "bash"),
      toolResult("tool-c", "z".repeat(97), "bash"),
    ];

    let reduceCalls = 0;
    const verdicts: Array<{ kind: string }> = [];
    // All three tool calls are inside the protected range
    const protectedToolCallIds = new Set(["tool-a", "tool-b", "tool-c"]);
    const out = await reduceContext(messages, {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: async () => { reduceCalls++; return "reduced"; },
      onVerdict: (_id, _tool, v) => verdicts.push(v),
      protectedToolCallIds,
    });

    // None of the three should have been reduced
    expect(reduceCalls).toBe(0);
    expect(verdicts.map((v) => v.kind)).toEqual([
      "compaction-protected",
      "compaction-protected",
      "compaction-protected",
    ]);
    // Messages must be unchanged
    expect((out[0] as any).content[0].text).toBe("x".repeat(50_590));
    expect((out[1] as any).content[0].text).toBe("y".repeat(4423));
    expect((out[2] as any).content[0].text).toBe("z".repeat(97));
  });

  it("still reduces a tool result created AFTER the compaction entry", async () => {
    // Post-compaction material must still reduce — this proves the range is closed,
    // not protecting all future material (which would cause unbounded context).
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "tool-old" }]);
    t.endTurn([{ toolCallId: "tool-new" }]);
    t.endTurn([]);
    t.endTurn([]);

    const messages = [
      toolResult("tool-old", "x".repeat(5000), "bash"),
      toolResult("tool-new", "y".repeat(5000), "bash"),
    ];

    // tool-old is inside the kept range; tool-new is post-compaction.
    const protectedToolCallIds = new Set(["tool-old"]);
    const verdicts: Array<{ kind: string }> = [];
    const reduced: string[] = [];
    const out = await reduceContext(messages, {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: async () => { reduced.push("reduced"); return "reduced"; },
      onVerdict: (_id, _tool, v) => verdicts.push(v),
      protectedToolCallIds,
    });

    // tool-old is protected, tool-new should reduce
    expect(verdicts.find((v) => v.kind === "compaction-protected")).toBeDefined();
    expect(reduced).toHaveLength(1);
    expect((out[0] as any).content[0].text).toBe("x".repeat(5000));
    expect((out[1] as any).content[0].text).toBe("reduced");
  });

  it("with no compaction present, behaviour is unchanged", async () => {
    const t = new TurnTracker();
    t.endTurn([{ toolCallId: "a" }]);
    t.endTurn([]);

    const messages = [toolResult("a", "x".repeat(2000))];
    const out = await reduceContext(messages, {
      config: { enabled: true, afterN: 1, minInputChars: 0, minGainRatio: 0.35 },
      turnsBehind: (id) => t.turnsBehind(id),
      reduce: async () => "reduced",
      protectedToolCallIds: new Set(),
    });

    expect((out[0] as any).content[0].text).toBe("reduced");
  });
});

describe("sessionDirName — newest session findable at a glance", () => {
  it("derives creation time from the UUIDv7 id, to the second", () => {
    // Verified against Pi's own session filename for this id.
    expect(sessionDirName("019ff268-97bb-719b-a8c9-20b75fb72732")).toBe(
      "2026-08-11T19-59-28Z-019ff268-97bb-719b-a8c9-20b75fb72732",
    );
  });

  it("sorts chronologically as plain strings", () => {
    const a = sessionDirName("019ff268-97bb-719b-a8c9-20b75fb72732");
    const b = sessionDirName("019ff279-0cbd-79ac-aa4e-cc6c514e8086");
    expect([b, a].sort()).toEqual([a, b]);
  });

  it("falls back to the bare id rather than inventing a timestamp", () => {
    expect(sessionDirName("unknown-session")).toBe("unknown-session");
    expect(sessionDirName("00000000-0000-0000-0000-000000000000")).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("refuses a hex id whose timestamp is implausible", () => {
    const farFuture = "0fffffff-ffff-7000-8000-000000000000";
    expect(sessionDirName(farFuture)).toBe(farFuture);
  });
});
