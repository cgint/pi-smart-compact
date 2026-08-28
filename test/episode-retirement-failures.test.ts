import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", () => ({ streamSimple: stream }));
import registerEpisodeRetirement, {
  CAPSULE_MAX_FIELD_CHARS,
  CAPSULE_MAX_ITEM_CHARS,
  CAPSULE_MAX_ITEMS,
  CAPSULE_MAX_JSON_CHARS,
  CONTINUATION_GOAL_MAX_CHARS,
  fingerprintEntry,
  selectLatestCompletedEpisodes,
  type SessionLikeEntry,
} from "../src/episode-retirement.js";

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PI_EPISODE_RETIREMENT_")) delete process.env[key];
  }
  stream.mockReset();
});
const msg = (id: string, role: string, text: string): SessionLikeEntry => ({
  type: "message",
  id,
  parentId: null,
  timestamp: id,
  message: { role, content: [{ type: "text", text }], timestamp: 1 },
});
const base = () => {
  const entries = [msg("u1", "user", "settled"), msg("a1", "assistant", "done"), msg("u2", "user", "active")];
  entries[1].parentId = "u1";
  entries[2].parentId = "a1";
  return entries;
};
const good = {
  objective: "o",
  findings: [],
  decisions: [],
  unresolved: [],
  nextStep: "n",
};
function harness(
  response: unknown = {
    stopReason: "stop",
    content: [{ type: "text", text: JSON.stringify(good) }],
    usage: { totalTokens: 1 },
  },
  setup: Record<string, unknown> = {},
) {
  const tools: any[] = [],
    appended: unknown[] = [],
    branch = base(),
    original = structuredClone(branch),
    handlers: Record<string, any> = {};
  process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
  const pi: any = {
    registerTool: (x: any) => tools.push(x),
    on: (name: string, handler: any) => {
      handlers[name] = handler;
    },
    appendEntry: (_: string, x: unknown) => appended.push(x),
  };
  registerEpisodeRetirement(pi);
  const model = { provider: "google", id: "gemini-3.7-flash" };
  stream.mockImplementation(() => ({ result: async () => response }));
  const registry = {
    find: () => model,
    getApiKeyAndHeaders: async () => ({ ok: true }),
    ...setup,
  };
  return {
    retire: tools.find((x) => x.name === "retire_episodes"),
    recall: tools.find((x) => x.name === "recall_episode"),
    handlers,
    appended,
    branch,
    original,
    calls: () => stream.mock.calls.length,
    ctx: {
      sessionManager: {
        getBranch: () => branch,
        getTree: () => [],
        getEntries: () => branch,
        getLeafId: () => branch.at(-1)?.id ?? null,
        buildContextEntries: () => branch.filter((entry) => entry.type === "message"),
      },
      modelRegistry: registry,
    },
  };
}
async function fails(
  h: ReturnType<typeof harness>,
  goal = "go",
  signal?: AbortSignal,
) {
  await expect(
    h.retire.execute(
      "x",
      { latestCompletedEpisodes: 1, continuationGoal: goal },
      signal,
      undefined,
      h.ctx,
    ),
  ).rejects.toThrow();
  expect(h.appended).toHaveLength(0);
  expect(h.branch).toEqual(h.original);
}

describe("episode retirement failures", () => {
  it.each([
    ["count", () => [msg("u", "user", "only active")], "insufficient completed episodes"],
    ["unsupported candidate", () => [{ ...msg("u1", "user", "selected"), message: { role: "user", content: [{ type: "image", data: "x" }], timestamp: 1 } as any }, msg("a1", "assistant", "done"), msg("u2", "user", "active")], "unsupported or nonstandard slot inside candidate"],
    ["assistant boundary", () => [msg("u1", "user", "selected"), msg("u2", "user", "active")], "candidate does not end in a completed assistant"],
    ["unmatched tool", () => [msg("u1", "user", "selected"), { ...msg("t", "toolResult", "orphan"), message: { role: "toolResult", toolCallId: "missing", content: [{ type: "text", text: "orphan" }], timestamp: 1 } as any }, msg("a1", "assistant", "done"), msg("u2", "user", "active")], "unmatched or out-of-order tool result"],
    ["open tool", () => [msg("u1", "user", "selected"), { ...msg("a1", "assistant", ""), message: { role: "assistant", content: [{ type: "toolCall", id: "open", name: "bash", arguments: {} }], timestamp: 1 } as any }, msg("a2", "assistant", "done"), msg("u2", "user", "active")], "open tool calls"],
  ])("selection reports the %s refusal reason", (_name, createEntries, reason) => {
    expect(selectLatestCompletedEpisodes(createEntries() as SessionLikeEntry[], 1).reason).toBe(reason);
  });

  it("a V1 parent rejects a non-adjacent repeated range before stream or append", async () => {
    const h = harness();
    h.branch.push({ type: "custom", customType: "episode-retirement", id: "r", parentId: "u2", timestamp: "r", data: { version: 1, kind: "episode-retirement", sourceEntryIds: ["u1", "a1"], sourceFingerprints: h.branch.slice(0, 2).map(fingerprintEntry), activeUserEntryId: "u2", capsule: good } });
    await expect(h.retire.execute("x", { latestCompletedEpisodes: 1, continuationGoal: "go" }, undefined, undefined, h.ctx)).rejects.toThrow("requires exactly 0 latest completed episode");
    expect(h.calls()).toBe(0);
    expect(h.appended).toHaveLength(0);
  });

  it("rejects a repeated range larger than its required N before model lookup or auth", async () => {
    const h = harness();
    h.branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u2", timestamp: "r1", data: { version: 1, kind: "episode-retirement", sourceEntryIds: ["u1", "a1"], sourceFingerprints: h.branch.slice(0, 2).map(fingerprintEntry), activeUserEntryId: "u2", capsule: good } });
    h.branch.push(msg("a2", "assistant", "second done"), msg("u3", "user", "active again"));
    h.branch.forEach((entry, index) => { entry.parentId = index ? h.branch[index - 1].id : null; });
    let finds = 0, auths = 0;
    h.ctx.modelRegistry.find = () => { finds++; return { provider: "google", id: "gemini-3.7-flash" }; };
    h.ctx.modelRegistry.getApiKeyAndHeaders = async () => { auths++; return { ok: true }; };
    await expect(h.retire.execute("x", { latestCompletedEpisodes: 2, continuationGoal: "go" }, undefined, undefined, h.ctx)).rejects.toThrow("requires exactly 1 latest completed episode");
    expect(finds).toBe(0); expect(auths).toBe(0); expect(h.calls()).toBe(0); expect(h.appended).toHaveLength(0);
  });

  it("uses raw cumulative slots for a V1 parent's generation-2 metrics", async () => {
    const h = harness();
    h.branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u2", timestamp: "r1", data: { version: 1, kind: "episode-retirement", sourceEntryIds: ["u1", "a1"], sourceFingerprints: h.branch.slice(0, 2).map(fingerprintEntry), activeUserEntryId: "u2", capsule: good } });
    h.branch.push(msg("a2", "assistant", "second done"), msg("u3", "user", "active again"));
    h.branch.forEach((entry, index) => { entry.parentId = index ? h.branch[index - 1].id : null; });
    await h.retire.execute("x", { latestCompletedEpisodes: 1, continuationGoal: "go" }, undefined, undefined, h.ctx);
    const receipt: any = h.appended[0];
    expect(receipt).toMatchObject({ version: 3, generation: 2, sourceEntryIds: ["u1", "a1", "u2", "a2"] });
    expect(receipt.replacementMetrics.completedEpisodeCount).toBe(2);
  });

  it("uses a V2 parent to create generation 2 with cumulative totals and hashes", async () => {
    const h = harness();
    const parent: any = { version: 2, kind: "episode-retirement", sourceEntryIds: ["u1", "a1"], sourceFingerprints: h.branch.slice(0, 2).map(fingerprintEntry), activeUserEntryId: "u2", capsule: good, provider: "google", model: "gemini-3.7-flash", reasoningEffort: "medium", promptVersion: "capsule-v2", usage: {} };
    h.branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u2", timestamp: "r1", data: parent }, msg("a2", "assistant", "second done"), msg("u3", "user", "active again"));
    h.branch.forEach((entry, index) => { entry.parentId = index ? h.branch[index - 1].id : null; });
    await h.retire.execute("x", { latestCompletedEpisodes: 1, continuationGoal: "go" }, undefined, undefined, h.ctx);
    const receipt: any = h.appended[0];
    expect(receipt).toMatchObject({ version: 3, generation: 2, sourceEntryIds: ["u1", "a1", "u2", "a2"], replacementMetrics: { completedEpisodeCount: 2, sourceMessageCount: 4 } });
    expect(receipt.parentReceiptFingerprint).toBe(createHash("sha256").update(JSON.stringify(parent)).digest("hex"));
    expect(receipt.priorCapsuleFingerprint).toBe(createHash("sha256").update(JSON.stringify(parent.capsule)).digest("hex"));
  });

  it.each([["blank goal", ""], [
    "oversize goal",
    "x".repeat(CONTINUATION_GOAL_MAX_CHARS + 1),
  ]])("pre-egress %s", async (_n, goal) => {
    const h = harness();
    await fails(h, goal);
    expect(h.calls()).toBe(0);
  });
  it.each([
    ["invalid effort", { env: "bad" }],
    ["whitespace model", { model: " google/x" }],
    ["unknown model", { setup: { find: () => undefined } }],
    ["auth false", {
      setup: { getApiKeyAndHeaders: async () => ({ ok: false }) },
    }],
  ])("pre-egress config %s", async (_n, c: any) => {
    if (c.env) process.env.PI_EPISODE_RETIREMENT_REASONING_EFFORT = c.env;
    if (c.model) process.env.PI_EPISODE_RETIREMENT_MODEL = c.model;
    const h = harness(undefined, c.setup);
    await fails(h);
    expect(h.calls()).toBe(0);
  });
  it("trailing whitespace model is pre-egress", async () => {
    process.env.PI_EPISODE_RETIREMENT_MODEL = "google/x ";
    const h = harness();
    await fails(h);
    expect(h.calls()).toBe(0);
  });
  it("rejected auth is pre-egress", async () => {
    const h = harness(undefined, {
      getApiKeyAndHeaders: async () => {
        throw new Error("auth");
      },
    });
    await fails(h);
    expect(h.calls()).toBe(0);
  });
  it("pre-abort does not stream", async () => {
    const c = new AbortController();
    c.abort();
    const h = harness();
    await fails(h, "go", c.signal);
    expect(h.calls()).toBe(0);
  });
  it.each([
    ["throw", undefined],
    ["reject", undefined],
    ["error", "error"],
    ["aborted", "aborted"],
    ["length", "length"],
    ["toolUse", "toolUse"],
    ["deferred", "deferred"],
    ["no text", "stop"],
    ["empty", "stop"],
  ])("post-egress %s", async (kind, stop) => {
    const response = kind === "no text"
      ? { stopReason: stop, content: [], usage: {} }
      : kind === "empty"
      ? { stopReason: stop, content: [{ type: "text", text: "" }], usage: {} }
      : {
        stopReason: stop,
        content: [{ type: "text", text: JSON.stringify(good) }],
        usage: {},
      };
    const h = harness(response);
    if (kind === "throw") {
      stream.mockImplementation(() => {
        throw new Error("x");
      });
    }
    if (kind === "reject") {
      stream.mockImplementation(() => ({
        result: async () => {
          throw new Error("x");
        },
      }));
    }
    await fails(h);
  });
  it("accepts a valid V2 receipt without replacement metrics", async () => {
    const h = harness();
    const event = { messages: h.branch.map((x) => x.message) };
    h.branch.push({
      type: "custom",
      customType: "episode-retirement",
      id: "r",
      parentId: "u2",
      timestamp: "r",
      data: {
        version: 2,
        kind: "episode-retirement",
        sourceEntryIds: ["u1", "a1"],
        sourceFingerprints: h.branch.slice(0, 2).map(fingerprintEntry),
        activeUserEntryId: "u2",
        capsule: good,
        provider: "google",
        model: "gemini-3.7-flash",
        reasoningEffort: "medium",
        promptVersion: "capsule-v2",
        usage: { totalTokens: 7, cost: { total: 0.02 } },
      },
    });
    expect((await h.handlers.context(event, h.ctx)).messages).toHaveLength(1);
  });
  it.each([
    ["malformed", { sourceMessageBytes: "2" }],
    ["additional key", { extra: 1 }],
    ["zero completed episode count", { completedEpisodeCount: 0 }],
    ["zero source message count", { sourceMessageCount: 0 }],
  ])("V2 receipt with %s replacement metrics fails open", async (_name, replacementMetrics) => {
    const h = harness();
    const event = { messages: h.branch.map((x) => x.message) };
    h.branch.push({
      type: "custom",
      customType: "episode-retirement",
      id: "r",
      parentId: "u2",
      timestamp: "r",
      data: {
        version: 2,
        kind: "episode-retirement",
        sourceEntryIds: ["u1", "a1"],
        sourceFingerprints: h.branch.slice(0, 2).map(fingerprintEntry),
        activeUserEntryId: "u2",
        capsule: good,
        provider: "google",
        model: "gemini-3.7-flash",
        reasoningEffort: "medium",
        promptVersion: "capsule-v2",
        usage: {},
        replacementMetrics: {
          completedEpisodeCount: 1,
          sourceMessageCount: 2,
          sourceMessageBytes: 3,
          capsuleTextBytes: 4,
          ...replacementMetrics,
        },
      },
    });
    expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
  });
  it("malformed V2 fails open while V1 projects", async () => {
    const h = harness();
    const event = { messages: h.branch.map((x) => x.message) };
    const receipt: any = {
      version: 1,
      kind: "episode-retirement",
      sourceEntryIds: ["u1", "a1"],
      sourceFingerprints: h.branch.slice(0, 2).map(fingerprintEntry),
      activeUserEntryId: "u2",
      capsule: good,
    };
    h.branch.push({
      type: "custom",
      customType: "episode-retirement",
      id: "r",
      parentId: "u2",
      timestamp: "r",
      data: receipt,
    });
    expect((await h.handlers.context(event, h.ctx)).messages).toHaveLength(1);
    for (
      const bad of [{ provider: "" }, { model: "" }, { promptVersion: "bad" }, {
        sourceFingerprints: ["bad", receipt.sourceFingerprints[1]],
      }, { sourceEntryIds: ["u1", "u1"] }]
    ) {
      h.branch[h.branch.length - 1].data = {
        ...receipt,
        version: 2,
        provider: "google",
        model: "x",
        reasoningEffort: "medium",
        promptVersion: "capsule-v2",
        usage: {},
        ...bad,
      };
      expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
    }
  });
  it.each([
    ["absent", () => undefined],
    ["changed", (h: any) => {
      h.branch[0].message!.content = [{ type: "text", text: "changed" }];
    }],
    ["outside", () => undefined],
  ])("recall refusal %s throws", async (kind, alter: any) => {
    const h = harness();
    const receipt: any = {
      version: 1,
      kind: "episode-retirement",
      sourceEntryIds: ["u1", "a1"],
      sourceFingerprints: h.branch.slice(0, 2).map(fingerprintEntry),
      activeUserEntryId: "u2",
      capsule: good,
    };
    if (kind !== "absent") {
      h.branch.push({
        type: "custom",
        customType: "episode-retirement",
        id: "r",
        parentId: "u2",
        timestamp: "r",
        data: receipt,
      });
    }
    alter(h);
    await expect(
      h.recall.execute(
        "x",
        { sourceEntryId: kind === "outside" ? "no" : undefined },
        undefined,
        undefined,
        h.ctx,
      ),
    ).rejects.toThrow();
  });
  it.each([
    ["resolved entry/message count mismatch", (h: any) => {
      h.ctx.sessionManager.buildContextEntries = () => h.branch.slice(0, 2);
    }],
    ["canonical entry/message parity mismatch", (h: any) => {
      h.ctx.sessionManager.getEntries = () => h.branch.slice(0, 2);
    }],
  ])("resolved context parity refuses before stream or append", async (_name, alter: any) => {
    const h = harness();
    alter(h);
    await fails(h);
    expect(h.calls()).toBe(0);
  });
  it.each([
    ["image", (h: any) => {
      h.branch[1].message!.content = [{ type: "image", data: "new" }];
      h.original = structuredClone(h.branch);
    }],
    ["custom_message", (h: any) => {
      h.branch.splice(1, 0, { type: "custom_message", id: "cm", parentId: "u1", timestamp: "cm" });
      h.ctx.sessionManager.buildContextEntries = () => h.branch;
      h.ctx.sessionManager.buildSessionContext = () => ({ messages: [
        h.branch[0].message,
        { role: "assistant", content: [{ type: "text", text: "custom" }], timestamp: 1 },
        h.branch[2].message,
        h.branch[3].message,
      ] });
      h.original = structuredClone(h.branch);
    }],
  ])("unsupported candidate %s refuses before stream or append", async (_name, alter: any) => {
    const h = harness();
    alter(h);
    await fails(h);
    expect(h.calls()).toBe(0);
  });
  it.each([
    ["invalid", "{"],
    ["fenced invalid", "\`\`\`json\n{\`\`\`"],
    [
      "missing",
      JSON.stringify({
        objective: "o",
        findings: [],
        decisions: [],
        unresolved: [],
      }),
    ],
    ["extra", JSON.stringify({ ...good, x: 1 })],
    ["blank objective", JSON.stringify({ ...good, objective: "" })],
    ["blank next", JSON.stringify({ ...good, nextStep: "" })],
    ["nonstring item", JSON.stringify({ ...good, findings: [1] })],
    [
      "field bound",
      JSON.stringify({
        ...good,
        objective: "x".repeat(CAPSULE_MAX_FIELD_CHARS + 1),
      }),
    ],
    [
      "item bound",
      JSON.stringify({
        ...good,
        findings: ["x".repeat(CAPSULE_MAX_ITEM_CHARS + 1)],
      }),
    ],
    [
      "item count",
      JSON.stringify({
        ...good,
        findings: Array(CAPSULE_MAX_ITEMS + 1).fill("x"),
      }),
    ],
    [
      "json bound",
      JSON.stringify({
        ...good,
        findings: ["x".repeat(CAPSULE_MAX_JSON_CHARS)],
      }),
    ],
  ])("invalid capsule %s", async (_n, text) => {
    const h = harness({
      stopReason: "stop",
      content: [{ type: "text", text }],
      usage: {},
    });
    await fails(h);
  });
});
