import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockStreamSimple } = vi.hoisted(() => ({ mockStreamSimple: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", () => ({ streamSimple: mockStreamSimple }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@earendil-works/pi-coding-agent")>(),
  keyHint: () => "to expand",
}));

afterEach(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith("PI_EPISODE_RETIREMENT_")) delete process.env[key];
  mockStreamSimple.mockReset();
});
import { buildSessionContext, convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  applyEpisodeRetirement,
  selectLatestCompletedEpisodes,
  type EpisodeRetirementReceipt,
  type SessionLikeEntry,
  fingerprintEntry,
} from "../src/episode-retirement.js";
import registerEpisodeRetirement from "../src/episode-retirement.js";

const user = (id: string, text: string): SessionLikeEntry => ({
  type: "message", id, parentId: null, timestamp: id + "-ts", message: { role: "user", content: [{ type: "text", text }], timestamp: 1 },
});
const assistant = (id: string, text: string, toolCallId?: string): SessionLikeEntry => ({
  type: "message", id, parentId: null, timestamp: id + "-ts", message: {
    role: "assistant", content: toolCallId ? [{ type: "toolCall", id: toolCallId, name: "bash", arguments: { command: "pwd" } }] : [{ type: "text", text }], timestamp: 1,
  },
});
const tool = (id: string, toolCallId: string): SessionLikeEntry => ({
  type: "message", id, parentId: null, timestamp: id + "-ts", message: { role: "toolResult", toolCallId, content: [{ type: "text", text: "/repo" }], isError: false, timestamp: 1 },
});

const completeMultiToolEpisode = [
  user("u1", "inspect repository"), assistant("a1", "", "call-1"), tool("t1", "call-1"),
  assistant("a2", "", "call-2"), tool("t2", "call-2"), assistant("a3", "finished"),
];
const activeEpisode = [user("u2", "continue from the investigation")];
const entries = [...completeMultiToolEpisode, ...activeEpisode];
const fingerprint = fingerprintEntry;
const capsule = { objective: "Understand the repository.", findings: ["Repository inspected."], decisions: [], unresolved: [], nextStep: "Use the findings." };
const publicSession = (branch: SessionLikeEntry[]) => {
  branch.forEach((entry, index) => { entry.parentId = index ? branch[index - 1].id : null; });
  return {
    getBranch: () => branch, getTree: () => [], getEntries: () => branch,
    getLeafId: () => branch.at(-1)?.id ?? null, buildContextEntries: () => branch,
  };
};
function anchoredRetire(rawRetire: any, inspect: any) {
  return { ...rawRetire, execute: async (id: string, params: any, signal: any, onUpdate: any, ctx: any) => {
    if (typeof params.latestCompletedEpisodes === "number") {
      const page = await inspect.execute("legacy-test-inspect", {}, undefined, undefined, ctx);
      params = { fromEpisodeInclusive: `ep-${params.latestCompletedEpisodes}`, inspectionWitness: page.details.inspectionWitness, continuationGoal: params.continuationGoal, pinnedWorkingState: "legacy test pin" };
    }
    return rawRetire.execute(id, params, signal, onUpdate, ctx);
  } };
}

const extensionHarness = (manager: SessionManager) => {
  const tools: any[] = [], handlers: Record<string, any> = {}, appended: unknown[] = []; let finds = 0, auths = 0;
  const pi: any = {
    registerTool: (tool: any) => tools.push(tool),
    on: (name: string, handler: any) => { handlers[name] = handler; },
    appendEntry: (_type: string, data: unknown) => {
      appended.push(data);
      manager.appendCustomEntry("episode-retirement", data);
    },
  };
  process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
  mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(capsule) }], usage: {} }) });
  registerEpisodeRetirement(pi);
  const inspect = tools.find((tool) => tool.name === "inspect_episode_retirement");
  const rawRetire = tools.find((tool) => tool.name === "retire_episodes");
  const retire = anchoredRetire(rawRetire, inspect);
  return {
    retire, inspect, recall: tools.find((tool) => tool.name === "recall_episode"), handlers, appended,
    streams: () => mockStreamSimple.mock.calls.length, finds: () => finds, auths: () => auths,
    ctx: { sessionManager: manager, modelRegistry: { find: () => { finds++; return { provider: "google", id: "gemini-3.7-flash" }; }, getApiKeyAndHeaders: async () => { auths++; return { ok: true }; } } },
  };
};

async function inspectAnchor(h: any, id = "ep-1", overrides: Record<string, unknown> = {}) {
  const inspected = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
  expect(inspected.details.candidates.find((candidate: any) => candidate.id === id)).toBeDefined();
  return {
    fromEpisodeInclusive: id,
    inspectionWitness: inspected.details.inspectionWitness,
    continuationGoal: "continue safely",
    pinnedWorkingState: "verified finding\nunresolved dependency",
    ...overrides,
  };
}
function retirementCounts(h: any) {
  return { finds: h.finds(), auths: h.auths(), streams: h.streams(), appends: h.appended.length };
}
async function anchoredRelationFixture() {
  const manager = SessionManager.inMemory();
  for (const entry of [user("ignored", "A request"), assistant("ignored", "A done"), user("ignored", "B request"), assistant("ignored", "B done"), user("ignored", "C active")]) manager.appendMessage(entry.message as any);
  const h = extensionHarness(manager);
  await h.retire.execute("parent", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
  manager.appendMessage(assistant("ignored", "C done").message as any);
  manager.appendMessage(user("ignored", "D active").message as any);
  return { manager, h };
}
async function futureV5Fixture() {
  const manager = SessionManager.inMemory();
  manager.appendMessage(user("ignored", "settled").message as any); manager.appendMessage(assistant("ignored", "done").message as any); manager.appendMessage(user("ignored", "active").message as any);
  const source = manager.getEntries().slice(0, 2) as SessionLikeEntry[];
  const receipt: any = { version: 5, kind: "episode-retirement", sourceEntryIds: source.map((entry) => entry.id), sourceFingerprints: source.map(fingerprintEntry), activeUserEntryId: manager.getEntries()[2].id, capsule, replacementMetrics: { completedEpisodeCount: 1, sourceMessageCount: 2, sourceMessageBytes: Buffer.byteLength(JSON.stringify(source.map((entry) => entry.message)), "utf8"), capsuleTextBytes: 1 }, provider: "google", model: "gemini-3.7-flash", reasoningEffort: "medium", promptVersion: "capsule-v5", usage: {}, mode: "initial", pinnedWorkingState: "valid pin" };
  manager.appendCustomEntry("episode-retirement", receipt);
  return { manager, h: extensionHarness(manager), receipt };
}

async function generation2Fixture() {
  const manager = SessionManager.inMemory();
  manager.appendMessage(user("ignored", "prefix").message as any);
  manager.appendMessage(assistant("ignored", "prefix done").message as any);
  manager.appendMessage(user("ignored", "first").message as any);
  manager.appendMessage(assistant("ignored", "first done").message as any);
  manager.appendMessage(user("ignored", "second").message as any);
  const h = extensionHarness(manager);
  await h.retire.execute("v2", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
  manager.appendMessage(assistant("ignored", "second done").message as any);
  manager.appendMessage(user("ignored", "third").message as any);
  return { manager, h };
}

async function latestV3Fixture() {
  const { manager, h } = await generation2Fixture();
  await h.retire.execute("v3", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
  const receiptEntry = manager.getEntries().findLast((entry: any) => entry.customType === "episode-retirement") as any;
  return { manager, h, receiptEntry };
}

async function latestV4Fixture() {
  const branch = [user("uA", "earlier"), assistant("aA", "earlier done"), user("uB", "parent"), assistant("aB", "parent done"), user("u1", "first active")] as SessionLikeEntry[];
  const tools: any[] = [], appended: any[] = [], handlers: Record<string, any> = {};
  let finds = 0, auths = 0;
  const pi: any = {
    registerTool: (tool: any) => tools.push(tool),
    on: (name: string, handler: any) => { handlers[name] = handler; },
    appendEntry: (_: string, data: any) => { appended.push(data); branch.push({ type: "custom", customType: "episode-retirement", id: `r${appended.length}`, parentId: branch.at(-1)!.id, timestamp: "r", data }); publicSession(branch); },
  };
  process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
  mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(capsule) }], usage: {} }) });
  registerEpisodeRetirement(pi);
  const h: any = {
    retire: anchoredRetire(tools.find((tool) => tool.name === "retire_episodes"), tools.find((tool) => tool.name === "inspect_episode_retirement")), inspect: tools.find((tool) => tool.name === "inspect_episode_retirement"), recall: tools.find((tool) => tool.name === "recall_episode"), handlers, appended,
    streams: () => mockStreamSimple.mock.calls.length, finds: () => finds, auths: () => auths,
    ctx: { sessionManager: publicSession(branch), modelRegistry: { find: () => { finds++; return { provider: "google", id: "gemini-3.7-flash" }; }, getApiKeyAndHeaders: async () => { auths++; return { ok: true }; } } },
  };
  await h.retire.execute("v2", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
  branch.push(assistant("a1", "first done"), user("u2", "second active")); h.ctx.sessionManager = publicSession(branch);
  await h.retire.execute("v4", { latestCompletedEpisodes: 3, continuationGoal: "continue" }, undefined, undefined, h.ctx);
  return { branch, h, receiptEntry: branch.findLast((entry: any) => entry.customType === "episode-retirement") as any };
}

describe("episode retirement", () => {
  it("inspects forward, recompose, and deepen candidates without source egress or side effects", async () => {
    const manager = SessionManager.inMemory();
    for (const entry of [user("ignored", "A request"), assistant("ignored", "A done"), user("ignored", "B request"), assistant("ignored", "B done"), user("ignored", "C active")]) manager.appendMessage(entry.message as any);
    const h = extensionHarness(manager);
    await h.retire.execute("parent", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
    manager.appendMessage(assistant("ignored", "C done").message as any);
    manager.appendMessage(user("ignored", "D active").message as any);
    const before = { appended: h.appended.length, streams: h.streams(), finds: h.finds(), auths: h.auths() };
    const result = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    expect(result.details).toMatchObject({
      evaluatedCount: 3, acceptedCount: 3, refusedCount: 0,
      relationFrontier: {
        initial: null,
        forward: { acceptedCount: 1, minCount: 1, maxCount: 1 },
        recompose: { acceptedCount: 1, minCount: 2, maxCount: 2 },
        deepen: { acceptedCount: 1, minCount: 3, maxCount: 3 },
      },
      largestSafe: { count: 3, relation: "deepen", earlierAddedEpisodeCount: 1, earlierAddedMessageCount: 2, laterAddedEpisodeCount: 1, laterAddedMessageCount: 2, cumulativeEpisodeCount: 3, cumulativeMessageCount: 6 },
    });
    expect({ appended: h.appended.length, streams: h.streams(), finds: h.finds(), auths: h.auths() }).toEqual(before);
    expect(result.details.candidates.map((candidate: any) => candidate.id)).toEqual(["ep-1", "ep-2", "ep-3"]);
    expect(result.details.candidates.map((candidate: any) => candidate.userPrompt)).toEqual(["C active", "B request", "A request"]);
  });

  it.each([
    ["model unavailable", (f: any) => { f.h.ctx.modelRegistry.find = () => undefined; }, false],
    ["auth failure", (f: any) => { f.h.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false }); }, true],
    ["pre-abort", () => {}, false, true],
    ["stream throw", () => { mockStreamSimple.mockImplementation(() => { throw new Error("stream"); }); }, true],
    ["non-stop", () => { mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "length", content: [], usage: {} }) }); }, true],
    ["invalid JSON", () => { mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: "{" }], usage: {} }) }); }, true],
    ["invalid capsule shape", () => { mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ ...capsule, extra: true }) }], usage: {} }) }); }, true],
    ["invalid capsule bound", () => { mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ ...capsule, objective: "x".repeat(2_001) }) }], usage: {} }) }); }, true],
  ])("generation-2 %s appends nothing and preserves V2 projection", async (_name: any, alter: any, authExpected: boolean, abort = false) => {
    const f = await generation2Fixture();
    alter(f);
    let auths = 0;
    const originalAuth = f.h.ctx.modelRegistry.getApiKeyAndHeaders;
    f.h.ctx.modelRegistry.getApiKeyAndHeaders = async () => { auths++; return originalAuth(); };
    const event = { messages: f.manager.buildSessionContext().messages };
    const before = await f.h.handlers.context(event, f.h.ctx);
    const parent = f.h.appended[0]; const parentBytes = JSON.stringify(parent);
    const controller = new AbortController(); if (abort) controller.abort();
    await expect(f.h.retire.execute("v3", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, controller.signal, undefined, f.h.ctx)).rejects.toThrow();
    const after = await f.h.handlers.context(event, f.h.ctx);
    expect(f.h.appended).toHaveLength(1); expect(f.h.appended[0]).toBe(parent); expect(JSON.stringify(parent)).toBe(parentBytes);
    expect(after.messages).toEqual(before.messages); expect(after.messages[0]).toBe(before.messages[0]); expect(after.messages[1]).toBe(before.messages[1]);
    expect(auths > 0).toBe(authExpected);
  });

  it("selects and projects one complete multi-tool episode before the active episode", () => {
    const selection = selectLatestCompletedEpisodes(entries, 1);
    expect(selection).toMatchObject({ sourceEntryIds: ["u1", "a1", "t1", "a2", "t2", "a3"], activeUserEntryId: "u2" });
    const receipt: EpisodeRetirementReceipt = {
      version: 1, kind: "episode-retirement", sourceEntryIds: selection!.sourceEntryIds,
      sourceFingerprints: completeMultiToolEpisode.map(fingerprint), activeUserEntryId: "u2",
      capsule,
    };
    const projected = applyEpisodeRetirement(entries, receipt);
    expect(projected.applied).toBe(true);
    if (!projected.applied) throw new Error(projected.reason);
    const llm = convertToLlm(projected.messages as Parameters<typeof convertToLlm>[0]);
    expect(llm.map((message) => message.role)).toEqual(["user"]);
    const projectedText = (llm[0].content[0] as { text: string }).text + (llm[0].content[1] as { text: string }).text;
    expect(projectedText).toContain("CONTINUATION CAPSULE");
    expect(projectedText).toContain("continue from the investigation");
  });

  it("prepends the capsule into supported string user content", () => {
    const stringEntries = [...completeMultiToolEpisode, { ...user("u-string", "unused"), message: { role: "user", content: "string active prompt", timestamp: 1 } }];
    const selection = selectLatestCompletedEpisodes(stringEntries, 1)!;
    const receipt: EpisodeRetirementReceipt = { version: 1, kind: "episode-retirement", sourceEntryIds: selection.sourceEntryIds, sourceFingerprints: completeMultiToolEpisode.map(fingerprint), activeUserEntryId: "u-string", capsule };
    const projected = applyEpisodeRetirement(stringEntries, receipt);
    if (!projected.applied) throw new Error(projected.reason);
    expect(projected.messages).toHaveLength(1);
    expect(projected.messages[0].content).toContain("CONTINUATION CAPSULE");
    expect(projected.messages[0].content).toContain("string active prompt");
  });

  it("fails open for a fingerprint mismatch and leaves provider messages unchanged", () => {
    const receipt: EpisodeRetirementReceipt = {
      version: 1, kind: "episode-retirement", sourceEntryIds: completeMultiToolEpisode.map((entry) => entry.id),
      sourceFingerprints: completeMultiToolEpisode.map(fingerprint), activeUserEntryId: "u2",
      capsule,
    };
    const changed = structuredClone(entries);
    ((changed[2].message!.content as Array<{ text: string }>)[0]).text = "different output";
    expect(applyEpisodeRetirement(changed, receipt)).toEqual({ applied: false, reason: "fingerprint mismatch" });
  });

  it("reapplies a persisted receipt after resume", () => {
    const selection = selectLatestCompletedEpisodes(entries, 1)!;
    const receipt: EpisodeRetirementReceipt = {
      version: 1, kind: "episode-retirement", sourceEntryIds: selection.sourceEntryIds,
      sourceFingerprints: completeMultiToolEpisode.map(fingerprint), activeUserEntryId: "u2",
      capsule,
    };
    expect(applyEpisodeRetirement(structuredClone(entries), JSON.parse(JSON.stringify(receipt))).applied).toBe(true);
  });

  it("is off by default, then persists a receipt and mechanically recalls originals", async () => {
    const tools: any[] = [];
    const handlers: Record<string, any> = {};
    const persisted: unknown[] = [];
    const branch: SessionLikeEntry[] = structuredClone(entries);
    const pi: any = {
      registerTool: (tool: any) => tools.push(tool), on: (name: string, handler: any) => { handlers[name] = handler; },
      appendEntry: (_type: string, data: unknown) => { persisted.push(data); branch.push({ type: "custom", customType: "episode-retirement", id: "receipt", parentId: "u2", timestamp: "receipt-ts", data }); },
    };
    delete process.env.PI_EPISODE_RETIREMENT_ENABLED;
    registerEpisodeRetirement(pi);
    expect(tools).toHaveLength(0);

    process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
    registerEpisodeRetirement(pi);
    const retire = anchoredRetire(tools.find((tool) => tool.name === "retire_episodes"), tools.find((tool) => tool.name === "inspect_episode_retirement"));
    const recall = tools.find((tool) => tool.name === "recall_episode");
    const model = { provider: "google", id: "gemini-3.7-flash" };
    mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(capsule) }], usage: { totalTokens: 1 } }) });
    const ctx: any = { sessionManager: publicSession(branch), modelRegistry: { find: () => model, getApiKeyAndHeaders: async () => ({ ok: true }) } };
    const accepted = await retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue safely" }, undefined, undefined, ctx);
    expect(accepted.isError).toBeUndefined();
    expect(persisted).toHaveLength(1);
    const hookResult = await handlers.context({ type: "context", messages: entries.map((entry) => entry.message) }, ctx);
    expect(hookResult.messages).toHaveLength(1);
    expect(hookResult.messages[0].content[0].text).toContain("CONTINUATION CAPSULE");
    const mismatchedEvent = { type: "context", messages: structuredClone(entries.map((entry) => entry.message)) };
    const firstContent = mismatchedEvent.messages[0]!.content as Array<{ text: string }>;
    firstContent[0]!.text = "changed before retirement";
    expect(await handlers.context(mismatchedEvent, ctx)).toBeUndefined();
    const inventory = await recall.execute("call", {}, undefined, undefined, ctx);
    expect(inventory.isError).toBeUndefined();
    expect(inventory.content[0].text).toContain('"id": "t1"');
    const recalled = await recall.execute("call", { sourceEntryId: "t1" }, undefined, undefined, ctx);
    expect(recalled.isError).toBeUndefined();
    expect(recalled.content[0].text).toContain('"id": "t1"');
    delete process.env.PI_EPISODE_RETIREMENT_ENABLED;
  });

  it("cumulatively retires a three-generation trace without nesting capsules", async () => {
    const prefix = [user("u0", "before"), assistant("a0", "before done")];
    const branch = [...prefix, user("u1", "first"), assistant("a1", "first done"), user("u2", "second")];
    const tools: any[] = [], appended: any[] = [], handlers: Record<string, any> = {};
    const pi: any = {
      registerTool: (tool: any) => tools.push(tool), on: (name: string, handler: any) => { handlers[name] = handler; },
      appendEntry: (_type: string, data: any) => { appended.push(data); branch.push({ type: "custom", customType: "episode-retirement", id: `r${appended.length}`, parentId: branch.at(-1)!.id, timestamp: "r", data }); },
    };
    process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
    mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(capsule) }], usage: {} }) });
    registerEpisodeRetirement(pi);
    const retire = anchoredRetire(tools.find((tool) => tool.name === "retire_episodes"), tools.find((tool) => tool.name === "inspect_episode_retirement"));
    const recall = tools.find((tool) => tool.name === "recall_episode");
    const rawManager = publicSession(branch);
    const ctx: any = { sessionManager: { ...rawManager, getEntries: () => branch, buildContextEntries: () => branch.filter((entry) => entry.type === "message"), getLeafId: () => branch.at(-1)?.id ?? null }, modelRegistry: { find: () => ({ provider: "google", id: "gemini-3.7-flash" }), getApiKeyAndHeaders: async () => ({ ok: true }) } };
    await retire.execute("one", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
    branch.push(assistant("a2", "second done"), user("u3", "third"));
    publicSession(branch);
    await retire.execute("two", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
    branch.push(assistant("a3", "third done"), user("u4", "active"));
    publicSession(branch);
    await retire.execute("three", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
    expect(appended.map((receipt) => receipt.version)).toEqual([5, 5, 5]);
    expect(appended[2].sourceEntryIds).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
    expect(appended[2].newlyCompletedEpisodeEntries.map((entry: any) => entry.id)).toEqual(["u3", "a3"]);
    expect(appended[2].parentReceiptEntryId).toBe("r2");
    const request = mockStreamSimple.mock.calls[2][1].messages[0].content[0].text;
    const payload = JSON.parse(request.slice(request.indexOf("{")));
    expect(payload.priorContinuationCapsule).toEqual(appended[1].capsule);
    expect(payload.newlyCompletedEpisodeEntries.map((entry: any) => entry.id)).toEqual(["u3", "a3"]);
    expect(payload.activeRequest.content[0].text).toBe("active");
    expect(request).not.toContain("[CONTINUATION CAPSULE — episode retirement]");
    const event = branch.filter((entry) => entry.type === "message").map((entry) => entry.message);
    const projected = await handlers.context({ messages: event }, ctx);
    expect(projected.messages).toHaveLength(3);
    expect(projected.messages[0]).toBe(event[0]);
    expect(projected.messages[1]).toBe(event[1]);
    expect(JSON.stringify(projected.messages)).toContain("u1, a1, u2, a2, u3, a3");
    expect((JSON.stringify(projected.messages).match(/CONTINUATION CAPSULE/g) ?? [])).toHaveLength(1);
    const inventory = await recall.execute("inventory", {}, undefined, undefined, ctx);
    expect(inventory.details.sourceEntryIds).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
    expect(JSON.parse(inventory.content[0].text).map((item: any) => item.id)).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
    for (const id of ["u1", "a3"]) {
      const recalled = await recall.execute("recall", { sourceEntryId: id }, undefined, undefined, ctx);
      const original = branch.find((entry) => entry.id === id)!;
      expect(JSON.parse(recalled.content[0].text)).toEqual({ id, message: original.message });
      expect(fingerprintEntry(original)).toBe(appended[2].sourceFingerprints[appended[2].sourceEntryIds.indexOf(id)]);
    }
    const theme = { fg: (_color: string, text: string) => text };
    const compact = retire.renderResult({ content: [], details: appended[2] }, { expanded: false, isPartial: false }, theme, { isError: false }) as any;
    const expanded = retire.renderResult({ content: [], details: appended[2] }, { expanded: true, isPartial: false }, theme, { isError: false }) as any;
    const r = appended[2];
    const expectedCompact = `generation ${r.generation}; this retirement: ${r.deltaMetrics.newlyCompletedEpisodeCount} episode(s), ${r.deltaMetrics.newlyCompletedMessageCount} message(s), ${r.deltaMetrics.newlyCompletedSourceBytes} B source → ${r.deltaMetrics.newCapsuleTextBytes} B capsule-text; cumulative ${r.replacementMetrics.completedEpisodeCount} completed episode(s), ${r.replacementMetrics.sourceMessageCount} source message(s), ${r.replacementMetrics.sourceMessageBytes} B serialized source → ${r.replacementMetrics.capsuleTextBytes} B capsule-text; ${r.provider}/${r.model} (${r.reasoningEffort})`;
    expect(compact.text).toBe(`${expectedCompact} (to expand)`);
    const exactCapsule = "[CONTINUATION CAPSULE — episode retirement]\nObjective: Understand the repository.\nFindings:\n- Repository inspected.\nNext step: Use the findings.\nOriginal source entry IDs (recover with recall_episode): u1, a1, u2, a2, u3, a3";
    expect(expanded.text).toBe(`${expectedCompact}\n\nProvider continuation (exact text; not rewritten JSONL history):\n[PINNED WORKING STATE]\nlegacy test pin\n[/PINNED STATE]\n\n${exactCapsule}\n\nProvenance: u1, a1, u2, a2, u3, a3`);
  });

  it.each([
    ["missing parent entry", (f: any) => { f.receiptEntry.data.parentReceiptEntryId = "missing"; }],
    ["parent receipt ID", (f: any) => { f.receiptEntry.data.parentReceiptEntryId = "wrong"; }],
    ["parent receipt hash", (f: any) => { f.receiptEntry.data.parentReceiptFingerprint = "0".repeat(64); }],
    ["prior capsule hash", (f: any) => { f.receiptEntry.data.priorCapsuleFingerprint = "0".repeat(64); }],
    ["generation", (f: any) => { f.receiptEntry.data.generation++; }],
    ["cumulative ID", (f: any) => { f.receiptEntry.data.sourceEntryIds[0] = "wrong"; }],
    ["cumulative fingerprint", (f: any) => { f.receiptEntry.data.sourceFingerprints[0] = "0".repeat(64); }],
    ["noncontiguous IDs", (f: any) => { f.receiptEntry.data.sourceEntryIds.splice(1, 1); f.receiptEntry.data.sourceFingerprints.splice(1, 1); }],
    ["new item ID", (f: any) => { f.receiptEntry.data.newlyCompletedEpisodeEntries[0].id = "wrong"; }],
    ["new item hash", (f: any) => { f.receiptEntry.data.newlyCompletedEpisodeEntries[0].fingerprint = "0".repeat(64); }],
    ["new item extra key", (f: any) => { f.receiptEntry.data.newlyCompletedEpisodeEntries[0].extra = true; }],
    ["duplicate new item", (f: any) => { f.receiptEntry.data.newlyCompletedEpisodeEntries.push(structuredClone(f.receiptEntry.data.newlyCompletedEpisodeEntries[0])); }],
    ...["completedEpisodeCount", "sourceMessageCount", "sourceMessageBytes", "capsuleTextBytes"].map((key) => [`replacement metric ${key}`, (f: any) => { f.receiptEntry.data.replacementMetrics[key]++; }]),
    ...["newlyCompletedEpisodeCount", "newlyCompletedMessageCount", "newlyCompletedSourceBytes", "cumulativeMessageCount", "cumulativeSourceBytes", "priorCapsuleTextBytes", "newCapsuleTextBytes"].map((key) => [`delta metric ${key}`, (f: any) => { f.receiptEntry.data.deltaMetrics[key]++; }]),
    ["delta extra key", (f: any) => { f.receiptEntry.data.deltaMetrics.extra = true; }],
    ["incomplete tool-balanced delta", (f: any) => {
      const receipt = f.receiptEntry.data;
      const raw = f.manager.getEntries().find((entry: any) => entry.id === receipt.newlyCompletedEpisodeEntries[1].id) as any;
      raw.message.content = [{ type: "toolCall", id: "open", name: "bash", arguments: {} }];
      const all = receipt.sourceEntryIds.map((id: string) => f.manager.getEntries().find((entry: any) => entry.id === id));
      const delta = all.slice(-2);
      receipt.sourceFingerprints[receipt.sourceFingerprints.length - 1] = fingerprintEntry(raw);
      receipt.newlyCompletedEpisodeEntries[1].fingerprint = fingerprintEntry(raw);
      receipt.replacementMetrics.sourceMessageBytes = Buffer.byteLength(JSON.stringify(all.map((entry: any) => entry.message)));
      receipt.deltaMetrics.newlyCompletedSourceBytes = Buffer.byteLength(JSON.stringify(delta.map((entry: any) => entry.message)));
      receipt.deltaMetrics.cumulativeSourceBytes = receipt.replacementMetrics.sourceMessageBytes;
    }],
  ])("fails closed for V3 tamper: %s", async (_name: any, mutate: any) => {
    const fixture = await latestV3Fixture();
    mutate(fixture);
    const event = { messages: fixture.manager.buildSessionContext().messages };
    expect(await fixture.h.handlers.context(event, fixture.h.ctx)).toBeUndefined();
    const before = fixture.h.streams();
    await expect(fixture.h.retire.execute("again", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, fixture.h.ctx)).rejects.toThrow("malformed");
    expect(fixture.h.streams()).toBe(before);
    expect(fixture.h.appended).toHaveLength(2);
    await expect(fixture.h.recall.execute("recall", {}, undefined, undefined, fixture.h.ctx)).rejects.toThrow();
  });

  it.each([
    ["parent id", (f: any) => { f.receiptEntry.data.parentReceiptEntryId = "missing"; }],
    ["parent hash", (f: any) => { f.receiptEntry.data.parentReceiptFingerprint = "0".repeat(64); }],
    ["prior capsule hash", (f: any) => { f.receiptEntry.data.priorCapsuleFingerprint = "0".repeat(64); }],
    ["generation", (f: any) => { f.receiptEntry.data.generation++; }],
    ["cumulative id", (f: any) => { f.receiptEntry.data.sourceEntryIds[0] = "missing"; }],
    ["cumulative fingerprint", (f: any) => { f.receiptEntry.data.sourceFingerprints[0] = "0".repeat(64); }],
    ["before id", (f: any) => { f.receiptEntry.data.newlyIncorporatedBeforeParentEntries[0].id = "missing"; }],
    ["before fingerprint", (f: any) => { f.receiptEntry.data.newlyIncorporatedBeforeParentEntries[0].fingerprint = "0".repeat(64); }],
    ["before extra", (f: any) => { f.receiptEntry.data.newlyIncorporatedBeforeParentEntries[0].extra = true; }],
    ["before duplicate", (f: any) => { f.receiptEntry.data.newlyIncorporatedBeforeParentEntries.push(structuredClone(f.receiptEntry.data.newlyIncorporatedBeforeParentEntries[0])); }],
    ["after id", (f: any) => { f.receiptEntry.data.newlyCompletedAfterParentEntries[0].id = "missing"; }],
    ["after fingerprint", (f: any) => { f.receiptEntry.data.newlyCompletedAfterParentEntries[0].fingerprint = "0".repeat(64); }],
    ["after extra", (f: any) => { f.receiptEntry.data.newlyCompletedAfterParentEntries[0].extra = true; }],
    ["after duplicate", (f: any) => { f.receiptEntry.data.newlyCompletedAfterParentEntries.push(structuredClone(f.receiptEntry.data.newlyCompletedAfterParentEntries[0])); }],
    ["empty after", (f: any) => { f.receiptEntry.data.newlyCompletedAfterParentEntries = []; }],
    ...["completedEpisodeCount", "sourceMessageCount", "sourceMessageBytes", "capsuleTextBytes"].map((key) => [`replacement ${key}`, (f: any) => { f.receiptEntry.data.replacementMetrics[key]++; }]),
    ...["earlierEpisodeCount", "earlierMessageCount", "earlierSourceBytes", "laterEpisodeCount", "laterMessageCount", "laterSourceBytes", "cumulativeMessageCount", "cumulativeSourceBytes", "priorCapsuleTextBytes", "newCapsuleTextBytes"].map((key) => [`composition ${key}`, (f: any) => { f.receiptEntry.data.compositionMetrics[key]++; }]),
    ["composition extra", (f: any) => { f.receiptEntry.data.compositionMetrics.extra = true; }],
    ["top-level extra", (f: any) => { f.receiptEntry.data.extra = true; }],
  ])("fails closed for V4 tamper: %s", async (_name: any, mutate: any) => {
    const fixture = await latestV4Fixture();
    mutate(fixture);
    const event = { messages: fixture.branch.filter((entry) => entry.type === "message").map((entry) => entry.message) };
    expect(await fixture.h.handlers.context(event, fixture.h.ctx)).toBeUndefined();
    const before = { streams: fixture.h.streams(), finds: fixture.h.finds(), auths: fixture.h.auths() };
    await expect(fixture.h.retire.execute("again", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, fixture.h.ctx)).rejects.toThrow("malformed");
    expect({ streams: fixture.h.streams(), finds: fixture.h.finds(), auths: fixture.h.auths() }).toEqual(before);
    expect(fixture.h.appended).toHaveLength(2);
    await expect(fixture.h.recall.execute("recall", {}, undefined, undefined, fixture.h.ctx)).rejects.toThrow();
  });

  it.each(["after", "before"])("fails closed for a recomputed open-tool %s interval", async (interval) => {
    const fixture = await latestV4Fixture();
    const receipt = fixture.receiptEntry.data;
    const id = interval === "after" ? "a1" : "aA";
    const raw = fixture.branch.find((entry: any) => entry.id === id)!;
    raw.message!.content = [{ type: "toolCall", id: "open", name: "bash", arguments: {} }];
    receipt.sourceFingerprints = receipt.sourceEntryIds.map((sourceId: string) => fingerprintEntry(fixture.branch.find((entry: any) => entry.id === sourceId)!));
    const before = fixture.branch.filter((entry: any) => ["uA", "aA"].includes(entry.id));
    const after = fixture.branch.filter((entry: any) => ["u1", "a1"].includes(entry.id));
    const source = receipt.sourceEntryIds.map((sourceId: string) => fixture.branch.find((entry: any) => entry.id === sourceId)!);
    receipt.newlyIncorporatedBeforeParentEntries = before.map((entry: any) => ({ id: entry.id, fingerprint: fingerprintEntry(entry) }));
    receipt.newlyCompletedAfterParentEntries = after.map((entry: any) => ({ id: entry.id, fingerprint: fingerprintEntry(entry) }));
    receipt.replacementMetrics.sourceMessageBytes = Buffer.byteLength(JSON.stringify(source.map((entry: any) => entry.message)));
    receipt.compositionMetrics.earlierSourceBytes = Buffer.byteLength(JSON.stringify(before.map((entry: any) => entry.message)));
    receipt.compositionMetrics.laterSourceBytes = Buffer.byteLength(JSON.stringify(after.map((entry: any) => entry.message)));
    receipt.compositionMetrics.cumulativeSourceBytes = receipt.replacementMetrics.sourceMessageBytes;
    const event = { messages: fixture.branch.filter((entry) => entry.type === "message").map((entry) => entry.message) };
    expect(await fixture.h.handlers.context(event, fixture.h.ctx)).toBeUndefined();
    const beforeCalls = { streams: fixture.h.streams(), finds: fixture.h.finds(), auths: fixture.h.auths() };
    await expect(fixture.h.retire.execute("again", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, fixture.h.ctx)).rejects.toThrow("malformed");
    expect({ streams: fixture.h.streams(), finds: fixture.h.finds(), auths: fixture.h.auths() }).toEqual(beforeCalls);
  });

  it("emits a V5 forward child and renders its exact continuation/provenance", async () => {
    const fixture = await latestV4Fixture();
    fixture.branch.push(assistant("a2", "second done"), user("u3", "third active")); fixture.h.ctx.sessionManager = publicSession(fixture.branch);
    await fixture.h.retire.execute("v4-child", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, fixture.h.ctx);
    const child = fixture.h.appended.at(-1);
    expect(child).toMatchObject({ version: 5, mode: "forward", generation: 3, newlyCompletedEpisodeEntries: [{ id: "u2" }, { id: "a2" }] });
    expect(child.parentReceiptFingerprint).toBe(createHash("sha256").update(JSON.stringify(fixture.h.appended[1])).digest("hex"));
    const inventory = await fixture.h.recall.execute("inventory", {}, undefined, undefined, fixture.h.ctx);
    expect(inventory.details.sourceEntryIds).toEqual(child.sourceEntryIds);
    const theme = { fg: (_color: string, text: string) => text };
    const compact = fixture.h.retire.renderResult({ content: [], details: child }, { expanded: false, isPartial: false }, theme, { isError: false }) as any;
    const expanded = fixture.h.retire.renderResult({ content: [], details: child }, { expanded: true, isPartial: false }, theme, { isError: false }) as any;
    expect(compact.text).toContain(`this retirement: ${child.deltaMetrics.newlyCompletedEpisodeCount} episode(s), ${child.deltaMetrics.newlyCompletedMessageCount} message(s)`);
    expect(compact.text).toContain(`${child.deltaMetrics.cumulativeMessageCount} source message(s)`);
    expect((expanded.text.match(/CONTINUATION CAPSULE/g) ?? [])).toHaveLength(1);
    expect(expanded.text).toContain(`Provenance: ${child.sourceEntryIds.join(", ")}`);
  });

  it("fails closed when the V3 parent entry is physically absent from the real manager tree", async () => {
    const fixture = await latestV3Fixture();
    const managerState = fixture.manager as any;
    const parentIndex = managerState.fileEntries.findIndex((entry: any) => entry.id === fixture.receiptEntry.data.parentReceiptEntryId);
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    const [removed] = managerState.fileEntries.splice(parentIndex, 1);
    managerState.byId.delete(removed.id);
    expect(fixture.manager.getEntry(removed.id)).toBeUndefined();
    const event = { messages: fixture.manager.buildSessionContext().messages };
    expect(await fixture.h.handlers.context(event, fixture.h.ctx)).toBeUndefined();
    const before = fixture.h.streams();
    await expect(fixture.h.retire.execute("again", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, fixture.h.ctx)).rejects.toThrow();
    expect(fixture.h.streams()).toBe(before); expect(fixture.h.appended).toHaveLength(2);
    await expect(fixture.h.recall.execute("recall", {}, undefined, undefined, fixture.h.ctx)).rejects.toThrow();
  });

  it("renders raw no-metrics results, preserving refusal errors", () => {
    const tools: any[] = [];
    process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
    registerEpisodeRetirement({ registerTool: (tool: any) => tools.push(tool), on: () => {}, appendEntry: () => {} } as any);
    const retire = tools.find((tool) => tool.name === "retire_episodes");
    const colors: string[] = [];
    const theme = { fg: (color: string, text: string) => { colors.push(color); return text; } };
    const refusal = "Episode retirement refused: no unambiguous completed episode suffix.";
    const error = retire.renderResult(
      { content: [{ type: "text", text: refusal }] },
      { expanded: false, isPartial: false },
      theme,
      { isError: true },
    ) as any;
    expect(error.text).toBe(refusal);
    expect(colors).toEqual(["error"]);
    const historical = "Retirement completed before replacement metrics existed.";
    const prior = retire.renderResult(
      { content: [{ type: "text", text: historical }] },
      { expanded: false, isPartial: false },
      theme,
      { isError: false },
    ) as any;
    expect(prior.text).toBe(historical);
    expect(colors).toEqual(["error", "success"]);
  });

  it("uses one configured capsule model and persists a V5 initial receipt with nested usage", async () => {
    const tools: any[] = [];
    const persisted: unknown[] = [];
    const progress: unknown[] = [];
    const branch: SessionLikeEntry[] = structuredClone(entries);
    ((branch[0].message!.content as Array<{ text: string }>)[0]).text = "OPENAI_API_KEY=sk-proj-selectedSecret Authorization: Bearer ghp_branchSecret";
    const originalFingerprint = fingerprintEntry(branch[0]);
    const originalText = (branch[0].message!.content as Array<{ text: string }>)[0].text;
    const model = { provider: "openrouter", id: "google/gemini-3.7-flash" };
    mockStreamSimple.mockImplementation((_model: unknown, context: any, options: any) => {
      expect(_model).toBe(model);
      expect(options.reasoning).toBe("high");
      expect(options).not.toHaveProperty("reasoningEffort");
      const prompt = context.messages[0].content[0].text;
      expect(prompt).toContain('"id":"u1"');
      expect(prompt).toContain("continue from the investigation");
      expect(prompt).toContain("finish safely");
      expect(prompt).toContain("[REDACTED]");
      expect(prompt).not.toContain("selectedSecret");
      expect(prompt).not.toContain("branchSecret");
      expect(prompt).not.toContain("goalSecret");
      return { result: async () => ({
        stopReason: "stop",
        content: [{ type: "text", text: "```json\n{\"objective\":\"finish\",\"findings\":[\"done\"],\"decisions\":[],\"unresolved\":[],\"nextStep\":\"ship\"}\n```" }],
        usage: { input: 1091, output: 336, reasoning: 171, cacheRead: 0, cacheWrite: 0, totalTokens: 1427, cost: { total: 0.00207825 } },
      }) };
    });
    const pi: any = { registerTool: (tool: any) => tools.push(tool), on: () => {}, appendEntry: (_type: string, data: unknown) => { persisted.push(data); branch.push({ type: "custom", customType: "episode-retirement", id: "receipt", parentId: "u2", timestamp: "receipt-ts", data }); } };
    process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
    process.env.PI_EPISODE_RETIREMENT_MODEL = "openrouter/google/gemini-3.7-flash";
    process.env.PI_EPISODE_RETIREMENT_REASONING_EFFORT = "high";
    registerEpisodeRetirement(pi);
    const retire = anchoredRetire(tools.find((tool) => tool.name === "retire_episodes"), tools.find((tool) => tool.name === "inspect_episode_retirement"));
    expect(Object.keys(retire.parameters.properties)).toEqual(["fromEpisodeInclusive", "inspectionWitness", "continuationGoal", "pinnedWorkingState"]);
    const result = await retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "finish safely with token=goalSecret" }, undefined, (update: unknown) => progress.push(update), { sessionManager: publicSession(branch), modelRegistry: { find: () => model, getApiKeyAndHeaders: async () => ({ ok: true }), complete: () => { throw new Error("complete must not be called"); } } });
    expect(progress.length).toBeGreaterThan(0);
    expect(fingerprintEntry(branch[0])).toBe(originalFingerprint);
    expect((branch[0].message!.content as Array<{ text: string }>)[0].text).toBe(originalText);
    expect(result.usage).toEqual(expect.objectContaining({ totalTokens: 1427 }));
    expect(result.content).toEqual([{ type: "text", text: "Selected completed episodes were retired into a continuation capsule." }]);
    expect(JSON.stringify(result.content)).not.toContain("CONTINUATION CAPSULE");
    expect(JSON.stringify(result.content)).not.toContain("u1");
    expect(persisted[0]).toEqual(expect.objectContaining({ version: 5, mode: "initial", provider: "openrouter", model: "google/gemini-3.7-flash", reasoningEffort: "high", usage: expect.objectContaining({ totalTokens: 1427 }) }));
    const receipt = persisted[0] as EpisodeRetirementReceipt;
    const expectedCapsuleText = "[CONTINUATION CAPSULE — episode retirement]\nObjective: finish\nFindings:\n- done\nNext step: ship\nOriginal source entry IDs (recover with recall_episode): u1, a1, t1, a2, t2, a3";
    expect(receipt.replacementMetrics).toEqual({
      completedEpisodeCount: 1,
      sourceMessageCount: 6,
      sourceMessageBytes: Buffer.byteLength(JSON.stringify(branch.slice(0, 6).map((entry) => entry.message))),
      capsuleTextBytes: Buffer.byteLength(expectedCapsuleText),
    });
    const theme = { fg: (_color: string, text: string) => text };
    const partial = retire.renderResult(result, { expanded: false, isPartial: true }, theme) as any;
    const compact = retire.renderResult(result, { expanded: false, isPartial: false }, theme) as any;
    const expanded = retire.renderResult(result, { expanded: true, isPartial: false }, theme) as any;
    expect(partial.text).toBe("Authoring retirement capsule…");
    expect(partial.text).not.toContain(expectedCapsuleText);
    expect(compact.text).toContain("1 completed episode(s), 6 source message(s)");
    expect(compact.text).toContain("B serialized source →");
    expect(compact.text).toContain("B capsule-text");
    expect(compact.text).toContain("LLM: input 1091 · output 336 · reasoning 171 · cache read 0 · cache write 0 · total 1427 · $0.00207825");
    expect(compact.text).not.toContain(expectedCapsuleText);
    expect(compact.text).not.toContain("u1, a1, t1, a2, t2, a3");
    expect(expanded.text).toContain(expectedCapsuleText);
    expect(expanded.text).toContain("Provenance: u1, a1, t1, a2, t2, a3");
    delete process.env.PI_EPISODE_RETIREMENT_ENABLED; delete process.env.PI_EPISODE_RETIREMENT_MODEL; delete process.env.PI_EPISODE_RETIREMENT_REASONING_EFFORT;
  });

  it("retires against resolved discuss context while retaining an exact custom-message prefix", async () => {
    process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
    const tools: any[] = [];
    const handlers: Record<string, any> = {};
    const raw = [
      { type: "custom", customType: "discuss", id: "mode", parentId: null, timestamp: "mode" },
      { type: "custom_message", customType: "discuss", content: "Discuss mode instructions", display: false, id: "discuss-message", parentId: "mode", timestamp: "cm" },
      user("u1", "settled request"), assistant("a1", "settled answer"), user("u2", "active request"),
    ] as SessionLikeEntry[];
    const manager = publicSession(raw.filter((entry) => entry.customType !== "episode-retirement"));
    const resolved = buildSessionContext(manager.getEntries() as any, manager.getLeafId()).messages;
    const appended: unknown[] = [];
    const pi: any = {
      registerTool: (tool: any) => tools.push(tool),
      on: (name: string, handler: any) => { handlers[name] = handler; },
      appendEntry: (_type: string, data: unknown) => { appended.push(data); raw.push({ type: "custom", customType: "episode-retirement", id: "receipt", parentId: "u2", timestamp: "receipt", data }); },
    };
    mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(capsule) }], usage: {} }) });
    registerEpisodeRetirement(pi);
    const ctx: any = {
      sessionManager: {
        ...manager,
        getBranch: () => raw,
      },
      modelRegistry: { find: () => ({ provider: "google", id: "gemini-3.7-flash" }), getApiKeyAndHeaders: async () => ({ ok: true }) },
    };
    const result = await anchoredRetire(tools.find((tool) => tool.name === "retire_episodes"), tools.find((tool) => tool.name === "inspect_episode_retirement")).execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
    expect(result.isError).toBeUndefined();
    expect(appended).toHaveLength(1);
    const next = await handlers.context({ messages: resolved }, ctx);
    expect(next.messages).toHaveLength(2);
    expect(next.messages[0]).toBe(resolved[0]);
    expect(next.messages[1].content[0].text).toContain("CONTINUATION CAPSULE");
  });

  it("preserves the opaque compaction-summary prefix by exact event reference", async () => {
    const manager = SessionManager.inMemory();
    const prefixUser = manager.appendMessage(user("ignored", "before compaction").message as any);
    manager.appendMessage(assistant("ignored", "before compaction answer").message as any);
    manager.appendCompaction("opaque compacted history", prefixUser, 10);
    manager.appendMessage(user("ignored", "retire this").message as any);
    manager.appendMessage(assistant("ignored", "settled").message as any);
    manager.appendMessage(user("ignored", "active").message as any);
    const { retire, handlers, appended, ctx } = extensionHarness(manager);
    const before = manager.buildSessionContext().messages;
    await retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
    const after = await handlers.context({ messages: before }, ctx);
    expect(appended).toHaveLength(1);
    expect(after.messages.slice(0, -1)).toEqual(before.slice(0, -3));
    expect(after.messages[0]).toBe(before[0]);
  });

  it("preserves the opaque branch_summary prefix by exact event reference", async () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage(user("ignored", "before summary").message as any);
    const branchPoint = manager.appendMessage(assistant("ignored", "before summary answer").message as any);
    manager.branchWithSummary(branchPoint, "opaque branch history");
    manager.appendMessage(user("ignored", "retire this").message as any);
    manager.appendMessage(assistant("ignored", "settled").message as any);
    manager.appendMessage(user("ignored", "active").message as any);
    const { retire, handlers, ctx } = extensionHarness(manager);
    const before = manager.buildSessionContext().messages;
    await retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
    const after = await handlers.context({ messages: before }, ctx);
    expect(after.messages.slice(0, -1)).toEqual(before.slice(0, -3));
    expect(after.messages[2]).toBe(before[2]);
  });

  it("refuses a repeated retirement after native compaction and leaves no stale V2 overlay", async () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage(user("ignored", "retire this").message as any);
    manager.appendMessage(assistant("ignored", "settled").message as any);
    const active = manager.appendMessage(user("ignored", "active").message as any);
    const h = extensionHarness(manager);
    await h.retire.execute("v2", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
    manager.appendCompaction("native compaction", active, 1);
    const event = { messages: manager.buildSessionContext().messages };
    expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
    const before = h.streams();
    await expect(h.retire.execute("v3", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx)).rejects.toThrow("native compaction after retirement");
    expect(h.streams()).toBe(before); expect(h.appended).toHaveLength(1);
    await expect(h.recall.execute("recall", {}, undefined, undefined, h.ctx)).rejects.toThrow("native compaction after retirement");
  });

  it("ignores an inactive receipt branch while the selected active V2→V3 chain continues", async () => {
    const manager = SessionManager.inMemory();
    const root = manager.appendMessage(user("ignored", "root").message as any);
    manager.appendMessage(assistant("ignored", "root done").message as any);
    manager.appendMessage(user("ignored", "inactive active").message as any);
    const h = extensionHarness(manager);
    await h.retire.execute("inactive-v2", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
    manager.branch(root);
    manager.appendMessage(user("ignored", "active first").message as any);
    manager.appendMessage(assistant("ignored", "active first done").message as any);
    manager.appendMessage(user("ignored", "active second").message as any);
    await h.retire.execute("active-v2", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
    manager.appendMessage(assistant("ignored", "active second done").message as any);
    manager.appendMessage(user("ignored", "active third").message as any);
    await h.retire.execute("active-v3", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
    expect(h.appended.map((receipt: any) => receipt.version)).toEqual([5, 5, 5]);
    const event = { messages: manager.buildSessionContext().messages };
    const projected = await h.handlers.context(event, h.ctx);
    expect(manager.getBranch().filter((entry: any) => entry.customType === "episode-retirement")).toHaveLength(2);
    expect((h.appended[2] as any).sourceEntryIds).toHaveLength(4);
    expect(projected.messages).toHaveLength(2);
    expect(projected.messages[0]).toBe(event.messages[0]);
    expect((JSON.stringify(projected.messages).match(/CONTINUATION CAPSULE/g) ?? [])).toHaveLength(1);
  });

  it("ignores an inactive global branch because buildContextEntries selects the active branch", async () => {
    const manager = SessionManager.inMemory();
    const root = manager.appendMessage(user("ignored", "root").message as any);
    manager.appendMessage(assistant("ignored", "inactive answer").message as any);
    manager.branch(root);
    manager.appendMessage(user("ignored", "retire this").message as any);
    manager.appendMessage(assistant("ignored", "settled").message as any);
    manager.appendMessage(user("ignored", "active").message as any);
    const { retire, appended, ctx } = extensionHarness(manager);
    await retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
    expect(appended).toHaveLength(1);
    expect(manager.getEntries()).toHaveLength(6);
    expect(manager.buildContextEntries()).toHaveLength(5);
  });

  it("preserves an old image prefix while refusing an image inside the selected episode", async () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage({ role: "user", content: [{ type: "image", data: "old", mimeType: "image/png" }], timestamp: 1 } as any);
    manager.appendMessage(assistant("ignored", "old answer").message as any);
    manager.appendMessage(user("ignored", "retire this").message as any);
    manager.appendMessage(assistant("ignored", "settled").message as any);
    manager.appendMessage(user("ignored", "active").message as any);
    const before = manager.buildSessionContext().messages;
    const prefix = before[0];
    const accepted = extensionHarness(manager);
    await accepted.retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, accepted.ctx);
    const projected = await accepted.handlers.context({ messages: before }, accepted.ctx);
    expect(projected.messages[0]).toBe(prefix);

    const refusedManager = SessionManager.inMemory();
    refusedManager.appendMessage({ role: "user", content: [{ type: "image", data: "selected", mimeType: "image/png" }], timestamp: 1 } as any);
    refusedManager.appendMessage(assistant("ignored", "settled").message as any);
    refusedManager.appendMessage(user("ignored", "active").message as any);
    const refused = extensionHarness(refusedManager);
    const streamsBeforeRefusal = refused.streams();
    await expect(refused.retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, refused.ctx)).rejects.toThrow("inspection witness authority is unavailable");
    expect(refused.streams()).toBe(streamsBeforeRefusal);
    expect(refused.appended).toHaveLength(0);
  });

  it("fails closed before stream or append when raw standard-message normalization changes its fingerprint", async () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage(user("ignored", "retire this").message as any);
    manager.appendMessage(assistant("ignored", "settled").message as any);
    manager.appendMessage(user("ignored", "active").message as any);
    const raw = manager.getEntries();
    (raw[0] as any).message.content = null;
    const { retire, appended, streams, ctx } = extensionHarness(manager);
    await expect(retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx)).rejects.toThrow("resolved context is unavailable");
    expect(streams()).toBe(0);
    expect(appended).toHaveLength(0);
  });

  it("preserves the provider prefix while removing only the selected suffix", () => {
    const earlier = [user("u0", "earlier request"), assistant("a0", "earlier result")];
    const selected = [user("u1", "retire this request"), assistant("a1", "settled result")];
    const active = user("u2", "active request");
    const later = [assistant("a2", "post-user assistant"), tool("t2", "post-call")];
    const all = [...earlier, ...selected, active, ...later];
    const receipt: EpisodeRetirementReceipt = { version: 1, kind: "episode-retirement", sourceEntryIds: selected.map((entry) => entry.id), sourceFingerprints: selected.map(fingerprintEntry), activeUserEntryId: "u2", capsule };
    const projected = applyEpisodeRetirement(all, receipt);
    expect(projected.applied).toBe(true);
    if (!projected.applied) throw new Error(projected.reason);
    expect(projected.messages.slice(0, earlier.length)).toEqual(earlier.map((entry) => entry.message));
    expect(projected.messages[0]).toBe(earlier[0].message);
    expect(projected.messages[1]).toBe(earlier[1].message);
    expect(JSON.stringify(projected.messages.slice(0, earlier.length))).toBe(JSON.stringify(earlier.map((entry) => entry.message)));
    expect(projected.messages).toHaveLength(earlier.length + 1 + later.length);
    expect(JSON.stringify(projected.messages.slice(earlier.length + 1))).toBe(JSON.stringify(later.map((entry) => entry.message)));
    expect((projected.messages[earlier.length].content as Array<{ text: string }>)[0].text).toContain("CONTINUATION CAPSULE");
    expect((projected.messages[earlier.length].content as Array<{ text: string }>)[1].text).toBe("active request");
  });

  it("recomposes opaque P + raw A + V2 B + completed cycle into a V5 receipt", async () => {
    const branch = [user("uP", "opaque prefix"), assistant("aP", "prefix done"), user("uA", "A"), assistant("aA", "A done"), user("uB", "B"), assistant("aB", "B done"), user("u1", "first active")] as SessionLikeEntry[];
    const tools: any[] = [], appended: any[] = [], handlers: Record<string, any> = {};
    let finds = 0, auths = 0;
    const pi: any = {
      registerTool: (tool: any) => tools.push(tool), on: (name: string, handler: any) => { handlers[name] = handler; },
      appendEntry: (_: string, data: any) => { appended.push(data); branch.push({ type: "custom", customType: "episode-retirement", id: `r${appended.length}`, parentId: branch.at(-1)!.id, timestamp: "t", data }); publicSession(branch); },
    };
    process.env.PI_EPISODE_RETIREMENT_ENABLED = "true";
    mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(capsule) }], usage: {} }) });
    registerEpisodeRetirement(pi);
    const retire = anchoredRetire(tools.find((tool) => tool.name === "retire_episodes"), tools.find((tool) => tool.name === "inspect_episode_retirement")), recall = tools.find((tool) => tool.name === "recall_episode");
    const ctx: any = { sessionManager: publicSession(branch), modelRegistry: { find: () => { finds++; return { provider: "google", id: "gemini-3.7-flash" }; }, getApiKeyAndHeaders: async () => { auths++; return { ok: true }; } } };
    await retire.execute("v2", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
    branch.push(assistant("a1", "retirement assessment complete"), user("u2", "recompose all")); ctx.sessionManager = publicSession(branch);
    await retire.execute("v4", { latestCompletedEpisodes: 3, continuationGoal: "recompose" }, undefined, undefined, ctx);
    const receipt = appended.at(-1);
    expect(receipt).toMatchObject({ version: 5, mode: "deepen", sourceEntryIds: ["uA", "aA", "uB", "aB", "u1", "a1"], parentReceiptEntryId: "r1" });
    expect(new Set(receipt.sourceEntryIds).size).toBe(6);
    expect(receipt.sourceFingerprints).toEqual(branch.filter((entry) => receipt.sourceEntryIds.includes(entry.id)).map(fingerprintEntry));
    expect(receipt.parentReceiptFingerprint).toBe(createHash("sha256").update(JSON.stringify(appended[0])).digest("hex"));
    expect(receipt.priorCapsuleFingerprint).toBe(createHash("sha256").update(JSON.stringify(appended[0].capsule)).digest("hex"));
    const request = mockStreamSimple.mock.calls[1][1].messages[0].content[0].text;
    const payload = JSON.parse(request.slice(request.indexOf("{")));
    expect(payload.priorContinuationCapsule).toEqual(appended[0].capsule);
    expect(payload.newlyIncorporatedBeforeParentEntries.map((entry: any) => entry.id)).toEqual(["uA", "aA"]);
    expect(payload.newlyCompletedAfterParentEntries.map((entry: any) => entry.id)).toEqual(["u1", "a1"]);
    expect(JSON.stringify([payload.newlyIncorporatedBeforeParentEntries, payload.newlyCompletedAfterParentEntries])).not.toContain("uB");
    expect(request).not.toContain("[CONTINUATION CAPSULE — episode retirement]");
    const event = { messages: branch.filter((entry) => entry.type === "message").map((entry) => entry.message) };
    const projected = await handlers.context(event, ctx);
    expect(projected.messages.slice(0, 2)).toEqual(event.messages.slice(0, 2));
    expect((JSON.stringify(projected.messages).match(/CONTINUATION CAPSULE/g) ?? [])).toHaveLength(1);
    expect(JSON.parse((await recall.execute("inventory", {}, undefined, undefined, ctx)).content[0].text).map((entry: any) => entry.id)).toEqual(["uA", "aA", "uB", "aB", "u1", "a1"]);
    expect(JSON.parse((await recall.execute("raw", { sourceEntryId: "a1" }, undefined, undefined, ctx)).content[0].text).id).toBe("a1");
    expect({ finds, auths, streams: mockStreamSimple.mock.calls.length, appends: appended.length }).toEqual({ finds: 2, auths: 2, streams: 2, appends: 2 });
  });

  it("recomposition stream failure preserves the effective V2 receipt", async () => {
    const branch = [user("uA", "A"), assistant("aA", "A done"), user("uB", "B"), assistant("aB", "B done"), user("u1", "first active")] as SessionLikeEntry[];
    const tools: any[] = [], appended: any[] = [], handlers: Record<string, any> = {}; let finds = 0, auths = 0;
    const pi: any = { registerTool: (tool: any) => tools.push(tool), on: (name: string, handler: any) => { handlers[name] = handler; }, appendEntry: (_: string, data: any) => { appended.push(data); branch.push({ type: "custom", customType: "episode-retirement", id: `r${appended.length}`, parentId: branch.at(-1)!.id, timestamp: "t", data }); publicSession(branch); } };
    process.env.PI_EPISODE_RETIREMENT_ENABLED = "true"; registerEpisodeRetirement(pi);
    const retire = anchoredRetire(tools.find((tool) => tool.name === "retire_episodes"), tools.find((tool) => tool.name === "inspect_episode_retirement")), recall = tools.find((tool) => tool.name === "recall_episode");
    const ctx: any = { sessionManager: publicSession(branch), modelRegistry: { find: () => { finds++; return { provider: "google", id: "gemini-3.7-flash" }; }, getApiKeyAndHeaders: async () => { auths++; return { ok: true }; } } };
    mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(capsule) }], usage: {} }) });
    await retire.execute("v2", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
    const priorEvent = { messages: branch.filter((entry) => entry.type === "message").map((entry) => entry.message) };
    const priorProjection = await handlers.context(priorEvent, ctx);
    const priorInventory = await recall.execute("inventory", {}, undefined, undefined, ctx);
    mockStreamSimple.mockReturnValue({ result: async () => { throw new Error("capsule generation failed"); } });
    branch.push(assistant("a1", "retirement assessment complete"), user("u2", "recompose all")); ctx.sessionManager = publicSession(branch);
    await expect(retire.execute("v4", { latestCompletedEpisodes: 3, continuationGoal: "recompose" }, undefined, undefined, ctx)).rejects.toThrow("capsule generation failed");
    expect({ finds, auths, streams: mockStreamSimple.mock.calls.length, appends: appended.length }).toEqual({ finds: 2, auths: 2, streams: 2, appends: 1 });
    const currentEvent = { messages: branch.filter((entry) => entry.type === "message").map((entry) => entry.message) };
    expect((await handlers.context(currentEvent, ctx)).messages).toHaveLength(5);
    expect(await recall.execute("inventory", {}, undefined, undefined, ctx)).toEqual(priorInventory);
    expect(JSON.parse(priorInventory.content[0].text).map((entry: any) => entry.id)).toEqual(["uB", "aB"]);
  });

  it("refuses partial parent overlap before capsule egress", async () => {
    const branch = [user("uA", "A"), assistant("aA", "A done"), user("uB", "B"), assistant("aB", "B done"), user("uC", "C active")] as SessionLikeEntry[];
    const tools: any[] = [], appended: any[] = []; let finds = 0, auths = 0;
    const pi: any = { registerTool: (tool: any) => tools.push(tool), on: () => {}, appendEntry: (_: string, data: any) => { appended.push(data); branch.push({ type: "custom", customType: "episode-retirement", id: `r${appended.length}`, parentId: branch.at(-1)!.id, timestamp: "t", data }); publicSession(branch); } };
    process.env.PI_EPISODE_RETIREMENT_ENABLED = "true"; registerEpisodeRetirement(pi);
    mockStreamSimple.mockReturnValue({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(capsule) }], usage: {} }) });
    const retire = anchoredRetire(tools.find((tool) => tool.name === "retire_episodes"), tools.find((tool) => tool.name === "inspect_episode_retirement")); const ctx: any = { sessionManager: publicSession(branch), modelRegistry: { find: () => { finds++; return { provider: "google", id: "gemini-3.7-flash" }; }, getApiKeyAndHeaders: async () => { auths++; return { ok: true }; } } };
    await retire.execute("v2", { latestCompletedEpisodes: 2, continuationGoal: "continue" }, undefined, undefined, ctx);
    branch.push(assistant("aC", "C done"), user("uD", "D active")); ctx.sessionManager = publicSession(branch);
    const streams = mockStreamSimple.mock.calls.length;
    await expect(retire.execute("partial", { latestCompletedEpisodes: 2, continuationGoal: "no overlap" }, undefined, undefined, ctx)).rejects.toThrow();
    expect({ finds, auths, streams: mockStreamSimple.mock.calls.length, appends: appended.length }).toEqual({ finds: 1, auths: 1, streams, appends: 1 });
  });

  it("refuses a gapped after-parent interval before capsule egress", async () => {
    const fixture = await generation2Fixture(); let finds = 0, auths = 0;
    fixture.h.ctx.modelRegistry.find = () => { finds++; return { provider: "google", id: "gemini-3.7-flash" }; };
    fixture.h.ctx.modelRegistry.getApiKeyAndHeaders = async () => { auths++; return { ok: true }; };
    fixture.manager.appendMessage(assistant("ignored", "third done").message as any);
    fixture.manager.appendMessage(user("ignored", "fourth").message as any);
    const streams = fixture.h.streams();
    await expect(fixture.h.retire.execute("gapped", { latestCompletedEpisodes: 1, continuationGoal: "no gap" }, undefined, undefined, fixture.h.ctx)).rejects.toThrow();
    expect({ finds, auths, streams: fixture.h.streams(), appends: fixture.h.appended.length }).toEqual({ finds: 0, auths: 0, streams, appends: 1 });
  });


  it("summarizes every safe count from a large valid prior receipt within the fixed inspect budget", async () => {
    const manager = SessionManager.inMemory();
    for (const [id, text] of [["a", "earlier"], ["b", "parent"]]) {
      manager.appendMessage(user("ignored", `SOURCE_SENTINEL ${id} request`).message as any);
      manager.appendMessage(assistant("ignored", `SOURCE_SENTINEL ${id} done`).message as any);
    }
    manager.appendMessage(user("ignored", "SOURCE_SENTINEL first after-parent active").message as any);
    const h = extensionHarness(manager);
    await h.retire.execute("parent", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, h.ctx);
    manager.appendMessage(assistant("ignored", "SOURCE_SENTINEL first after-parent done").message as any);
    for (let count = 1; count < 100; count++) {
      manager.appendMessage(user("ignored", `SOURCE_SENTINEL after-parent ${count} request`).message as any);
      manager.appendMessage(assistant("ignored", `SOURCE_SENTINEL after-parent ${count} done`).message as any);
    }
    manager.appendMessage(user("ignored", "SOURCE_SENTINEL final active").message as any);
    const before = { finds: h.finds(), auths: h.auths(), streams: h.streams(), appends: h.appended.length };
    const result = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    const text = result.content[0].text;
    const detailsText = JSON.stringify(result.details);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(detailsText)).toBeLessThanOrEqual(2_048);
    expect(JSON.parse(text)).toEqual(result.details);
    expect(result.details.candidates).toHaveLength(3);
    expect(result.details.candidates.every((candidate: any) =>
      Object.keys(candidate).every((key) => ["id", "timestamp", "userPrompt", "retiresEpisodes", "sourceMessageBytes"].includes(key)),
    )).toBe(true);
    expect(result.details).toMatchObject({
      evaluatedCount: 102,
      acceptedCount: 3,
      refusedCount: 99,
      relationFrontier: {
        initial: null,
        forward: { acceptedCount: 1, minCount: 100, maxCount: 100 },
        recompose: { acceptedCount: 1, minCount: 101, maxCount: 101 },
        deepen: { acceptedCount: 1, minCount: 102, maxCount: 102 },
      },
      largestSafe: {
        count: 102, relation: "deepen",
        earlierAddedEpisodeCount: 1, earlierAddedMessageCount: 2,
        laterAddedEpisodeCount: 100, laterAddedMessageCount: 200,
        cumulativeEpisodeCount: 102, cumulativeMessageCount: 204,
        startId: expect.stringMatching(/^.{1,128}$/),
        endId: expect.stringMatching(/^.{1,128}$/),
      },
    });
    expect(result.details.largestSafe.cumulativeSourceBytes).toBeGreaterThan(0);
    expect(result.details.refusalReasons).toEqual({
      insufficientCompletedEpisodes: 0,
      unsupportedCandidate: 0,
      incompleteAssistantBoundary: 0,
      unmatchedToolResult: 0,
      openToolCalls: 0,
      activeAlignment: 0,
      parentUnavailable: 0,
      partialOverlapOrGap: 99,
      v4MissingAfterInterval: 0,
      exactForwardRequired: 0,
    });
    const refusalTotal = Object.values(result.details.refusalReasons as Record<string, number>).reduce((sum, count) => sum + count, 0);
    expect(refusalTotal).toBe(result.details.refusedCount);
    expect(result.details.acceptedCount + refusalTotal).toBe(result.details.evaluatedCount);
    expect({ finds: h.finds(), auths: h.auths(), streams: h.streams(), appends: h.appended.length }).toEqual(before);
  });

  it("inspects initial candidates without model or persistence work", async () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage(user("ignored", "settled request").message as any);
    manager.appendMessage(assistant("ignored", "settled result").message as any);
    manager.appendMessage(user("ignored", "active request").message as any);
    const harness = extensionHarness(manager);
    const result = await harness.inspect.execute("inspect", {}, undefined, undefined, harness.ctx);
    expect(result.details).toMatchObject({
      evaluatedCount: 1, acceptedCount: 1, refusedCount: 0,
      relationFrontier: { initial: { acceptedCount: 1, minCount: 1, maxCount: 1 }, forward: null, recompose: null, deepen: null },
      largestSafe: { relation: "initial", count: 1, startId: expect.any(String), endId: expect.any(String) },
    });
    expect(harness.finds()).toBe(0);
    expect(harness.auths()).toBe(0);
    expect(harness.streams()).toBe(0);
    expect(harness.appended).toHaveLength(0);
  });

  it("RED: exposes witness-scoped completed-episode candidates and the new retire parameters", async () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "  first\nrequest  " }], timestamp: Date.parse("2026-01-02T03:04:05Z") } as any);
    manager.appendMessage(assistant("ignored", "first done").message as any);
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "second completed request" }], timestamp: Date.parse("2026-01-03T03:04:05Z") } as any);
    manager.appendMessage(assistant("ignored", "second done").message as any);
    manager.appendMessage(user("ignored", "active request").message as any);
    const h = extensionHarness(manager);
    const inspected = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    expect(Object.keys(h.retire.parameters.properties)).toEqual([
      "fromEpisodeInclusive", "inspectionWitness", "continuationGoal", "pinnedWorkingState",
    ]);
    expect(inspected.details).toMatchObject({
      inspectionWitness: expect.any(String),
      candidates: [
        { id: "ep-1", retiresEpisodes: 1, userPrompt: "second completed request", sourceMessageBytes: expect.any(Number) },
        { id: "ep-2", retiresEpisodes: 2, userPrompt: "first request", timestamp: "2026-01-02T03:04:05.000Z" },
      ],
      activeEpisode: { userPrompt: "active request" },
    });
  });

  it("RED: binds all-safe ep-2 to the exact two-episode newest suffix", async () => {
    const manager = SessionManager.inMemory();
    for (const message of [
      { role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 }, { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 1 },
      { role: "user", content: [{ type: "text", text: "new" }], timestamp: 1 }, { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 1 },
      { role: "user", content: [{ type: "text", text: "active" }], timestamp: 1 },
    ]) manager.appendMessage(message as any);
    const h = extensionHarness(manager); const page = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    expect(page.details.candidates.map((candidate: any) => candidate.id)).toEqual(["ep-1", "ep-2"]);
    await h.retire.execute("retire", { fromEpisodeInclusive: "ep-2", inspectionWitness: page.details.inspectionWitness, continuationGoal: "continue", pinnedWorkingState: "pin" }, undefined, undefined, h.ctx);
    expect((h.appended[0] as any).sourceEntryIds).toEqual(manager.getEntries().slice(0, 4).map((entry: any) => entry.id));
  });

  it("RED: paginates complete dual envelopes with canonical metrics and no inspect egress", async () => {
    const manager = SessionManager.inMemory();
    for (let n = 0; n < 80; n++) {
      manager.appendMessage({ role: "user", content: [{ type: "text", text: `request ${n} ${"x".repeat(45)}` }], timestamp: 1 } as any);
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 1 } as any);
    }
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "active" }], timestamp: 1 } as any);
    const h = extensionHarness(manager); const ids: string[] = []; let pageCount = 0;
    let page = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    const witness = page.details.inspectionWitness;
    do {
      pageCount++; expect(page.details.candidates.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(page.content[0].text, "utf8")).toBeLessThanOrEqual(2048);
      expect(Buffer.byteLength(JSON.stringify(page.details), "utf8")).toBeLessThanOrEqual(2048);
      expect(page.details.inspectionWitness).toBe(witness);
      ids.push(...page.details.candidates.map((candidate: any) => candidate.id));
      page = page.details.nextCursor ? await h.inspect.execute("next", { cursor: page.details.nextCursor }, undefined, undefined, h.ctx) : null;
    } while (page);
    expect(ids).toEqual(Array.from({ length: 80 }, (_, index) => `ep-${index + 1}`));
    expect(new Set(ids).size).toBe(80); expect(pageCount).toBeGreaterThanOrEqual(2);
    expect(h.streams()).toBe(0); expect(h.finds()).toBe(0); expect(h.auths()).toBe(0); expect(h.appended).toHaveLength(0);
  });

  it("uses only the first text part and bounded preview fallbacks", async () => {
    const manager = SessionManager.inMemory();
    const complete = (content: unknown) => {
      manager.appendMessage({ role: "user", content, timestamp: 1 } as any);
      manager.appendMessage(assistant("ignored", "done").message as any);
    };
    complete([{ type: "text", text: "  first\ntext  " }, { type: "text", text: "ignored second text" }]);
    complete([{ type: "text", text: "x".repeat(46) }]);
    complete([]);
    complete([{ type: "toolCall", id: "call", name: "bash", arguments: {} }]);
    manager.appendMessage(user("ignored", "active").message as any);
    const h = extensionHarness(manager);
    const result = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    expect(result.details.candidates.map((candidate: any) => candidate.userPrompt)).toEqual([
      "(non-text prompt)", "(empty)", "x".repeat(44) + "…", "first text",
    ]);
    expect(result.details.candidates[2].userPrompt).toHaveLength(45);
  });

  it("rejects a cursor when the resolved prefix changes", async () => {
    const manager = SessionManager.inMemory();
    for (let n = 0; n < 20; n++) {
      manager.appendMessage(user("ignored", `request ${n}`).message as any);
      manager.appendMessage(assistant("ignored", "done").message as any);
    }
    manager.appendMessage(user("ignored", "active").message as any);
    const h = extensionHarness(manager);
    const page = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    (manager.getEntries()[0] as any).message.content = [{ type: "text", text: "changed" }];
    await expect(h.inspect.execute("next", { cursor: page.details.nextCursor }, undefined, undefined, h.ctx)).rejects.toThrow("stale cursor");
    expect(h.streams()).toBe(0); expect(h.finds()).toBe(0); expect(h.auths()).toBe(0); expect(h.appended).toHaveLength(0);
  });

  it("rejects a cursor when a new user root is added", async () => {
    const manager = SessionManager.inMemory();
    for (let n = 0; n < 20; n++) {
      manager.appendMessage(user("ignored", `request ${n}`).message as any);
      manager.appendMessage(assistant("ignored", "done").message as any);
    }
    manager.appendMessage(user("ignored", "active").message as any);
    const h = extensionHarness(manager);
    const page = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    manager.appendMessage(user("ignored", "new active root").message as any);
    await expect(h.inspect.execute("next", { cursor: page.details.nextCursor }, undefined, undefined, h.ctx)).rejects.toThrow("stale cursor");
  });

  it("keeps cursors repeatable and fresh through post-root assistant and tool traffic", async () => {
    const manager = SessionManager.inMemory();
    for (let n = 0; n < 20; n++) {
      manager.appendMessage(user("ignored", `request ${n}`).message as any);
      manager.appendMessage(assistant("ignored", "done").message as any);
    }
    manager.appendMessage(user("ignored", "active").message as any);
    const h = extensionHarness(manager);
    const first = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    manager.appendMessage(assistant("ignored", "post-root assistant").message as any);
    manager.appendMessage(tool("ignored", "post-root-call").message as any);
    const repeated = await Promise.all(["one", "two"].map((id) =>
      h.inspect.execute(id, { cursor: first.details.nextCursor }, undefined, undefined, h.ctx),
    ));
    expect(repeated.map((page) => page.details.candidates.map((candidate: any) => candidate.id))).toEqual([
      repeated[0].details.candidates.map((candidate: any) => candidate.id),
      repeated[0].details.candidates.map((candidate: any) => candidate.id),
    ]);
    expect(repeated.map((page) => page.details.inspectionWitness)).toEqual([first.details.inspectionWitness, first.details.inspectionWitness]);
    expect(h.streams()).toBe(0); expect(h.finds()).toBe(0); expect(h.auths()).toBe(0); expect(h.appended).toHaveLength(0);
  });

  describe("C1 RED: anchored retirement, pin, and V5", () => {
    it("requires exactly the anchored retire schema and has no scalar count", async () => {
      const manager = SessionManager.inMemory();
      manager.appendMessage(user("ignored", "settled").message as any); manager.appendMessage(assistant("ignored", "done").message as any); manager.appendMessage(user("ignored", "active").message as any);
      const h = extensionHarness(manager);
      expect(Object.keys(h.retire.parameters.properties)).toEqual(["fromEpisodeInclusive", "inspectionWitness", "continuationGoal", "pinnedWorkingState"]);
      expect(h.retire.parameters.properties.latestCompletedEpisodes).toBeUndefined();
      await expect(h.retire.execute("schema", await inspectAnchor(h), undefined, undefined, h.ctx)).resolves.toBeDefined();
    });

    it.each([
      ["missing", undefined], ["non-string", 1], ["blank", " \n "], ["over 2000", "x".repeat(2_001)],
    ])("rejects %s pin before model egress or append", async (_name, pinnedWorkingState) => {
      const manager = SessionManager.inMemory();
      manager.appendMessage(user("ignored", "settled").message as any); manager.appendMessage(assistant("ignored", "done").message as any); manager.appendMessage(user("ignored", "active").message as any);
      const h = extensionHarness(manager); const before = retirementCounts(h);
      await expect(h.retire.execute("pin", await inspectAnchor(h, "ep-1", { pinnedWorkingState }), undefined, undefined, h.ctx)).rejects.toThrow("pinnedWorkingState");
      expect(retirementCounts(h)).toEqual(before);
    });

    it("preserves an exact 2000-character multiline pin, redacts egress, and projects one dedicated block", async () => {
      const manager = SessionManager.inMemory();
      manager.appendMessage(user("ignored", "settled").message as any); manager.appendMessage(assistant("ignored", "done").message as any); manager.appendMessage(user("ignored", "active").message as any);
      const h = extensionHarness(manager); const pin = "token=pinSecret\n" + "x".repeat(1_984);
      await h.retire.execute("pin", await inspectAnchor(h, "ep-1", { pinnedWorkingState: pin }), undefined, undefined, h.ctx);
      const receipt: any = h.appended[0];
      expect(receipt).toMatchObject({ version: 5, pinnedWorkingState: pin, capsule });
      const request = mockStreamSimple.mock.calls[0][1].messages[0].content[0].text;
      expect(request).toMatch(/PINNED WORKING STATE[\s\S]*REDACTED/);
      expect(request).toMatch(/complementary[\s\S]*non-duplicative[\s\S]*no pinned field/i);
      expect(request).not.toContain("token=pinSecret");
      expect(Object.keys(JSON.parse(mockStreamSimple.mock.calls[0][1].messages[0].content[0].text.slice(request.indexOf("{"))))).not.toContain("pinnedWorkingState");
      const event = { messages: manager.buildSessionContext().messages };
      const projected = await h.handlers.context(event, h.ctx);
      expect((JSON.stringify(projected.messages).match(/PINNED WORKING STATE/g) ?? [])).toHaveLength(1);
      expect(projected.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content.map((part: any) => part.text ?? "") : [message.content]).join("\n")).toContain(pin);
    });

    it("fails closed for unknown, replaced, consumed, and stale witness authority; retry remains valid before append", async () => {
      const make = () => { const manager = SessionManager.inMemory(); manager.appendMessage(user("ignored", "settled").message as any); manager.appendMessage(assistant("ignored", "done").message as any); manager.appendMessage(user("ignored", "active").message as any); return { manager, h: extensionHarness(manager) }; };
      for (const mutate of [
        async (_manager: SessionManager, h: any, params: any) => ({ ...params, inspectionWitness: "unknown" }),
        async (_manager: SessionManager, h: any, params: any) => { await h.inspect.execute("replace", {}, undefined, undefined, h.ctx); return params; },
        async (manager: SessionManager, _h: any, params: any) => { manager.appendMessage(user("ignored", "new root").message as any); return params; },
        async (manager: SessionManager, _h: any, params: any) => { (manager.getEntries()[0] as any).message.content = [{ type: "text", text: "changed" }]; return params; },
      ]) {
        const { manager, h } = make(); const params = await mutate(manager, h, await inspectAnchor(h)); const before = retirementCounts(h);
        await expect(h.retire.execute("authority", params, undefined, undefined, h.ctx)).rejects.toThrow(/witness|authority|stale/i);
        expect(retirementCounts(h)).toEqual(before);
      }
      const { manager, h } = make(); const fresh = await inspectAnchor(h);
      manager.appendMessage(assistant("ignored", "post-root").message as any); manager.appendMessage(tool("ignored", "post-root-call").message as any);
      await h.retire.execute("fresh", fresh, undefined, undefined, h.ctx);
      await expect(h.retire.execute("consumed", fresh, undefined, undefined, h.ctx)).rejects.toThrow(/witness|consumed|authority/i);
      const retryCase = make();
      const retry = await inspectAnchor(retryCase.h); mockStreamSimple.mockReturnValueOnce({ result: async () => { throw new Error("model failed"); } });
      await expect(retryCase.h.retire.execute("fail", retry, undefined, undefined, retryCase.h.ctx)).rejects.toThrow("model failed");
      await expect(retryCase.h.retire.execute("retry", retry, undefined, undefined, retryCase.h.ctx)).resolves.toBeDefined();
    });

    it("rejects an instance-A witness after reload into instance B before model egress or append", async () => {
      const manager = SessionManager.inMemory();
      manager.appendMessage(user("ignored", "settled").message as any);
      manager.appendMessage(assistant("ignored", "done").message as any);
      manager.appendMessage(user("ignored", "active").message as any);
      const instanceA = extensionHarness(manager);
      const params = await inspectAnchor(instanceA);
      const instanceB = extensionHarness(manager);
      const before = retirementCounts(instanceB);
      await expect(instanceB.retire.execute("reloaded", params, undefined, undefined, instanceB.ctx)).rejects.toThrow(/witness|authority/i);
      expect(retirementCounts(instanceB)).toEqual(before);
    });

    it.each([
      ["initial", "ep-1", async () => { const manager = SessionManager.inMemory(); manager.appendMessage(user("ignored", "settled").message as any); manager.appendMessage(assistant("ignored", "done").message as any); manager.appendMessage(user("ignored", "active").message as any); return { h: extensionHarness(manager), provenance: [] }; }],
      ["forward", "ep-1", async () => ({ ...(await anchoredRelationFixture()), provenance: ["parentReceiptEntryId", "newlyCompletedEpisodeEntries"] })],
      ["recompose", "ep-2", async () => ({ ...(await anchoredRelationFixture()), provenance: ["parentReceiptEntryId", "newlyIncorporatedBeforeParentEntries", "newlyCompletedAfterParentEntries", "compositionMetrics"] })],
      ["deepen", "ep-3", async () => ({ ...(await anchoredRelationFixture()), provenance: ["parentReceiptEntryId", "newlyIncorporatedBeforeParentEntries", "newlyCompletedAfterParentEntries", "compositionMetrics"] })],
    ])("writes strict V5 %s receipt with original pin and applicable provenance", async (mode, anchor, setup) => {
      const { h, provenance } = await setup();
      await h.retire.execute("v5", await inspectAnchor(h, anchor), undefined, undefined, h.ctx);
      const receipt: any = h.appended.at(-1);
      expect(receipt).toMatchObject({ version: 5, mode, pinnedWorkingState: "verified finding\nunresolved dependency", capsule });
      for (const key of provenance) expect(receipt).toHaveProperty(key);
    });

    it("keeps V1–V4 pin-free and makes mixed V2→V5 and V4→V5 projection latest-only with cumulative recall", async () => {
      const legacy: any = { version: 2, kind: "episode-retirement", sourceEntryIds: ["u1", "a1"], sourceFingerprints: [], activeUserEntryId: "u2", capsule, provider: "google", model: "x", reasoningEffort: "medium", promptVersion: "capsule-v2", usage: {} };
      expect(JSON.stringify(legacy)).not.toContain("pinnedWorkingState");
      const fixture = await generation2Fixture();
      await fixture.h.retire.execute("v5", await inspectAnchor(fixture.h, "ep-1", { pinnedWorkingState: "latest pin" }), undefined, undefined, fixture.h.ctx);
      const event = { messages: fixture.manager.buildSessionContext().messages };
      const projected = await fixture.h.handlers.context(event, fixture.h.ctx);
      expect((JSON.stringify(projected.messages).match(/PINNED WORKING STATE/g) ?? [])).toHaveLength(1);
      expect(JSON.stringify(projected.messages)).toContain("latest pin");
      const v2Receipt: any = fixture.h.appended.at(-1);
      const v2Inventory: any = await fixture.h.recall.execute("inventory", {}, undefined, undefined, fixture.h.ctx);
      expect(v2Inventory.details.sourceEntryIds).toEqual(v2Receipt.sourceEntryIds);
      const v2Raw: any = await fixture.h.recall.execute("raw", { sourceEntryId: v2Receipt.sourceEntryIds[0] }, undefined, undefined, fixture.h.ctx);
      const v2Entry: any = fixture.manager.getEntries().find((entry: any) => entry.id === v2Receipt.sourceEntryIds[0]);
      expect(JSON.parse(v2Raw.content[0].text)).toEqual({ id: v2Receipt.sourceEntryIds[0], message: v2Entry.message });
      const v4 = await latestV4Fixture();
      v4.branch.push(assistant("a2", "done"), user("u3", "active")); v4.h.ctx.sessionManager = publicSession(v4.branch);
      await v4.h.retire.execute("v5-after-v4", await inspectAnchor(v4.h, "ep-1", { pinnedWorkingState: "V4 latest pin" }), undefined, undefined, v4.h.ctx);
      const v4Projected = await v4.h.handlers.context({ messages: v4.branch.filter((entry: any) => entry.type === "message").map((entry: any) => entry.message) }, v4.h.ctx);
      expect((JSON.stringify(v4Projected.messages).match(/PINNED WORKING STATE/g) ?? [])).toHaveLength(1);
      expect(JSON.stringify(v4Projected.messages)).toContain("V4 latest pin");
      const v4Inventory: any = await v4.h.recall.execute("inventory", {}, undefined, undefined, v4.h.ctx);
      expect(v4Inventory.details.sourceEntryIds).toEqual(v4.h.appended.at(-1).sourceEntryIds);
      const v4RawId = v4.h.appended.at(-1).sourceEntryIds[0];
      await expect(v4.h.recall.execute("raw", { sourceEntryId: v4RawId }, undefined, undefined, v4.h.ctx)).resolves.toMatchObject({ details: { sourceEntryId: v4RawId } });
    });

    it("projects only the second pin and capsule in a V5→V5 chain", async () => {
      const manager = SessionManager.inMemory();
      manager.appendMessage(user("ignored", "first settled").message as any); manager.appendMessage(assistant("ignored", "first done").message as any); manager.appendMessage(user("ignored", "first active").message as any);
      const h = extensionHarness(manager);
      const firstCapsule = { ...capsule, objective: "first V5 capsule" };
      const secondCapsule = { ...capsule, objective: "second V5 capsule" };
      mockStreamSimple.mockReturnValueOnce({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(firstCapsule) }], usage: {} }) });
      await h.retire.execute("first", await inspectAnchor(h, "ep-1", { pinnedWorkingState: "first pin" }), undefined, undefined, h.ctx);
      manager.appendMessage(assistant("ignored", "first active done").message as any); manager.appendMessage(user("ignored", "second active").message as any);
      mockStreamSimple.mockReturnValueOnce({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(secondCapsule) }], usage: {} }) });
      await h.retire.execute("second", await inspectAnchor(h, "ep-1", { pinnedWorkingState: "second pin" }), undefined, undefined, h.ctx);
      const projected = await h.handlers.context({ messages: manager.buildSessionContext().messages }, h.ctx);
      const text = JSON.stringify(projected.messages);
      expect((text.match(/PINNED WORKING STATE/g) ?? [])).toHaveLength(1);
      expect(text).toContain("second pin"); expect(text).toContain("second V5 capsule");
      expect(text).not.toContain("first pin"); expect(text).not.toContain("first V5 capsule");
    });

    it.each([
      ["missing mode", (receipt: any) => { delete receipt.mode; }],
      ["invalid mode", (receipt: any) => { receipt.mode = "invalid"; }],
      ["missing pin", (receipt: any) => { delete receipt.pinnedWorkingState; }],
      ["blank pin", (receipt: any) => { receipt.pinnedWorkingState = " \n"; }],
      ["extra top-level key", (receipt: any) => { receipt.extra = true; }],
      ["initial missing V2 provenance", (receipt: any) => { delete receipt.provider; }],
      ["initial extra V3 provenance", (receipt: any) => { receipt.newlyCompletedEpisodeEntries = []; }],
    ])("fails closed for strict future V5 %s", async (_name, tamper) => {
      const { manager, h, receipt } = await futureV5Fixture();
      const event = { messages: manager.buildSessionContext().messages };
      expect(await h.handlers.context(event, h.ctx)).toBeDefined();
      await expect(h.recall.execute("control", {}, undefined, undefined, h.ctx)).resolves.toBeDefined();
      tamper(receipt);
      const before = retirementCounts(h);
      expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
      await expect(h.recall.execute("tampered", {}, undefined, undefined, h.ctx)).rejects.toThrow();
      await expect(h.retire.execute("tampered", { fromEpisodeInclusive: "ep-1", inspectionWitness: "future", continuationGoal: "continue", pinnedWorkingState: "pin" }, undefined, undefined, h.ctx)).rejects.toThrow(/malformed|authority|witness/i);
      expect(retirementCounts(h)).toEqual(before);
    });
  });

  it("RED: retains aggregate refusal conservation, canonical source bytes, and rejects invalid cursors", async () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage(user("x", "settled").message as any); manager.appendMessage(assistant("x", "done").message as any); manager.appendMessage(user("x", "active").message as any);
    const h = extensionHarness(manager); const page = await h.inspect.execute("inspect", {}, undefined, undefined, h.ctx);
    expect(page.details.evaluatedCount).toBe(page.details.acceptedCount + page.details.refusedCount);
    expect(page.details.refusalReasons).toEqual(expect.objectContaining({ unsupportedCandidate: expect.any(Number), openToolCalls: expect.any(Number) }));
    expect(page.details.candidates[0].sourceMessageBytes).toBe(Buffer.byteLength(JSON.stringify(manager.getEntries().slice(0, 2).map((entry: any) => entry.message)), "utf8"));
    await expect(h.inspect.execute("bad", { cursor: "wrong" }, undefined, undefined, h.ctx)).rejects.toThrow();
  });

});
