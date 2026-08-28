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
const extensionHarness = (manager: SessionManager) => {
  const tools: any[] = [], handlers: Record<string, any> = {}, appended: unknown[] = [];
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
  return {
    retire: tools.find((tool) => tool.name === "retire_episodes"), handlers, appended,
    streams: () => mockStreamSimple.mock.calls.length,
    ctx: { sessionManager: manager, modelRegistry: { find: () => ({ provider: "google", id: "gemini-3.7-flash" }), getApiKeyAndHeaders: async () => ({ ok: true }) } },
  };
};

describe("episode retirement", () => {
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
    const retire = tools.find((tool) => tool.name === "retire_episodes");
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

  it("uses one configured capsule model and persists a V2 receipt with nested usage", async () => {
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
    const retire = tools.find((tool) => tool.name === "retire_episodes");
    expect(Object.keys(retire.parameters.properties)).toEqual(["latestCompletedEpisodes", "continuationGoal"]);
    const result = await retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "finish safely with token=goalSecret" }, undefined, (update: unknown) => progress.push(update), { sessionManager: publicSession(branch), modelRegistry: { find: () => model, getApiKeyAndHeaders: async () => ({ ok: true }), complete: () => { throw new Error("complete must not be called"); } } });
    expect(progress.length).toBeGreaterThan(0);
    expect(fingerprintEntry(branch[0])).toBe(originalFingerprint);
    expect((branch[0].message!.content as Array<{ text: string }>)[0].text).toBe(originalText);
    expect(result.usage).toEqual(expect.objectContaining({ totalTokens: 1427 }));
    expect(result.content).toEqual([{ type: "text", text: "Selected completed episodes were retired into a continuation capsule." }]);
    expect(JSON.stringify(result.content)).not.toContain("CONTINUATION CAPSULE");
    expect(JSON.stringify(result.content)).not.toContain("u1");
    expect(persisted[0]).toEqual(expect.objectContaining({ version: 2, provider: "openrouter", model: "google/gemini-3.7-flash", reasoningEffort: "high", usage: expect.objectContaining({ totalTokens: 1427 }) }));
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
    const result = await tools.find((tool) => tool.name === "retire_episodes").execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx);
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
    await expect(refused.retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, refused.ctx)).rejects.toThrow("unsupported or nonstandard slot inside candidate");
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
    await expect(retire.execute("call", { latestCompletedEpisodes: 1, continuationGoal: "continue" }, undefined, undefined, ctx)).rejects.toThrow("resolved standard-message fingerprint mismatch");
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
});
