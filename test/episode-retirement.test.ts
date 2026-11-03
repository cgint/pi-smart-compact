import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@earendil-works/pi-coding-agent")>(),
  keyHint: () => "to expand",
}));

import { buildSessionContext, convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  applyEpisodeRetirement,
  selectLatestCompletedEpisodes,
  type ContinuationCapsule,
  type EpisodeRetirementReceipt,
  type SessionLikeEntry,
  fingerprintEntry,
} from "../src/episode-retirement.js";
import registerEpisodeRetirement from "../src/episode-retirement.js";

/**
 * Focused coverage for the still-live READ path after episode-retirement creation was retired:
 * - registration: only recall_episode + the context projection handler are registered, and this
 *   happens unconditionally (no PI_EPISODE_RETIREMENT_ENABLED gate); the creation tools
 *   (inspect_episode_retirement, retire_episodes) are intentionally absent.
 * - pure helpers: selectLatestCompletedEpisodes / applyEpisodeRetirement / projectEventMessages /
 *   fingerprintEntry.
 * - projection + recall + receipt validation against EXPLICIT static legacy receipts (V1-V5),
 *   not by running the removed creation tools.
 *
 * The full creation-path behavior (witness, anchored retirement, V5 authoring, recompose/deepen,
 * capsule egress, refusal conservation, pagination, model/auth/abort failures) exercised the removed
 * creation API and has no target code; it is not retained here. Git history holds the original tests.
 */

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

/** Registers the read path and returns the recall tool + context handler. Env is NOT required. */
function readPathHarness(branch: SessionLikeEntry[]) {
  const tools: any[] = [];
  const handlers: Record<string, any> = {};
  const pi: any = {
    registerTool: (t: any) => tools.push(t),
    on: (name: string, handler: any) => { handlers[name] = handler; },
    appendEntry: () => { throw new Error("read path must never append"); },
  };
  registerEpisodeRetirement(pi);
  return {
    tools,
    handlers,
    recall: tools.find((t) => t.name === "recall_episode"),
    ctx: { sessionManager: publicSession(branch), modelRegistry: { find: () => { throw new Error("no model lookup expected"); }, getApiKeyAndHeaders: async () => ({ ok: false }) } },
  };
}

/*
 * Authentic receipt builders. These replicate production receipt construction exactly (the
 * capsuleText format, hashJson = sha256(JSON.stringify), and rawMetrics) so the receipts pass
 * the real `assessLatestReceipt` / `validatedRange` validation and exercise the ACTUAL context
 * projection and recall_episode paths — not just the validators. The creation API itself is
 * retired; only the read path is under test.
 */
const hashJson = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rawMetrics = (entries: SessionLikeEntry[], ids: string[]) => {
  const source = ids.map((id) => entries.find((entry) => entry.id === id)!);
  return {
    completedEpisodeCount: source.filter((entry) => entry.message!.role === "user").length,
    sourceMessageCount: source.length,
    sourceMessageBytes: Buffer.byteLength(JSON.stringify(source.map((entry) => entry.message))),
  };
};
const capsuleText = (cap: ContinuationCapsule, sourceEntryIds: string[]) => {
  const list = (title: string, items: string[]) =>
    items.length ? "\n" + title + ":\n" + items.map((item) => "- " + item).join("\n") : "";
  return "[CONTINUATION CAPSULE — episode retirement]\n" +
    "Objective: " + cap.objective +
    list("Findings", cap.findings) + list("Decisions", cap.decisions) +
    list("Unresolved", cap.unresolved) +
    "\nNext step: " + cap.nextStep +
    "\nOriginal source entry IDs (recover with recall_episode): " +
    sourceEntryIds.join(", ");
};

/** Build a V5 initial receipt for `sourceEntryIds` active at `activeUserEntryId`. */
function buildV5Initial(
  branch: SessionLikeEntry[],
  sourceEntryIds: string[],
  activeUserEntryId: string,
  cap: ContinuationCapsule,
  pinnedWorkingState: string,
): any {
  return {
    version: 5, kind: "episode-retirement", mode: "initial",
    sourceEntryIds,
    sourceFingerprints: sourceEntryIds.map((id) => fingerprintEntry(branch.find((e) => e.id === id)!)),
    activeUserEntryId,
    capsule: cap,
    pinnedWorkingState,
    provider: "google", model: "gemini-3.8-flash", reasoningEffort: "medium", promptVersion: "capsule-v5",
    usage: {},
    replacementMetrics: {
      ...rawMetrics(branch, sourceEntryIds),
      capsuleTextBytes: Buffer.byteLength(capsuleText(cap, sourceEntryIds)),
    },
  };
}

/** Build a V5 forward child receipt from a validated parent (exact production math). */
function buildV5Forward(
  branch: SessionLikeEntry[],
  parent: any,
  parentEntryId: string,
  newlyCompletedSourceIds: string[],
  activeUserEntryId: string,
  cap: ContinuationCapsule,
  pinnedWorkingState: string,
): any {
  const sourceEntryIds = [...parent.sourceEntryIds, ...newlyCompletedSourceIds];
  const deltaIds = newlyCompletedSourceIds;
  const cumulative = rawMetrics(branch, sourceEntryIds);
  const delta = rawMetrics(branch, deltaIds);
  const expectedReplacement = { ...cumulative, capsuleTextBytes: Buffer.byteLength(capsuleText(cap, sourceEntryIds)) };
  return {
    version: 5, kind: "episode-retirement", mode: "forward",
    sourceEntryIds,
    sourceFingerprints: sourceEntryIds.map((id) => fingerprintEntry(branch.find((e) => e.id === id)!)),
    activeUserEntryId,
    capsule: cap,
    pinnedWorkingState,
    provider: "google", model: "gemini-3.8-flash", reasoningEffort: "medium", promptVersion: "capsule-v5",
    usage: {},
    replacementMetrics: expectedReplacement,
    generation: (parent.generation ?? 1) + 1,
    parentReceiptEntryId: parentEntryId,
    parentReceiptFingerprint: hashJson(parent),
    priorCapsuleFingerprint: hashJson(parent.capsule),
    newlyCompletedEpisodeEntries: newlyCompletedSourceIds.map((id) => ({ id, fingerprint: fingerprintEntry(branch.find((e) => e.id === id)!) })),
    deltaMetrics: {
      newlyCompletedEpisodeCount: delta.completedEpisodeCount,
      newlyCompletedMessageCount: delta.sourceMessageCount,
      newlyCompletedSourceBytes: delta.sourceMessageBytes,
      cumulativeMessageCount: cumulative.sourceMessageCount,
      cumulativeSourceBytes: cumulative.sourceMessageBytes,
      priorCapsuleTextBytes: Buffer.byteLength(capsuleText(parent.capsule, parent.sourceEntryIds)),
      newCapsuleTextBytes: expectedReplacement.capsuleTextBytes,
    },
  };
}

/** Build a V5 corrective (recompose|deepen) child receipt from a validated parent (exact production math). */
function buildV5Corrective(
  branch: SessionLikeEntry[],
  parent: any,
  parentEntryId: string,
  beforeIds: string[],
  afterIds: string[],
  activeUserEntryId: string,
  cap: ContinuationCapsule,
  pinnedWorkingState: string,
): any {
  const sourceEntryIds = [...beforeIds, ...parent.sourceEntryIds, ...afterIds];
  const cumulative = rawMetrics(branch, sourceEntryIds);
  const earlier = rawMetrics(branch, beforeIds);
  const later = rawMetrics(branch, afterIds);
  const expectedReplacement = { ...cumulative, capsuleTextBytes: Buffer.byteLength(capsuleText(cap, sourceEntryIds)) };
  return {
    version: 5, kind: "episode-retirement", mode: beforeIds.length === 0 ? "recompose" : "deepen",
    sourceEntryIds,
    sourceFingerprints: sourceEntryIds.map((id) => fingerprintEntry(branch.find((e) => e.id === id)!)),
    activeUserEntryId,
    capsule: cap,
    pinnedWorkingState,
    provider: "google", model: "gemini-3.8-flash", reasoningEffort: "medium", promptVersion: "capsule-v5",
    usage: {},
    replacementMetrics: expectedReplacement,
    generation: (parent.generation ?? 1) + 1,
    parentReceiptEntryId: parentEntryId,
    parentReceiptFingerprint: hashJson(parent),
    priorCapsuleFingerprint: hashJson(parent.capsule),
    newlyIncorporatedBeforeParentEntries: beforeIds.map((id) => ({ id, fingerprint: fingerprintEntry(branch.find((e) => e.id === id)!) })),
    newlyCompletedAfterParentEntries: afterIds.map((id) => ({ id, fingerprint: fingerprintEntry(branch.find((e) => e.id === id)!) })),
    compositionMetrics: {
      earlierEpisodeCount: earlier.completedEpisodeCount,
      earlierMessageCount: earlier.sourceMessageCount,
      earlierSourceBytes: earlier.sourceMessageBytes,
      laterEpisodeCount: later.completedEpisodeCount,
      laterMessageCount: later.sourceMessageCount,
      laterSourceBytes: later.sourceMessageBytes,
      cumulativeMessageCount: cumulative.sourceMessageCount,
      cumulativeSourceBytes: cumulative.sourceMessageBytes,
      priorCapsuleTextBytes: Buffer.byteLength(capsuleText(parent.capsule, parent.sourceEntryIds)),
      newCapsuleTextBytes: expectedReplacement.capsuleTextBytes,
    },
  };
}

describe("episode-retirement registration (default, env unset)", () => {
  it("registers only recall_episode + context handler; creation tools are absent", () => {
    const previous = process.env.PI_EPISODE_RETIREMENT_ENABLED;
    delete process.env.PI_EPISODE_RETIREMENT_ENABLED;
    try {
      const h = readPathHarness([]);
      const names = h.tools.map((t) => t.name);
      expect(names).toContain("recall_episode");
      expect(names).not.toContain("inspect_episode_retirement");
      expect(names).not.toContain("retire_episodes");
      expect(Object.keys(h.handlers)).toContain("context");
    } finally {
      if (previous === undefined) delete process.env.PI_EPISODE_RETIREMENT_ENABLED;
      else process.env.PI_EPISODE_RETIREMENT_ENABLED = previous;
    }
  });
});

describe("episode retirement read path (pure helpers)", () => {
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

describe("episode retirement projection + recall via explicit legacy receipts", () => {
  // A minimal V2 receipt planted directly (no creation tool), used by several tests below.
  function v2Receipt(branch: SessionLikeEntry[], activeUserEntryId: string, over: Record<string, unknown> = {}) {
    return {
      version: 2, kind: "episode-retirement",
      sourceEntryIds: ["u1", "a1"],
      sourceFingerprints: branch.slice(0, 2).map(fingerprintEntry),
      activeUserEntryId,
      capsule,
      provider: "google", model: "gemini-3.8-flash", reasoningEffort: "medium",
      promptVersion: "capsule-v2", usage: { totalTokens: 7, cost: { total: 0.02 } },
      ...over,
    };
  }

  it("recall_episode returns inventory and exact original messages", async () => {
    const branch = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")] as SessionLikeEntry[];
    publicSession(branch);
    branch.push({ type: "custom", customType: "episode-retirement", id: "r", parentId: "u2", timestamp: "r", data: v2Receipt(branch, "u2") });
    const h = readPathHarness(branch);
    const inventory = await h.recall.execute("inv", {}, undefined, undefined, h.ctx);
    expect(inventory.isError).toBeUndefined();
    expect(inventory.details.sourceEntryIds).toEqual(["u1", "a1"]);
    expect(inventory.content[0].text).toContain('"id": "u1"');
    const raw = await h.recall.execute("raw", { sourceEntryId: "a1" }, undefined, undefined, h.ctx);
    expect(raw.isError).toBeUndefined();
    const entry = branch.find((e) => e.id === "a1")!;
    expect(JSON.parse(raw.content[0].text)).toEqual({ id: "a1", message: entry.message });
  });

  it("recall_episode refuses when the source entry changed (receipt no longer validates)", async () => {
    const branch = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")] as SessionLikeEntry[];
    publicSession(branch);
    const receipt = v2Receipt(branch, "u2");
    (branch[1].message!.content as Array<{ text: string }>)[0].text = "tampered";
    branch.push({ type: "custom", customType: "episode-retirement", id: "r", parentId: "u2", timestamp: "r", data: receipt });
    const h = readPathHarness(branch);
    // The receipt's sourceFingerprints no longer match, so the chain is not valid and recall refuses.
    await expect(h.recall.execute("inv", {}, undefined, undefined, h.ctx)).rejects.toThrow(/no valid active receipt chain/);
  });

  it("recall_episode refuses a sourceEntryId outside the receipt", async () => {
    const branch = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")] as SessionLikeEntry[];
    publicSession(branch);
    branch.push({ type: "custom", customType: "episode-retirement", id: "r", parentId: "u2", timestamp: "r", data: v2Receipt(branch, "u2") });
    const h = readPathHarness(branch);
    await expect(h.recall.execute("raw", { sourceEntryId: "u2" }, undefined, undefined, h.ctx)).rejects.toThrow(/outside the receipt/);
  });

  it("context handler projects a valid V1 receipt", async () => {
    const branch = [...completeMultiToolEpisode, ...activeEpisode] as SessionLikeEntry[];
    publicSession(branch);
    const receipt: EpisodeRetirementReceipt = {
      version: 1, kind: "episode-retirement",
      sourceEntryIds: completeMultiToolEpisode.map((e) => e.id),
      sourceFingerprints: completeMultiToolEpisode.map(fingerprintEntry),
      activeUserEntryId: "u2", capsule,
    };
    branch.push({ type: "custom", customType: "episode-retirement", id: "r", parentId: "u2", timestamp: "r", data: receipt });
    const h = readPathHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    const projected = await h.handlers.context(event, h.ctx);
    expect(projected.messages).toHaveLength(1);
    expect(projected.messages[0].content[0].text).toContain("CONTINUATION CAPSULE");
  });

  it("accepts a valid V2 receipt without replacement metrics", async () => {
    const branch = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")] as SessionLikeEntry[];
    publicSession(branch);
    branch.push({ type: "custom", customType: "episode-retirement", id: "r", parentId: "u2", timestamp: "r", data: v2Receipt(branch, "u2") });
    const h = readPathHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    expect((await h.handlers.context(event, h.ctx)).messages).toHaveLength(1);
  });

  it.each([
    ["malformed", { sourceMessageBytes: "2" }],
    ["additional key", { extra: 1 }],
    ["zero completed episode count", { completedEpisodeCount: 0 }],
    ["zero source message count", { sourceMessageCount: 0 }],
  ])("V2 receipt with %s replacement metrics fails open", async (_name, replacementMetrics) => {
    const branch = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")] as SessionLikeEntry[];
    publicSession(branch);
    branch.push({
      type: "custom", customType: "episode-retirement", id: "r", parentId: "u2", timestamp: "r",
      data: v2Receipt(branch, "u2", {
        replacementMetrics: { completedEpisodeCount: 1, sourceMessageCount: 2, sourceMessageBytes: 3, capsuleTextBytes: 4, ...(replacementMetrics as object) },
      }),
    });
    const h = readPathHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
  });

  it("malformed V2 fails open while V1 projects", async () => {
    const branch = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")] as SessionLikeEntry[];
    publicSession(branch);
    const receipt: any = {
      version: 1, kind: "episode-retirement", sourceEntryIds: ["u1", "a1"],
      sourceFingerprints: branch.slice(0, 2).map(fingerprintEntry), activeUserEntryId: "u2", capsule,
    };
    branch.push({ type: "custom", customType: "episode-retirement", id: "r", parentId: "u2", timestamp: "r", data: receipt });
    const h = readPathHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    expect((await h.handlers.context(event, h.ctx)).messages).toHaveLength(1);
    for (const bad of [{ provider: "" }, { model: "" }, { promptVersion: "bad" }, { sourceFingerprints: ["bad", receipt.sourceFingerprints[1]] }, { sourceEntryIds: ["u1", "u1"] }]) {
      branch[branch.length - 1].data = {
        ...receipt, version: 2, provider: "google", model: "x", reasoningEffort: "medium", promptVersion: "capsule-v2", usage: {}, ...bad,
      };
      expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
    }
  });

  it("projects a valid V5 initial receipt (pin + capsule) and fails open on a malformed latest V5", async () => {
    // A single valid V5 initial receipt, built directly (no creation tool).
    const branch = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")] as SessionLikeEntry[];
    publicSession(branch);
    const sourceIds = ["u1", "a1"];
    const v5Initial: any = {
      version: 5, kind: "episode-retirement", mode: "initial",
      sourceEntryIds: sourceIds,
      sourceFingerprints: branch.filter((e) => sourceIds.includes(e.id)).map(fingerprintEntry),
      activeUserEntryId: "u2",
      capsule: { ...capsule, objective: "V5 capsule objective" },
      pinnedWorkingState: "the V5 pin",
      provider: "google", model: "gemini-3.8-flash", reasoningEffort: "medium", promptVersion: "capsule-v5", usage: {},
      replacementMetrics: { completedEpisodeCount: 1, sourceMessageCount: 2, sourceMessageBytes: 1, capsuleTextBytes: 1 },
    };
    branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u2", timestamp: "r1", data: v5Initial });
    const h = readPathHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    const projected = await h.handlers.context(event, h.ctx);
    const text = JSON.stringify(projected.messages);
    expect((text.match(/PINNED WORKING STATE/g) ?? [])).toHaveLength(1);
    expect(text).toContain("the V5 pin");
    expect(text).toContain("V5 capsule objective");

    // A malformed latest V5 (invalid mode) fails open: the context handler returns undefined.
    branch[branch.length - 1].data = { ...v5Initial, mode: "invalid" };
    expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
  });
});


describe("episode retirement authentic V5 chains (real projection + recall)", () => {
  // Plain SessionLikeEntry branches + publicSession, matching the read-path handler contract
  // (resolvedSlots over buildContextEntries). Receipts are built by buildV5Initial/Forward/Corrective,
  // which replicate production receipt math, then validated by the real context handler and
  // recall_episode. This exercises the ACTUAL projection + recall paths, not just validators.

  function chainHarness(branch: SessionLikeEntry[]) {
    const session = publicSession(branch);
    const h = readPathHarness(branch);
    // readPathHarness built its own publicSession; reuse this branch via sessionManager override.
    h.ctx.sessionManager = session;
    return { h, session };
  }

  it("V5 initial -> forward: projects only the latest pin/capsule and recalls cumulative provenance", async () => {
    const branch: SessionLikeEntry[] = [
      user("u1", "first settled"), assistant("a1", "first done"), user("u2", "first active"),
    ];
    publicSession(branch);
    const initial = buildV5Initial(branch, ["u1", "a1"], "u2", { ...capsule, objective: "first V5 capsule" }, "first pin");
    branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u2", timestamp: "r1", data: initial } as SessionLikeEntry);

    branch.push(assistant("a2", "first active done"), user("u3", "second active"));
    publicSession(branch);
    const forward = buildV5Forward(branch, initial, "r1", ["u2", "a2"], "u3", { ...capsule, objective: "second V5 capsule" }, "second pin");
    branch.push({ type: "custom", customType: "episode-retirement", id: "r2", parentId: "u3", timestamp: "r2", data: forward } as SessionLikeEntry);
    publicSession(branch);

    const { h } = chainHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    const projected = await h.handlers.context(event, h.ctx);
    const text = JSON.stringify(projected.messages);
    expect((text.match(/PINNED WORKING STATE/g) ?? [])).toHaveLength(1);
    expect(text).toContain("second pin");
    expect(text).toContain("second V5 capsule");
    expect(text).not.toContain("first pin");
    expect(text).not.toContain("first V5 capsule");

    expect(forward.sourceEntryIds).toEqual(["u1", "a1", "u2", "a2"]);
    expect(forward.generation).toBe(2);
    expect(forward.parentReceiptEntryId).toBe("r1");
    expect(forward.deltaMetrics.newlyCompletedEpisodeCount).toBe(1);
    expect(forward.deltaMetrics.newlyCompletedMessageCount).toBe(2);

    const inventory = await h.recall.execute("inv", {}, undefined, undefined, h.ctx);
    expect(inventory.details.sourceEntryIds).toEqual(forward.sourceEntryIds);
    const raw = await h.recall.execute("raw", { sourceEntryId: "a2" }, undefined, undefined, h.ctx);
    expect(JSON.parse(raw.content[0].text)).toEqual({ id: "a2", message: branch.find((e) => e.id === "a2")!.message });
  });

  it("V5 initial -> deepen: latest corrective projects; opaque prefix preserved; cumulative recall spans before+parent+after", async () => {
    const branch: SessionLikeEntry[] = [
      user("uP", "opaque prefix"), assistant("aP", "prefix done"),
      user("uA", "A"), assistant("aA", "A done"),
      user("uB", "B"), assistant("aB", "B done"),
      user("u1", "first active"),
    ];
    publicSession(branch);
    const initial = buildV5Initial(branch, ["uB", "aB"], "u1", { ...capsule, objective: "B capsule" }, "B pin");
    branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u1", timestamp: "r1", data: initial } as SessionLikeEntry);

    branch.push(assistant("a1", "retirement assessment complete"), user("u2", "recompose all"));
    publicSession(branch);
    const deepen = buildV5Corrective(branch, initial, "r1", ["uA", "aA"], ["u1", "a1"], "u2", { ...capsule, objective: "deepen capsule" }, "deepen pin");
    branch.push({ type: "custom", customType: "episode-retirement", id: "r2", parentId: "u2", timestamp: "r2", data: deepen } as SessionLikeEntry);
    publicSession(branch);

    expect(deepen.mode).toBe("deepen");
    expect(deepen.sourceEntryIds).toEqual(["uA", "aA", "uB", "aB", "u1", "a1"]);
    expect(new Set(deepen.sourceEntryIds).size).toBe(6);

    const { h } = chainHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    const projected = await h.handlers.context(event, h.ctx);
    // Opaque prefix preserved by exact event reference.
    expect(projected.messages.slice(0, 2)).toEqual(event.messages.slice(0, 2));
    expect(projected.messages[0]).toBe(event.messages[0]);
    const text = JSON.stringify(projected.messages);
    expect((text.match(/CONTINUATION CAPSULE/g) ?? [])).toHaveLength(1);
    expect((text.match(/PINNED WORKING STATE/g) ?? [])).toHaveLength(1);
    expect(text).toContain("deepen pin");
    expect(text).toContain("deepen capsule");
    expect(text).not.toContain("B capsule");

    const inventory = await h.recall.execute("inv", {}, undefined, undefined, h.ctx);
    expect(inventory.details.sourceEntryIds).toEqual(["uA", "aA", "uB", "aB", "u1", "a1"]);
    const raw = await h.recall.execute("raw", { sourceEntryId: "a1" }, undefined, undefined, h.ctx);
    expect(JSON.parse(raw.content[0].text).id).toBe("a1");
  });

  it("V5 recompose (no earlier additions): projects and recalls the recomposed source set", async () => {
    const branch: SessionLikeEntry[] = [
      user("uA", "A"), assistant("aA", "A done"),
      user("uB", "B"), assistant("aB", "B done"),
      user("u1", "first active"),
    ];
    publicSession(branch);
    const initial = buildV5Initial(branch, ["uB", "aB"], "u1", { ...capsule, objective: "B capsule" }, "B pin");
    branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u1", timestamp: "r1", data: initial } as SessionLikeEntry);

    branch.push(assistant("a1", "assessment complete"), user("u2", "recompose"));
    publicSession(branch);
    const recompose = buildV5Corrective(branch, initial, "r1", [], ["u1", "a1"], "u2", { ...capsule, objective: "recompose capsule" }, "recompose pin");
    branch.push({ type: "custom", customType: "episode-retirement", id: "r2", parentId: "u2", timestamp: "r2", data: recompose } as SessionLikeEntry);
    publicSession(branch);

    expect(recompose.mode).toBe("recompose");
    expect(recompose.sourceEntryIds).toEqual(["uB", "aB", "u1", "a1"]);

    const { h } = chainHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    const projected = await h.handlers.context(event, h.ctx);
    const text = JSON.stringify(projected.messages);
    expect((text.match(/CONTINUATION CAPSULE/g) ?? [])).toHaveLength(1);
    expect(text).toContain("recompose pin");
    expect(text).toContain("recompose capsule");
    const inventory = await h.recall.execute("inv", {}, undefined, undefined, h.ctx);
    expect(inventory.details.sourceEntryIds).toEqual(["uB", "aB", "u1", "a1"]);
  });

  it("fails open when the latest receipt is malformed (tampered forward delta)", async () => {
    const branch: SessionLikeEntry[] = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")];
    publicSession(branch);
    const initial = buildV5Initial(branch, ["u1", "a1"], "u2", { ...capsule }, "pin");
    branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u2", timestamp: "r1", data: initial } as SessionLikeEntry);
    branch.push(assistant("a2", "done"), user("u3", "active2"));
    publicSession(branch);
    const forward = buildV5Forward(branch, initial, "r1", ["u2", "a2"], "u3", { ...capsule }, "pin2");
    forward.deltaMetrics.newlyCompletedEpisodeCount = 999; // tamper -> malformed latest
    branch.push({ type: "custom", customType: "episode-retirement", id: "r2", parentId: "u3", timestamp: "r2", data: forward } as SessionLikeEntry);
    publicSession(branch);

    const { h } = chainHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
    await expect(h.recall.execute("inv", {}, undefined, undefined, h.ctx)).rejects.toThrow(/no valid active receipt chain/);
  });

  it("recall refuses a source entry that changed after the receipt (fingerprint tamper)", async () => {
    const branch: SessionLikeEntry[] = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")];
    publicSession(branch);
    const initial = buildV5Initial(branch, ["u1", "a1"], "u2", { ...capsule }, "pin");
    branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u2", timestamp: "r1", data: initial } as SessionLikeEntry);
    (branch[1].message!.content as Array<{ text: string }>)[0].text = "tampered";
    publicSession(branch);

    const { h } = chainHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
    await expect(h.recall.execute("inv", {}, undefined, undefined, h.ctx)).rejects.toThrow(/no valid active receipt chain/);
  });

  it("preserves an opaque custom-message prefix while projecting a valid V2 receipt", async () => {
    const raw = [
      { type: "custom", customType: "discuss", id: "mode", parentId: null, timestamp: "mode" },
      { type: "custom_message", customType: "discuss", content: "Discuss mode instructions", display: false, id: "discuss-message", parentId: "mode", timestamp: "cm" },
      user("u1", "settled request"), assistant("a1", "settled answer"), user("u2", "active request"),
    ] as SessionLikeEntry[];
    publicSession(raw);
    const resolved = buildSessionContext(publicSession(raw).getEntries() as any, "u2").messages;
    const receipt = {
      version: 2, kind: "episode-retirement",
      sourceEntryIds: ["u1", "a1"],
      sourceFingerprints: [fingerprintEntry(raw[2]), fingerprintEntry(raw[3])],
      activeUserEntryId: "u2",
      capsule,
      provider: "google", model: "gemini-3.8-flash", reasoningEffort: "medium", promptVersion: "capsule-v2", usage: {},
    };
    raw.push({ type: "custom", customType: "episode-retirement", id: "receipt", parentId: "u2", timestamp: "receipt", data: receipt } as SessionLikeEntry);
    publicSession(raw);
    const { h } = chainHarness(raw);
    const next = await h.handlers.context({ messages: resolved }, h.ctx);
    expect(next.messages).toHaveLength(2);
    expect(next.messages[0]).toBe(resolved[0]);
    expect(next.messages[1].content[0].text).toContain("CONTINUATION CAPSULE");
  });
});

describe("native handoff / legacy compatibility: receipt absent from resulting branch", () => {
  // When a branch switch drops the receipt (receipt NOT on the resulting branch), the legacy
  // read path must be inert there: the context handler returns undefined (no projection) and
  // recall_episode refuses. When the receipt IS on the branch, projection still works. Neither
  // path performs any model/provider lookup (readPathHarness throws on modelRegistry.find).

  it("context handler projects nothing and recall refuses when no receipt is on the branch", async () => {
    // Branch built entirely BEFORE any retirement: no receipt entry present.
    const branch: SessionLikeEntry[] = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")];
    publicSession(branch);
    const h = readPathHarness(branch);
    const event = { messages: branch.map((e) => e.message) };
    // No receipt -> assessment "none" -> handler returns undefined (no projection).
    expect(await h.handlers.context(event, h.ctx)).toBeUndefined();
    // Recall refuses: no valid active receipt chain reachable here.
    await expect(h.recall.execute("inv", {}, undefined, undefined, h.ctx)).rejects.toThrow(/no valid active receipt chain/);
  });

  it("projects the capsule and recalls provenance when a valid receipt IS on the branch (no provider calls)", async () => {
    const branch: SessionLikeEntry[] = [user("u1", "settled"), assistant("a1", "done"), user("u2", "active")];
    publicSession(branch);
    const initial = buildV5Initial(branch, ["u1", "a1"], "u2", { ...capsule }, "pin");
    branch.push({ type: "custom", customType: "episode-retirement", id: "r1", parentId: "u2", timestamp: "r1", data: initial } as SessionLikeEntry);
    publicSession(branch);
    const h = readPathHarness(branch);
    const event = { messages: branch.filter((e) => e.type === "message").map((e) => e.message) };
    const projected = await h.handlers.context(event, h.ctx);
    expect(projected).toBeDefined();
    expect(JSON.stringify(projected.messages)).toContain("CONTINUATION CAPSULE");
    const inventory = await h.recall.execute("inv", {}, undefined, undefined, h.ctx);
    expect(inventory.details.sourceEntryIds).toEqual(["u1", "a1"]);
    // readPathHarness.ctx.modelRegistry.find throws if invoked, so reaching here proves no provider lookup.
  });
});
