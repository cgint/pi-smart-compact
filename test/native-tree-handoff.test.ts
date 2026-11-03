import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  HANDOFF_SCHEMA,
  HANDOFF_TOOL,
  listTargetCandidates,
  parseHandoffDetails,
  sha256Utf8,
  validateHandoff,
  verifyFileBytes,
  type BranchEntry,
} from "../src/native-tree-handoff.js";
import registerNativeTreeHandoff, { TARGETS_TOOL } from "../src/native-tree-handoff.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const ts = () => new Date().toISOString();
const asst = (id: string, parentId: string | null, text = "a", extra: Record<string, unknown> = {}): BranchEntry => ({
  type: "message",
  id,
  parentId,
  timestamp: ts(),
  message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", ...extra },
});
const user = (id: string, parentId: string | null): BranchEntry => ({
  type: "message",
  id,
  parentId,
  timestamp: ts(),
  message: { role: "user", content: "q" },
});
const toolCallAsst = (id: string, parentId: string | null, calls: { id: string; name: string }[]): BranchEntry => ({
  type: "message",
  id,
  parentId,
  timestamp: ts(),
  message: {
    role: "assistant",
    content: calls.map((c) => ({ type: "toolCall", id: c.id, name: c.name, arguments: {} })),
    stopReason: "toolUse",
  },
});
const recordResult = (id: string, parentId: string | null, details: unknown, toolCallId = "call-h", isError = false): BranchEntry => ({
  type: "message",
  id,
  parentId,
  timestamp: ts(),
  message: { role: "toolResult", toolCallId, toolName: HANDOFF_TOOL, content: [], details, isError },
});
const details = (targetId: string, text: string, handoffId = randomUUID()) => ({
  schema: HANDOFF_SCHEMA,
  handoffId,
  targetId,
  text,
  sha256: sha256Utf8(text),
});

/** A valid branch: user -> target assistant -> user -> toolCall(record) -> record result -> final assistant. */
function validBranch(text = "keep this") {
  const d = details("A1", text);
  const branch: BranchEntry[] = [
    user("U1", null),
    asst("A1", "U1", "first answer"),
    user("U2", "A1"),
    toolCallAsst("T1", "U2", [{ id: "call-h", name: HANDOFF_TOOL }]),
    recordResult("R1", "T1", d),
    asst("F1", "R1", "recorded"),
  ];
  return { branch, d, leaf: "F1" };
}

describe("validateHandoff (preflight, pure)", () => {
  it("accepts a valid same-turn record and returns the validated target", () => {
    const { branch, d, leaf } = validBranch();
    const r = validateHandoff(branch, leaf, d.handoffId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target.id).toBe("A1");
      expect(r.record.text).toBe("keep this");
      expect(r.finalResponseId).toBe("F1");
    }
  });

  it("accepts metadata entries after the final response", () => {
    const { branch, d, leaf } = validBranch();
    branch.push({ type: "label", id: "L1", parentId: "F1", timestamp: ts(), targetId: "A1", label: "x" });
    branch.push({ type: "session_info", id: "S1", parentId: "L1", timestamp: ts(), name: "n" });
    expect(validateHandoff(branch, "S1", d.handoffId).ok).toBe(true);
  });

  it.each([
    ["no handoff id", "", "NO_HANDOFF_ID"],
    ["unknown id", randomUUID(), "NO_VALID_HANDOFF"],
  ])("rejects %s", (_name, id, code) => {
    const { branch, leaf } = validBranch();
    const r = validateHandoff(branch, leaf, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it("rejects a record with an errored tool result as absent", () => {
    const d = details("A1", "err");
    const branch = [user("U1", null), asst("A1", "U1"), user("U2", "A1"), toolCallAsst("T1", "U2", [{ id: "call-h", name: HANDOFF_TOOL }]), recordResult("R1", "T1", d, "call-h", true), asst("F1", "R1")];
    const r = validateHandoff(branch, "F1", d.handoffId);
    expect(!r.ok && r.code).toBe("NO_VALID_HANDOFF");
  });

  it("rejects a tampered record (sha256 mismatch) as malformed", () => {
    const d = { ...details("A1", "orig"), text: "tampered" };
    const branch = [user("U1", null), asst("A1", "U1"), user("U2", "A1"), toolCallAsst("T1", "U2", [{ id: "call-h", name: HANDOFF_TOOL }]), recordResult("R1", "T1", d), asst("F1", "R1")];
    const r = validateHandoff(branch, "F1", d.handoffId);
    expect(!r.ok && r.code).toBe("HANDOFF_MALFORMED");
  });

  it("rejects an older record when a later one exists (superseded)", () => {
    const older = details("A1", "older");
    const newer = details("A1", "newer");
    const branch = [
      user("U1", null), asst("A1", "U1"),
      user("U2", "A1"), toolCallAsst("T1", "U2", [{ id: "call-1", name: HANDOFF_TOOL }]), recordResult("R1", "T1", older, "call-1"), asst("F1", "R1"),
      user("U3", "F1"), toolCallAsst("T2", "U3", [{ id: "call-2", name: HANDOFF_TOOL }]), recordResult("R2", "T2", newer, "call-2"), asst("F2", "R2"),
    ];
    const r = validateHandoff(branch, "F2", older.handoffId);
    expect(!r.ok && r.code).toBe("HANDOFF_SUPERSEDED");
  });

  it("rejects a target that is a user message", () => {
    const d = details("U1", "user target");
    const branch = [user("U1", null), user("U2", "U1"), toolCallAsst("T1", "U2", [{ id: "call-h", name: HANDOFF_TOOL }]), recordResult("R1", "T1", d), asst("F1", "R1")];
    const r = validateHandoff(branch, "F1", d.handoffId);
    expect(!r.ok && r.code).toBe("TARGET_NOT_ASSISTANT");
  });

  it("rejects a target that is not on the path before the record", () => {
    const d = details("ZZ", "missing");
    const branch = [user("U1", null), asst("A1", "U1"), user("U2", "A1"), toolCallAsst("T1", "U2", [{ id: "call-h", name: HANDOFF_TOOL }]), recordResult("R1", "T1", d), asst("F1", "R1")];
    const r = validateHandoff(branch, "F1", d.handoffId);
    expect(!r.ok && r.code).toBe("TARGET_NOT_ON_PATH");
  });

  it("rejects other tool calls in the same batch as the record", () => {
    const d = details("A1", "batch");
    const branch = [user("U1", null), asst("A1", "U1"), user("U2", "A1"), toolCallAsst("T1", "U2", [{ id: "call-h", name: HANDOFF_TOOL }, { id: "call-x", name: "read" }]), recordResult("R1", "T1", d), asst("F1", "R1")];
    const r = validateHandoff(branch, "F1", d.handoffId);
    expect(!r.ok && r.code).toBe("EFFECTFUL_AFTER_RECORD");
  });

  it("rejects a second assistant response after the record and a non-stop final response", () => {
    const { branch, d } = validBranch();
    const twice = [...branch, asst("F2", "F1")];
    const r1 = validateHandoff(twice, "F2", d.handoffId);
    expect(!r1.ok && r1.code).toBe("MULTIPLE_RESPONSES_AFTER_RECORD");
    const { branch: b2, d: d2 } = validBranch();
    b2[b2.length - 1] = asst("F1", "R1", "x", { stopReason: "length" });
    const r2 = validateHandoff(b2, "F1", d2.handoffId);
    expect(!r2.ok && r2.code).toBe("NOT_NORMAL_STOP");
  });

  it("rejects custom_message and branch_summary after the record as non-metadata", () => {
    const { branch, d } = validBranch();
    const withCustom = [...branch, { type: "custom_message", id: "C1", parentId: "F1", timestamp: ts(), customType: "x", content: "y", display: true } as BranchEntry];
    const r = validateHandoff(withCustom, "C1", d.handoffId);
    expect(!r.ok && r.code).toBe("NON_METADATA_AFTER_RECORD");
  });
});

describe("listTargetCandidates", () => {
  it("lists assistant ancestors newest first, excluding the leaf and users", () => {
    const branch = [user("U1", null), asst("A1", "U1"), user("U2", "A1"), asst("A2", "U2")];
    expect(listTargetCandidates(branch, "A2").map((e) => e.id)).toEqual(["A1"]);
  });
});

describe("parseHandoffDetails", () => {
  it("accepts a well-formed record and rejects bad schema, id, or hash", () => {
    const ok = details("A1", "t");
    expect(parseHandoffDetails(ok)).toBeDefined();
    expect(parseHandoffDetails({ ...ok, schema: "other" })).toBeUndefined();
    expect(parseHandoffDetails({ ...ok, handoffId: "not-a-uuid" })).toBeUndefined();
    expect(parseHandoffDetails({ ...ok, sha256: "x" })).toBeUndefined();
    expect(parseHandoffDetails(undefined)).toBeUndefined();
  });
});

describe("verifyFileBytes", () => {
  const before = Buffer.from('{"type":"session","id":"s"}\n{"type":"message","id":"m1"}\n');
  const d = { targetId: "A1", text: "t", handoffId: "h", sha256: sha256Utf8("t") };
  const summaryLine = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ type: "branch_summary", id: "B1", parentId: "A1", summary: "t", fromHook: true, details: { handoffId: "h", sha256: sha256Utf8("t") }, ...over }) + "\n";

  it("passes when old bytes are a prefix and the appended summary matches", () => {
    const after = Buffer.concat([before, Buffer.from(summaryLine())]);
    expect(verifyFileBytes(before, after, { summaryEntryId: "B1", ...d }).ok).toBe(true);
  });

  it("fails when an existing byte changed", () => {
    const mutated = Buffer.from(before.toString().replace('"m1"', '"mX"'));
    const after = Buffer.concat([mutated, Buffer.from(summaryLine())]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/prefix changed/);
  });

  it("fails on wrong fromHook, parent, or text", () => {
    const after = Buffer.concat([before, Buffer.from(summaryLine({ fromHook: false, parentId: "X", summary: "other" }))]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/fromHook|parentId|summary text/);
  });
});

describe("record tool guard (row 14, tool-level; leaf-equal target cannot reach the command)", () => {
  function captureTools(): Map<string, any> {
    const tools = new Map<string, any>();
    const fakePi = {
      registerTool: (t: any) => tools.set(t.name, t),
      on: () => {},
      registerCommand: () => {},
    } as any;
    registerNativeTreeHandoff(fakePi);
    return tools;
  }

  it("rejects a target equal to the current leaf before anything is recorded", async () => {
    const sm = SessionManager.inMemory(process.cwd());
    const u = sm.appendMessage({ role: "user", content: "q", timestamp: Date.now() } as never);
    const a = sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "a" }], api: "x", provider: "x", model: "x", usage: {}, stopReason: "stop", timestamp: Date.now() } as never);
    void u;
    const tools = captureTools();
    const record = tools.get(HANDOFF_TOOL);
    await expect(record.execute("c", { targetId: a, text: "t" }, undefined, undefined, { sessionManager: sm })).rejects.toThrow(/is the current leaf/);
  });

  it("rejects a user-message target and blank text at record time", async () => {
    const sm = SessionManager.inMemory(process.cwd());
    const u = sm.appendMessage({ role: "user", content: "q", timestamp: Date.now() } as never);
    sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "a" }], api: "x", provider: "x", model: "x", usage: {}, stopReason: "stop", timestamp: Date.now() } as never);
    const record = captureTools().get(HANDOFF_TOOL);
    await expect(record.execute("c", { targetId: u, text: "t" }, undefined, undefined, { sessionManager: sm })).rejects.toThrow(/not an assistant message/);
    // A valid, non-leaf assistant target, so only the blank-text check can reject this call.
    const valid = sm.getLeafId()!;
    sm.appendMessage({ role: "user", content: "follow-up", timestamp: Date.now() } as never);
    sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "more" }], api: "x", provider: "x", model: "x", usage: {}, stopReason: "stop", timestamp: Date.now() } as never);
    expect(sm.getLeafId()).not.toBe(valid);
    await expect(record.execute("c", { targetId: valid, text: "   " }, undefined, undefined, { sessionManager: sm })).rejects.toThrow(/must not be blank/);
  });

  it("registers the targets inspection tool", () => {
    expect(captureTools().has(TARGETS_TOOL)).toBe(true);
  });
});

describe("verifyFileBytes: strict append-set policy (source-grounded metadata accepted, anomalies rejected, malformed JSON controlled)", () => {
  const before = Buffer.from('{"type":"session","id":"s"}\n{"type":"message","id":"m1"}\n');
  const d = { targetId: "A1", text: "t", handoffId: "h", sha256: sha256Utf8("t") };
  const summaryLine = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ type: "branch_summary", id: "B1", parentId: "A1", summary: "t", fromHook: true, details: { handoffId: "h", sha256: sha256Utf8("t") }, ...over }) + "\n";

  it("rejects a duplicate summary id as an anomaly (controlled, not thrown)", () => {
    const dup = JSON.stringify({ type: "branch_summary", id: "B1", parentId: "A1", summary: "t", fromHook: true, details: { handoffId: "h", sha256: sha256Utf8("t") } }) + "\n";
    const after = Buffer.concat([before, Buffer.from(summaryLine() + dup)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/expected exactly one/);
  });

  it("rejects a summary id that already exists in the pre-commit file (replay, not a new summary)", () => {
    const beforeWithB1 = Buffer.from('{"type":"session","id":"s"}\n{"type":"message","id":"B1"}\n');
    const after = Buffer.concat([beforeWithB1, Buffer.from(summaryLine())]);
    const r = verifyFileBytes(beforeWithB1, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/already exists in the pre-commit file/);
  });

  it("rejects an appended line with a numeric id as malformed (id must be a non-empty string)", () => {
    const bad = JSON.stringify({ type: "branch_summary", id: 123, parentId: "A1", summary: "t", fromHook: true, details: { handoffId: "h", sha256: sha256Utf8("t") } }) + "\n";
    const after = Buffer.concat([before, Buffer.from(bad)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not a well-formed session entry/);
  });

  it("rejects an appended line with a non-string type as malformed (type must be a non-empty string)", () => {
    const bad = JSON.stringify({ type: 42, id: "X1", parentId: "A1" }) + "\n";
    const after = Buffer.concat([before, Buffer.from(summaryLine() + bad)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not a well-formed session entry/);
  });

  it("rejects an appended array line as malformed (must be an object)", () => {
    const bad = JSON.stringify(["B1", "branch_summary"]) + "\n";
    const after = Buffer.concat([before, Buffer.from(summaryLine() + bad)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not a well-formed session entry/);
  });

  it("rejects a conflicting summary (same id, wrong parent or text) as an anomaly", () => {
    const conflict = JSON.stringify({ type: "branch_summary", id: "B1", parentId: "WRONG", summary: "other text", fromHook: true, details: { handoffId: "h", sha256: sha256Utf8("t") } }) + "\n";
    const after = Buffer.concat([before, Buffer.from(conflict)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/parentId|summary text/);
  });

  it("rejects an unexplained message append as an anomaly", () => {
    const msg = JSON.stringify({ type: "message", id: "M1", parentId: "A1", timestamp: "2024-01-01T00:00:00.000Z", message: { role: "user", content: "x" } }) + "\n";
    const after = Buffer.concat([before, Buffer.from(summaryLine() + msg)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/unexplained appended entries/);
  });

  it("rejects an unexplained compaction append as an anomaly", () => {
    const comp = JSON.stringify({ type: "compaction", id: "C1", parentId: "A1", timestamp: "2024-01-01T00:00:00.000Z", summary: "s", firstKeptEntryId: "A1", tokensBefore: 10 }) + "\n";
    const after = Buffer.concat([before, Buffer.from(summaryLine() + comp)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/unexplained appended entries/);
  });

  it("rejects a malformed appended JSON line as a controlled reason, not a throw", () => {
    const malformed = '{"type":"branch_summary","id":"B1"\n';
    const after = Buffer.concat([before, Buffer.from(malformed)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not valid JSON/);
    expect(r.reasons.join(" ")).not.toContain("branch_summary");
  });

  it("rejects a malformed appended JSON line with a valid summary present as a controlled reason", () => {
    const malformed = '{broken\n';
    const after = Buffer.concat([before, Buffer.from(summaryLine() + malformed)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not valid JSON/);
    expect(r.reasons.join(" ")).not.toContain("broken");
  });

  it("accepts a cache-warming usage entry appended alongside the summary (source-grounded native metadata)", () => {
    const usage = JSON.stringify({ type: "usage", id: "U1", parentId: "B1", timestamp: "2024-01-01T00:00:00.000Z", kind: "cache_warm", provider: "p", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }) + "\n";
    const after = Buffer.concat([before, Buffer.from(summaryLine() + usage)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it("rejects a usage entry with a duplicate id as an anomaly", () => {
    const usage1 = JSON.stringify({ type: "usage", id: "U1", parentId: "B1", timestamp: "2024-01-01T00:00:00.000Z", kind: "cache_warm", provider: "p", model: "m", usage: {} }) + "\n";
    const usage2 = JSON.stringify({ type: "usage", id: "U1", parentId: "B1", timestamp: "2024-01-01T00:00:01.000Z", kind: "cache_warm", provider: "p", model: "m", usage: {} }) + "\n";
    const after = Buffer.concat([before, Buffer.from(summaryLine() + usage1 + usage2)]);
    const r = verifyFileBytes(before, after, { summaryEntryId: "B1", ...d });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/unexplained appended entries/);
  });
});
