import { describe, expect, it } from "vitest";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
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
    const ctx = { sessionManager: { getBranch: () => branch, getTree: () => [] } };
    const accepted = await retire.execute("call", { latestCompletedEpisodes: 1, capsule }, undefined, undefined, ctx);
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
});
