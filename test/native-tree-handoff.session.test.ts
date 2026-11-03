import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, rmSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import registerNativeTreeHandoff, {
  CONFIRM_TIMEOUT_MS,
  hasUsableModel,
  HANDOFF_COMMAND,
  HANDOFF_SCHEMA,
  HANDOFF_TOOL,
  TARGETS_TOOL,
  sha256Utf8,
  type NativeTreeHandoffDependencies,
} from "../src/native-tree-handoff.js";
import {
  createHarness,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  lastAssistantId,
  readBytes,
  type Extension,
  type Harness,
} from "./native-tree-harness.js";

const ours = (deps?: NativeTreeHandoffDependencies): Extension => (pi) => registerNativeTreeHandoff(pi, deps);

/** Observer registered in the real runner at the position the caller chooses. */
function spy(log: { before: number; trees: any[] }): Extension {
  return (pi) => {
    pi.on("session_before_tree", () => {
      log.before++;
      return undefined;
    });
    pi.on("session_tree", (e) => {
      log.trees.push(e);
    });
  };
}

/** Competitor handler returning a fixed result (real runner ordering decides who wins). */
function competitor(result: unknown): Extension {
  return (pi) => {
    pi.on("session_before_tree", () => result as never);
  };
}

const newLog = () => ({ before: 0, trees: [] as any[] });

async function buildHistory(h: Harness): Promise<string> {
  h.core.setResponses([fauxAssistantMessage(fauxText("A1 answer"))]);
  await h.session.prompt("first question");
  const target = lastAssistantId(h.sessionManager);
  h.core.setResponses([fauxAssistantMessage(fauxText("A2 answer"))]);
  await h.session.prompt("second question");
  return target;
}

/** Real handoff turn: targets -> record -> same-turn final response. Returns the stored handoffId. */
async function recordHandoff(h: Harness, targetId: string, text: string): Promise<string> {
  h.core.setResponses([
    fauxAssistantMessage([fauxToolCall(TARGETS_TOOL, {}, { id: "call-t" })]),
    fauxAssistantMessage([fauxToolCall(HANDOFF_TOOL, { targetId, text }, { id: "call-h" })]),
    fauxAssistantMessage(fauxText("handoff recorded")),
  ]);
  await h.session.prompt("prepare a handoff");
  return handoffRecords(h).filter((r) => !r.isError).at(-1)!.details.handoffId;
}

function handoffRecords(h: Harness): { id: string; details: any; isError: boolean }[] {
  return h.sessionManager
    .getEntries()
    .flatMap((e: any) =>
      e.type === "message" && e.message?.role === "toolResult" && e.message.toolName === HANDOFF_TOOL
        ? [{ id: e.id, details: e.message.details, isError: e.message.isError === true }]
        : [],
    );
}

const branchSummaries = (sm: SessionManager): any[] => sm.getEntries().filter((e: any) => e.type === "branch_summary");

function runCommand(h: Harness, args: string): Promise<void> {
  const token = h.artifactLog?.before("pre-command");
  const result = h.session.prompt(`/${HANDOFF_COMMAND} ${args}`);
  return result.then(
    () => { if (token) h.artifactLog?.after(token, "post-command"); },
    (err) => { if (token) h.artifactLog?.after(token, "post-command-error"); throw err; },
  );
}

const lastNotice = (h: Harness): string => h.notices.at(-1)?.message ?? "<none>";

function clearProviderKeys(): Record<string, string> {
  const saved: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    if (/(API_KEY|TOKEN|SECRET|_KEY)$/.test(key)) {
      saved[key] = process.env[key] as string;
      delete process.env[key];
    }
  }
  return saved;
}

function restoreEnv(saved: Record<string, string>): void {
  Object.assign(process.env, saved);
}

/** Appends a synthetic entry through the real SessionManager (used only for negative/metadata shapes). */
function appendToolResult(sm: SessionManager, details: unknown, parentLeaf: string | null): void {
  void parentLeaf;
  sm.appendMessage({
    role: "toolResult",
    toolCallId: `synthetic-${randomUUID()}`,
    toolName: HANDOFF_TOOL,
    content: [{ type: "text", text: "synthetic" }],
    details,
    isError: false,
    timestamp: Date.now(),
  } as never);
}

describe("hasUsableModel (no-model sentinel)", () => {
  it("treats undefined and Pi's unknown placeholder as no model; a real model as usable", () => {
    expect(hasUsableModel(undefined)).toBe(false);
    expect(hasUsableModel({ provider: "unknown", id: "unknown" })).toBe(false);
    expect(hasUsableModel({ provider: "faux-handoff", id: "faux-handoff-1" })).toBe(true);
  });
});

describe("native tree handoff (real AgentSession, faux provider, real extension runner)", () => {
  it("row 1 analogue: happy path commits the exact branch_summary, keeps old bytes, reloads the same state, and the next provider payload carries the summary", async () => {
    const log = newLog();
    const h = await createHarness({ extensions: [ours(), spy(log)] });
    try {
      const target = await buildHistory(h);
      const handoffId = await recordHandoff(h, target, "Exact handoff: keep decision X.");
      const beforeBytes = readBytes(h.file);
      const beforeLeaf = h.sessionManager.getLeafId();

      await runCommand(h, handoffId);

      expect(lastNotice(h)).toMatch(/^Tree handoff applied/);
      const summaries = branchSummaries(h.sessionManager);
      expect(summaries).toHaveLength(1);
      const s = summaries[0];
      expect(s.parentId).toBe(target);
      expect(s.fromHook).toBe(true);
      expect(s.summary).toBe("Exact handoff: keep decision X.");
      expect(s.details).toMatchObject({ handoffId, sha256: sha256Utf8("Exact handoff: keep decision X.") });
      expect(h.sessionManager.getLeafId()).toBe(s.id);
      expect(log.trees).toHaveLength(1);
      expect(log.trees[0]).toMatchObject({ newLeafId: s.id, oldLeafId: beforeLeaf, summaryEntry: { id: s.id } });

      const afterBytes = readBytes(h.file);
      expect(afterBytes.subarray(0, beforeBytes.length).equals(beforeBytes)).toBe(true);

      const reopened = SessionManager.open(h.file, h.dir);
      expect(reopened.getLeafId()).toBe(s.id);
      expect(reopened.getEntry(s.id)).toMatchObject({ type: "branch_summary", parentId: target, fromHook: true });

      // Payload check: the next provider request carries the recorded handoff text.
      let payload = "";
      h.core.setResponses([
        (context) => {
          payload = JSON.stringify(context.messages);
          return fauxAssistantMessage(fauxText("continuing"));
        },
      ]);
      await h.session.prompt("continue");
      expect(payload).toContain("Exact handoff: keep decision X.");
    } finally {
      h.dispose();
    }
  });

  it("row 2a: our handler's caught internal error cancels; no session_tree; leaf unchanged", async () => {
    const log = newLog();
    const h = await createHarness({
      extensions: [
        ours({
          matchPreparation: () => {
            throw new Error("injected verifier failure");
          },
        }),
        spy(log),
      ],
    });
    try {
      const target = await buildHistory(h);
      const handoffId = await recordHandoff(h, target, "text 2a");
      const leaf = h.sessionManager.getLeafId();
      const bytes = readBytes(h.file);

      await runCommand(h, handoffId);

      expect(lastNotice(h)).toMatch(/^Tree handoff cancelled \(hook decision: error\)/);
      expect(log.trees).toHaveLength(0);
      expect(h.sessionManager.getLeafId()).toBe(leaf);
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);
      expect(readBytes(h.file).equals(bytes)).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("row 3a: competitor registered before ours; ours overwrites (last truthy) -> success with our details", async () => {
    const h = await createHarness({ extensions: [competitor({ summary: { summary: "COMPETITOR", details: {} } }), ours()] });
    try {
      const target = await buildHistory(h);
      const handoffId = await recordHandoff(h, target, "ours wins");
      await runCommand(h, handoffId);
      expect(lastNotice(h)).toMatch(/^Tree handoff applied/);
      const s = branchSummaries(h.sessionManager)[0];
      expect(s.summary).toBe("ours wins");
      expect(s.details.handoffId).toBe(handoffId);
    } finally {
      h.dispose();
    }
  });

  it("row 3b: competitor registered after ours; its summary wins -> collision, reported as not ours", async () => {
    const h = await createHarness({ extensions: [ours(), competitor({ summary: { summary: "COMPETITOR", details: { from: "c" } } })] });
    try {
      const target = await buildHistory(h);
      const handoffId = await recordHandoff(h, target, "ours loses");
      await runCommand(h, handoffId);
      expect(lastNotice(h)).toMatch(/^Collision: /);
      const s = branchSummaries(h.sessionManager)[0];
      expect(s.summary).toBe("COMPETITOR");
      expect(h.sessionManager.getLeafId()).toBe(s.id);
    } finally {
      h.dispose();
    }
  });

  it("row 4: competitor after ours returns a truthy non-summary -> default LLM fallback committed -> collision", async () => {
    const h = await createHarness({ extensions: [ours(), competitor({ customInstructions: "x" })] });
    try {
      const target = await buildHistory(h);
      const handoffId = await recordHandoff(h, target, "ours loses to fallback");
      // The default summarizer calls the model; queue its deterministic reply.
      h.core.appendResponses([fauxAssistantMessage(fauxText("DEFAULT FALLBACK SUMMARY"))]);
      await runCommand(h, handoffId);
      expect(lastNotice(h)).toMatch(/^Collision: /);
      const s = branchSummaries(h.sessionManager)[0];
      // Pi's default summarizer wraps the model reply in its own preamble; containment is the honest check.
      expect(s.summary).toContain("DEFAULT FALLBACK SUMMARY");
      expect(s.summary).not.toBe("row 4 text");
      expect(s.fromHook).not.toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("row 5a: competitor before ours cancels; early cancel short-circuits ours -> cancellation, no session_tree", async () => {
    const log = newLog();
    const h = await createHarness({ extensions: [competitor({ cancel: true }), ours(), spy(log)] });
    try {
      const target = await buildHistory(h);
      const handoffId = await recordHandoff(h, target, "5a");
      const leaf = h.sessionManager.getLeafId();
      await runCommand(h, handoffId);
      expect(lastNotice(h)).toMatch(/^Tree handoff cancelled \(hook decision: undefined\)/);
      expect(log.trees).toHaveLength(0);
      expect(h.sessionManager.getLeafId()).toBe(leaf);
    } finally {
      h.dispose();
    }
  });

  it("row 5b: competitor after ours cancels -> cancellation, no session_tree", async () => {
    const log = newLog();
    const h = await createHarness({ extensions: [ours(), competitor({ cancel: true }), spy(log)] });
    try {
      const target = await buildHistory(h);
      const handoffId = await recordHandoff(h, target, "5b");
      const leaf = h.sessionManager.getLeafId();
      await runCommand(h, handoffId);
      expect(lastNotice(h)).toMatch(/^Tree handoff cancelled \(hook decision: summary\)/);
      expect(log.trees).toHaveLength(0);
      expect(h.sessionManager.getLeafId()).toBe(leaf);
    } finally {
      h.dispose();
    }
  });

  it("row 6: absent, malformed (sha256 mismatch), and superseded handoff ids reject before navigation; file unchanged", async () => {
    const log = newLog();
    const h = await createHarness({ extensions: [ours(), spy(log)] });
    try {
      const target = await buildHistory(h);
      const first = await recordHandoff(h, target, "first text");
      const second = await recordHandoff(h, target, "second text");
      expect(second).not.toBe(first);

      const bytes = readBytes(h.file);
      const leaf = h.sessionManager.getLeafId();

      await runCommand(h, randomUUID());
      expect(lastNotice(h)).toMatch(/^NO_VALID_HANDOFF: /);

      await runCommand(h, first);
      expect(lastNotice(h)).toMatch(/^HANDOFF_SUPERSEDED: /);

      const badId = randomUUID();
      appendToolResult(h.sessionManager, {
        schema: HANDOFF_SCHEMA,
        handoffId: badId,
        targetId: target,
        text: "tampered",
        sha256: "0".repeat(64),
      }, leaf);
      await runCommand(h, badId);
      expect(lastNotice(h)).toMatch(/^HANDOFF_MALFORMED: /);

      expect(log.trees).toHaveLength(0);
      expect(h.sessionManager.getLeafId()).not.toBe(target);
      expect(readBytes(h.file).subarray(0, bytes.length).equals(bytes)).toBe(true);
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("row 7: restart after handoff leaves nothing pending; command re-validates from the file and applies", async () => {
    const h1 = await createHarness({ extensions: [ours()] });
    const file = h1.file;
    const dir = h1.dir;
    const target = await buildHistory(h1);
    const handoffId = await recordHandoff(h1, target, "restart text");
    // Passive pre-disposal snapshot + full-event flush for h1, immediately before the
    // unchanged h1.session.dispose(). This preserves the original handoff execution
    // lifecycle (tool events) that would otherwise be lost when the original lifecycle
    // bypasses the added h.dispose logger. No original semantics change.
    const h1PreDisposeToken = h1.artifactLog?.before("pre-dispose-row7-h1");
    if (h1PreDisposeToken) h1.artifactLog?.after(h1PreDisposeToken, "pre-dispose-row7-h1-flush");
    h1.session.dispose(); // simulate process end; directory kept for the second session

    const h2 = await createHarness({ extensions: [ours()], sessionFile: file, dir });
    try {
      expect(branchSummaries(h2.sessionManager)).toHaveLength(0);
      await runCommand(h2, handoffId);
      expect(lastNotice(h2)).toMatch(/^Tree handoff applied/);
      expect(branchSummaries(h2.sessionManager)).toHaveLength(1);
    } finally {
      h2.dispose();
    }
  });

  it("row 11: ordinary navigation (no pending, summarize:false) keeps native behaviour: no summary, hook sees the event", async () => {
    const log = newLog();
    const h = await createHarness({ extensions: [ours(), spy(log)] });
    try {
      const target = await buildHistory(h);
      const navToken = h.artifactLog?.before("pre-navigate-row11");
      const result = await h.session.navigateTree(target, { summarize: false });
      if (navToken) h.artifactLog?.after(navToken, "post-navigate-row11");
      expect(result.cancelled).toBe(false);
      expect(log.before).toBe(1);
      expect(log.trees).toHaveLength(1);
      expect(log.trees[0].summaryEntry).toBeUndefined();
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);
      expect(h.sessionManager.getLeafId()).toBe(target);
    } finally {
      h.dispose();
    }
  });

  it("row 12: post-record metadata entries are accepted; custom_message is rejected as non-metadata", async () => {
    const h = await createHarness({ extensions: [ours()] });
    try {
      const target = await buildHistory(h);
      const handoffId = await recordHandoff(h, target, "metadata text");
      const sm = h.sessionManager;
      sm.appendLabelChange(target, "bookmark");
      sm.appendSessionInfo("handoff session");
      sm.appendCustomEntry("probe", { note: 1 });
      sm.appendUsage("probe", "faux", "faux-handoff-1", {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      } as never);
      sm.appendModelChange("faux-handoff", "faux-handoff-1");
      sm.appendThinkingLevelChange("low");
      await runCommand(h, handoffId);
      expect(lastNotice(h)).toMatch(/^Tree handoff applied/);
    } finally {
      h.dispose();
    }

    const h2 = await createHarness({ extensions: [ours()] });
    try {
      const target = await buildHistory(h2);
      const handoffId = await recordHandoff(h2, target, "custom message text");
      h2.sessionManager.appendCustomMessageEntry("probe", "injected context", true);
      await runCommand(h2, handoffId);
      expect(lastNotice(h2)).toMatch(/^NON_METADATA_AFTER_RECORD: /);
      expect(branchSummaries(h2.sessionManager)).toHaveLength(0);
    } finally {
      h2.dispose();
    }
  });

  it("row 13: no model configured -> rejected before navigation; hook never invoked", async () => {
    // Without provider keys in the environment the SDK resolves no model (verified by probe: session.model unknown).
    // Keys are restored afterwards; this keeps the row independent of the developer machine's credentials.
    const saved = clearProviderKeys();
    const log = newLog();
    let h: Harness;
    try {
      h = await createHarness({ extensions: [spy(log), ours()], withModel: false });
    } finally {
      restoreEnv(saved);
    }
    // Pi's no-model placeholder (not undefined): id/provider "unknown".
    expect(h.session.model).toMatchObject({ provider: "unknown", id: "unknown" });
    try {
      const sm = h.sessionManager;
      sm.appendMessage({ role: "user", content: "q", timestamp: Date.now() } as never);
      const targetId = sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "a" }], api: "x", provider: "x", model: "x", usage: {}, stopReason: "stop", timestamp: Date.now() } as never);
      const recordId = sm.appendMessage({ role: "toolResult", toolCallId: "c", toolName: HANDOFF_TOOL, content: [], details: { schema: HANDOFF_SCHEMA, handoffId: randomUUID(), targetId, text: "t", sha256: sha256Utf8("t") }, isError: false, timestamp: Date.now() } as never);
      void recordId;
      sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], api: "x", provider: "x", model: "x", usage: {}, stopReason: "stop", timestamp: Date.now() } as never);
      const id = handoffRecords(h).at(-1)!.details.handoffId;
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^NO_MODEL: /);
      expect(log.before).toBe(0);
      expect(branchSummaries(sm)).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("row 16: an effectful tool call after the record rejects pre-commit", async () => {
    const log = newLog();
    const h = await createHarness({ extensions: [ours(), spy(log)] });
    try {
      const target = await buildHistory(h);
      h.core.setResponses([
        fauxAssistantMessage([fauxToolCall(HANDOFF_TOOL, { targetId: target, text: "t16" }, { id: "call-h" })]),
        fauxAssistantMessage([fauxToolCall(TARGETS_TOOL, {}, { id: "call-after" })]),
        fauxAssistantMessage(fauxText("done")),
      ]);
      await h.session.prompt("handoff then another tool");
      const id = handoffRecords(h).at(-1)!.details.handoffId;
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^EFFECTFUL_AFTER_RECORD: /);
      expect(log.trees).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("row 16b: a later user message rejects pre-commit", async () => {
    const h = await createHarness({ extensions: [ours()] });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "t16b");
      h.sessionManager.appendMessage({ role: "user", content: "later", timestamp: Date.now() } as never);
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^USER_AFTER_RECORD: /);
    } finally {
      h.dispose();
    }
  });

  it("row 17: final same-turn response is the allowed shape (covered by row 1); row 19: no record -> no valid handoff", async () => {
    const h = await createHarness({ extensions: [ours()] });
    try {
      await buildHistory(h);
      h.core.setResponses([fauxAssistantMessage(fauxText("I will not record anything"))]);
      await h.session.prompt("please hand off");
      await runCommand(h, randomUUID());
      expect(lastNotice(h)).toMatch(/^NO_VALID_HANDOFF: /);
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("row 18: post-commit session-file re-read failure is reported as uncertain, not success", async () => {
    let reads = 0;
    const h = await createHarness({
      extensions: [
        ours({
          readSessionFile: async (path) => {
            reads++;
            if (reads >= 2) throw new Error("injected re-read failure");
            return readFileSync(path);
          },
        }),
      ],
    });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "t18");
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^Committed in memory, but the session file could not be re-read/);
      expect(h.sessionManager.getLeafId()).toBe(branchSummaries(h.sessionManager)[0].id);
    } finally {
      h.dispose();
    }
  });

  it("row 18 runtime gate A: real EACCES, verification reread succeeds (byte-identical) => thrown with persisted-unchanged report", async () => {
    let callCount = 0;
    const h = await createHarness({
      extensions: [ours({
        readSessionFile: async (path) => {
          callCount++;
          return readFileSync(path);
        },
      })],
    });
    let originalMode: number | undefined;
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "t18-rt-a");
      const originalLeaf = h.sessionManager.getLeafId();
      const oldBytes = readFileSync(h.file);

      originalMode = statSync(h.file).mode & 0o777;
      chmodSync(h.file, 0o444);

      const faultToken = h.artifactLog?.before("pre-eacces-fault");
      await runCommand(h, id);
      h.artifactLog?.after(faultToken!, "post-eacces-fault");

      // The verification reread must have been invoked exactly twice: preflight (call 1)
      // and the post-navError verification (call 2).
      expect(callCount).toBe(2);

      // Mode A: the verification reread succeeds and finds byte-identical content.
      // The outcome is a thrown failure with an explicit persisted-unchanged report.
      expect(lastNotice(h)).toMatch(/navigateTree threw \(EACCES/);
      expect(lastNotice(h)).toMatch(/Persisted file unchanged/);

      const faultBytes = readFileSync(h.file);
      expect(faultBytes.equals(oldBytes)).toBe(true);

      const postFaultLeaf = h.sessionManager.getLeafId();
      const recoveryDest = postFaultLeaf === originalLeaf ? target : (originalLeaf ?? target);
      expect(recoveryDest).not.toBe(postFaultLeaf);
      const navToken = h.artifactLog?.before("pre-recovery-nav");
      const navResult = await h.session.navigateTree(recoveryDest, { summarize: false });
      h.artifactLog?.after(navToken!, "post-recovery-nav");
      expect(navResult.cancelled).toBe(false);
      expect(h.sessionManager.getLeafId()).toBe(recoveryDest);

      if (h.sessionManager.getLeafId() !== originalLeaf) {
        const backToken = h.artifactLog?.before("pre-restore-leaf");
        const backResult = await h.session.navigateTree(originalLeaf!, { summarize: false });
        h.artifactLog?.after(backToken!, "post-restore-leaf");
        expect(backResult.cancelled).toBe(false);
        expect(h.sessionManager.getLeafId()).toBe(originalLeaf);
      }

      if (originalMode !== undefined) chmodSync(h.file, originalMode);

      const reapplyToken = h.artifactLog?.before("pre-reapply");
      await runCommand(h, id);
      h.artifactLog?.after(reapplyToken!, "post-reapply");
      expect(lastNotice(h)).toMatch(/^Tree handoff applied/);
      expect(branchSummaries(h.sessionManager)).toHaveLength(1);
    } finally {
      if (originalMode !== undefined) chmodSync(h.file, originalMode);
      h.dispose();
    }
  });

  it("row 18 runtime gate B: real EACCES, verification reread throws => uncertain, persisted-state-unverified", async () => {
    let callCount = 0;
    const h = await createHarness({
      extensions: [ours({
        readSessionFile: async (path) => {
          callCount++;
          if (callCount === 2) throw new Error("injected verification-read failure");
          return readFileSync(path);
        },
      })],
    });
    let originalMode: number | undefined;
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "t18-rt-b");
      const originalLeaf = h.sessionManager.getLeafId();
      const oldBytes = readFileSync(h.file);

      originalMode = statSync(h.file).mode & 0o777;
      chmodSync(h.file, 0o444);

      const faultToken = h.artifactLog?.before("pre-eacces-fault");
      await runCommand(h, id);
      h.artifactLog?.after(faultToken!, "post-eacces-fault");

      // Mode B: the verification reread throws => uncertain, persisted-state-unverified.
      expect(callCount).toBe(2);
      expect(lastNotice(h)).toMatch(/uncertain/i);
      expect(lastNotice(h)).toMatch(/Persisted state unverified/);
      expect(lastNotice(h)).toMatch(/injected verification-read failure/);

      const faultBytes = readFileSync(h.file);
      expect(faultBytes.equals(oldBytes)).toBe(true);

      const postFaultLeaf = h.sessionManager.getLeafId();
      const recoveryDest = postFaultLeaf === originalLeaf ? target : (originalLeaf ?? target);
      expect(recoveryDest).not.toBe(postFaultLeaf);
      const navToken = h.artifactLog?.before("pre-recovery-nav");
      const navResult = await h.session.navigateTree(recoveryDest, { summarize: false });
      h.artifactLog?.after(navToken!, "post-recovery-nav");
      expect(navResult.cancelled).toBe(false);

      if (h.sessionManager.getLeafId() !== originalLeaf) {
        const backToken = h.artifactLog?.before("pre-restore-leaf");
        const backResult = await h.session.navigateTree(originalLeaf!, { summarize: false });
        h.artifactLog?.after(backToken!, "post-restore-leaf");
        expect(backResult.cancelled).toBe(false);
      }

      if (originalMode !== undefined) chmodSync(h.file, originalMode);

      const reapplyToken = h.artifactLog?.before("pre-reapply");
      await runCommand(h, id);
      h.artifactLog?.after(reapplyToken!, "post-reapply");
      expect(lastNotice(h)).toMatch(/^Tree handoff applied/);
    } finally {
      if (originalMode !== undefined) chmodSync(h.file, originalMode);
      h.dispose();
    }
  });

  it("row 18 runtime gate C: real EACCES, verification reread returns changed buffer => uncertain, persisted-state-unverified", async () => {
    let callCount = 0;
    const h = await createHarness({
      extensions: [ours({
        readSessionFile: async (path) => {
          callCount++;
          if (callCount === 2) return Buffer.from("corrupted-by-injected-view");
          return readFileSync(path);
        },
      })],
    });
    let originalMode: number | undefined;
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "t18-rt-c");
      const originalLeaf = h.sessionManager.getLeafId();
      const oldBytes = readFileSync(h.file);

      originalMode = statSync(h.file).mode & 0o777;
      chmodSync(h.file, 0o444);

      const faultToken = h.artifactLog?.before("pre-eacces-fault");
      await runCommand(h, id);
      h.artifactLog?.after(faultToken!, "post-eacces-fault");

      // Mode C: the verification reread returns a changed buffer => uncertain, persisted-state-unverified.
      expect(callCount).toBe(2);
      expect(lastNotice(h)).toMatch(/uncertain/i);
      expect(lastNotice(h)).toMatch(/Persisted state unverified/);
      expect(lastNotice(h)).toMatch(/file bytes differ from preflight/);

      const faultBytes = readFileSync(h.file);
      expect(faultBytes.equals(oldBytes)).toBe(true);

      const postFaultLeaf = h.sessionManager.getLeafId();
      const recoveryDest = postFaultLeaf === originalLeaf ? target : (originalLeaf ?? target);
      expect(recoveryDest).not.toBe(postFaultLeaf);
      const navToken = h.artifactLog?.before("pre-recovery-nav");
      const navResult = await h.session.navigateTree(recoveryDest, { summarize: false });
      h.artifactLog?.after(navToken!, "post-recovery-nav");
      expect(navResult.cancelled).toBe(false);

      if (h.sessionManager.getLeafId() !== originalLeaf) {
        const backToken = h.artifactLog?.before("pre-restore-leaf");
        const backResult = await h.session.navigateTree(originalLeaf!, { summarize: false });
        h.artifactLog?.after(backToken!, "post-restore-leaf");
        expect(backResult.cancelled).toBe(false);
      }

      if (originalMode !== undefined) chmodSync(h.file, originalMode);

      const reapplyToken = h.artifactLog?.before("pre-reapply");
      await runCommand(h, id);
      h.artifactLog?.after(reapplyToken!, "post-reapply");
      expect(lastNotice(h)).toMatch(/^Tree handoff applied/);
    } finally {
      if (originalMode !== undefined) chmodSync(h.file, originalMode);
      h.dispose();
    }
  });

  it("confirmation decline: no navigation; without UI the command proceeds only on explicit invocation", async () => {
    const h = await createHarness({ extensions: [ours()] });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "t-decline");
      h.confirmAnswer.value = false;
      const leaf = h.sessionManager.getLeafId();
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^Tree handoff declined/);
      expect(h.sessionManager.getLeafId()).toBe(leaf);
    } finally {
      h.dispose();
    }
  });

  it("no-UI invocation applies without a confirmation prompt (explicit command only)", async () => {
    const h = await createHarness({ extensions: [ours()], ui: false });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "t-noui");
      await runCommand(h, id);
      expect(branchSummaries(h.sessionManager)).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });

  it("row 15: navigateTree during streaming throws; the command waits for idle and then rejects (later user message)", async () => {
    const h = await createHarness({ extensions: [ours()] });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "t15");
      let started = false;
      let release: () => void = () => {};
      h.core.setResponses([
        () =>
          new Promise((resolve) => {
            started = true;
            release = () => resolve(fauxAssistantMessage(fauxText("slow reply")));
          }),
      ]);
      const slow = h.session.prompt("slow question");
      for (let i = 0; i < 200 && !started; i++) await new Promise((r) => setTimeout(r, 5));
      expect(started).toBe(true);

      const navToken15 = h.artifactLog?.before("pre-navigate-row15");
      await expect(h.session.navigateTree(target, { summarize: false })).rejects.toThrow(
        /Wait for the current response to finish/,
      );
      if (navToken15) h.artifactLog?.after(navToken15, "post-navigate-row15-rejected");
      const command = runCommand(h, id);
      release();
      await slow;
      await command;

      expect(lastNotice(h)).toMatch(/^USER_AFTER_RECORD: /);
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);
      expect(h.sessionManager.getLeafId()).not.toBe(target);
    } finally {
      h.dispose();
    }
  });

  it("row 15 exact: concurrent session.prompt during command confirm phase makes navigateTree hit the real SDK guard throw; persisted file unchanged; no summary/tree event; recovery proves lock released", async () => {
    const log = newLog();
    // A real before_agent_start extension that suspends only when armed.
    // The gate starts resolved (no suspension) so fixture prompts complete normally.
    // Before starting the concurrent prompt, the test arms the gate to suspend the
    // prepare phase. This is the SOLE model gate: no provider callback is gated.
    let hookArmed = false;
    let releaseHook: () => void = () => {};
    let hookGatePromise: Promise<void> = Promise.resolve();
    let hookEnteredSignal: (() => void) | undefined;
    let hookEnteredPromise: Promise<void> = Promise.resolve();
    const gatedHook: Extension = (pi) => {
      pi.on("before_agent_start", async () => {
        hookEnteredSignal?.();
        if (hookArmed) await hookGatePromise;
        return undefined;
      });
    };
    const h = await createHarness({ extensions: [ours(), spy(log), gatedHook] });
    // Hoisted outstanding promises and resolvers for the finally cleanup proof.
    let commandPromise: Promise<void> | undefined;
    let concurrentPromise: Promise<void> | undefined;
    let resolveConfirm: (v: boolean) => void = () => {};
    try {
      const target = await buildHistory(h);
      const handoffId = await recordHandoff(h, target, "exact race text");
      const preflightBytes = readBytes(h.file);
      const originalLeaf = h.sessionManager.getLeafId();

      // Suspend the command's UI confirmation so it holds the in-flight lock at the confirm dialog.
      const confirmGate = new Promise<boolean>((r) => (resolveConfirm = r));
      h.confirmAnswer.value = confirmGate;

      // Start the command while idle: it passes waitForIdle (line 660), isIdle check (line 662),
      // reads the file, runs preflight, then awaits ui.confirm (suspended by confirmGate).
      commandPromise = runCommand(h, handoffId);
      await h.nextConfirm(); // command has reached the confirm dialog and holds the in-flight lock

      // Arm the hook gate and its causal entered-signal, so the next before_agent_start
      // (from the concurrent prompt) suspends the prepare phase and signals on entry.
      hookArmed = true;
      hookEnteredPromise = new Promise<void>((r) => (hookEnteredSignal = r));
      hookGatePromise = new Promise<void>((r) => (releaseHook = r));

      // Start a concurrent PUBLIC session.prompt with an ordinary queued faux response.
      // The session is idle (no run active), so the SDK starts a new run: _isAgentRunActive=true
      // (line 1442) BEFORE awaiting _prepareRun, which awaits our gatedHook's before_agent_start.
      // The hook blocks on hookGatePromise, so the run is in the PREPARING phase:
      // session.isStreaming=true, agent.state.isStreaming=false (no tokens yet), no user
      // message persisted. Only the prepare hook gates; the provider response is ordinary.
      h.core.setResponses([fauxAssistantMessage(fauxText("concurrent reply"))]);
      concurrentPromise = h.session.prompt("concurrent question");

      // Causal deferred signal: wait for the real before_agent_start hook to have entered.
      // No polling clock, no fake timers — the hook itself resolves the signal.
      await hookEnteredPromise;

      // Passive artifact snapshot of the busy-valid phase: the actual SDK flags (run active,
      // not yet streaming tokens), the raw .jsonl bytes, the tree, and the leaf are all captured
      // by the existing observer. All notices are retained.
      const busyPhaseToken = h.artifactLog?.before("busy-phase-preparing");

      // Explicit named phase before the guard throw: the concurrent run is PREPARING, not
      // streaming tokens. The SDK run flag is true; the agent has not started streaming.
      expect(h.session.isStreaming).toBe(true);
      expect(h.session.isIdle).toBe(false);
      expect(h.session.agent.state.isStreaming).toBe(false);
      // The session file is unchanged: the user message is built in-memory but not yet persisted.
      expect(readBytes(h.file).equals(preflightBytes)).toBe(true);

      // Resolve the command's UI confirmation while the prepare hook is blocked.
      resolveConfirm(true);

      // The command proceeds past confirm, re-validates (branch unchanged — no new entry),
      // sets pending, then calls navigateTree. navigateTree checks isStreaming (line 3280)
      // and throws the real SDK guard error. The command catches it, verifies the file is
      // unchanged, and reports the thrown outcome.
      await commandPromise;

      const lastMsg = lastNotice(h);
      expect(lastMsg).toMatch(/navigateTree threw \(Wait for the current response to finish/);
      expect(lastMsg).toMatch(/Persisted file unchanged/);

      // No branch summary committed, no session_tree event, leaf unchanged, file unchanged.
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);
      expect(log.trees).toHaveLength(0);
      expect(h.sessionManager.getLeafId()).toBe(originalLeaf);
      expect(readBytes(h.file).equals(preflightBytes)).toBe(true);

      // Passive artifact snapshot after the guard throw: the run is still preparing (hook held),
      // the command's own session_before_tree never fired on the guard-failed navigation, and the
      // file remains byte-identical to the preflight. The busy-phase token is closed here so the
      // per-command event slice is exact.
      if (busyPhaseToken) h.artifactLog?.after(busyPhaseToken, "busy-phase-guard-thrown");

      // Release the prepare hook; the run completes with the ordinary queued response.
      // No provider gate exists, so there is nothing else to release.
      releaseHook();
      await concurrentPromise;
      expect(h.session.isStreaming).toBe(false);
      expect(h.session.isIdle).toBe(true);

      // Recovery preconditions: the concurrent prompt moved the leaf past originalLeaf, so the
      // SDK's native no-op check (if targetId === oldLeafId) cannot return { cancelled: false }
      // without invoking the pending hook. And originalLeaf is not the pending target (the first
      // assistant message), so a no-op at the target would not have cancelled. Both must hold for
      // the recovery navigation to be a genuine non-noop that would cancel a stale pending.
      const leafAfterConcurrent = h.sessionManager.getLeafId();
      expect(leafAfterConcurrent).not.toBe(originalLeaf);
      expect(originalLeaf).not.toBe(target);

      // Recovery: a non-noop ordinary navigateTree to the original leaf (different from the
      // pending target, which is the first assistant message). If a stale pending state remained
      // from the guard-failed command, this navigation would be cancelled; it is not.
      const recoveryNavToken = h.artifactLog?.before("pre-recovery-navigate");
      const navResult = await h.session.navigateTree(originalLeaf!, { summarize: false });
      if (recoveryNavToken) h.artifactLog?.after(recoveryNavToken, "post-recovery-navigate");
      expect(navResult.cancelled).toBe(false);
      expect(h.sessionManager.getLeafId()).toBe(originalLeaf);

      // The original handoff re-applies on the restored path with the SAME handoffId: no new
      // handoff tool fixture is needed. This proves the in-flight lock was released and the
      // pending state was cleared by the guard-failed command's finally.
      await runCommand(h, handoffId);
      expect(lastNotice(h)).toMatch(/^Tree handoff applied/);
      expect(branchSummaries(h.sessionManager)).toHaveLength(1);
    } finally {
      // Always release every gate and await every outstanding task before disposal, even on
      // assertion failure. The confirm gate and prepare hook are released first so no run is
      // left suspended; then both prompts are settled (rejections swallowed) so dispose sees
      // no outstanding work.
      resolveConfirm(false);
      releaseHook();
      if (commandPromise) await commandPromise.catch(() => {});
      if (concurrentPromise) await concurrentPromise.catch(() => {});
      h.dispose();
    }
  });

  it("row 19 shape: a record without a same-turn final response rejects with NO_FINAL_RESPONSE", async () => {
    const h = await createHarness({ extensions: [ours()] });
    try {
      const target = await buildHistory(h);
      const sm = h.sessionManager;
      const recordDetails = { schema: HANDOFF_SCHEMA, handoffId: randomUUID(), targetId: target, text: "no final", sha256: sha256Utf8("no final") };
      appendToolResult(sm, recordDetails, sm.getLeafId());
      await runCommand(h, recordDetails.handoffId);
      expect(lastNotice(h)).toMatch(/^NO_FINAL_RESPONSE: /);
      expect(branchSummaries(sm)).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("row 2b proxy (real runner, competitor's escaping throw is swallowed; the chain continues): ours still wins", async () => {
    const throwing: Extension = (pi) => {
      pi.on("session_before_tree", () => {
        throw new Error("competitor escaping throw");
      });
    };
    const h = await createHarness({ extensions: [throwing, ours()] });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "2b proxy");
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^Tree handoff applied/);
    } finally {
      h.dispose();
    }
  });

  it("unbound command actions: ctx.navigateTree is a silent no-op -> reported as unexpected, not success", async () => {
    const h = await createHarness({ extensions: [ours()], bindCommandActions: false });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "t-unbound");
      const leaf = h.sessionManager.getLeafId();
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^navigateTree returned without cancelling, but nothing was committed/);
      expect(h.sessionManager.getLeafId()).toBe(leaf);
    } finally {
      h.dispose();
    }
  });
});

describe("native tree handoff concurrency and lock lifecycle (real AgentSession, real runner)", () => {
  /** Holds the first readSessionFile call (the pre-navigation read, after waitForIdle and before validation) until released. */
  function gatedReader() {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const state = { calls: 0, entered: false };
    const readSessionFile = async (path: string) => {
      state.calls += 1;
      if (state.calls === 1) {
        state.entered = true;
        await gate;
      }
      return readFileSync(path);
    };
    return { readSessionFile, release, state };
  }

  it("an overlapping command is rejected while the first is in flight; release lets the first apply; the lock is then free", async () => {
    const gated = gatedReader();
    const h = await createHarness({ extensions: [ours({ readSessionFile: gated.readSessionFile })] });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "concurrent handoff");

      const first = runCommand(h, id);
      for (let i = 0; i < 400 && !gated.state.entered; i++) await new Promise((r) => setTimeout(r, 5));
      expect(gated.state.entered).toBe(true);

      // Second invocation while the first is blocked before any pending state exists.
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^ALREADY_IN_PROGRESS: /);
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);

      gated.release();
      await first;
      expect(lastNotice(h)).toMatch(/^Tree handoff applied: summary /);
      expect(branchSummaries(h.sessionManager)).toHaveLength(1);
      expect(branchSummaries(h.sessionManager)[0]).toMatchObject({ parentId: target, fromHook: true });

      // Lock released after the normal path: a later invocation is not rejected as in flight.
      await runCommand(h, id);
      expect(lastNotice(h)).not.toMatch(/ALREADY_IN_PROGRESS/);
    } finally {
      h.dispose();
    }
  });

  it("the lock releases after an early rejection (unknown id), and a valid command then applies normally", async () => {
    const h = await createHarness({ extensions: [ours()] });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "after rejection");
      await runCommand(h, randomUUID());
      expect(lastNotice(h)).toMatch(/^NO_VALID_HANDOFF: /);
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^Tree handoff applied: /);
      expect(branchSummaries(h.sessionManager)).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });

  it("the lock releases after an I/O failure in the pre-navigation read, and a later command applies normally", async () => {
    let calls = 0;
    const readSessionFile = async (path: string) => {
      calls += 1;
      if (calls === 1) throw new Error("injected read failure");
      return readFileSync(path);
    };
    const h = await createHarness({ extensions: [ours({ readSessionFile })] });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "after io failure");
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^SESSION_UNREADABLE: /);
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^Tree handoff applied: /);
      expect(branchSummaries(h.sessionManager)).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });
});

describe("native tree handoff no-UI outcome notices (real AgentSession, real runner)", () => {
  it("no-UI success states that no UI confirmation was shown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = await createHarness({ extensions: [ours()], ui: false });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "noui success");
      await runCommand(h, id);
      expect(branchSummaries(h.sessionManager)).toHaveLength(1);
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => /^Tree handoff applied: /.test(m) && m.endsWith("No UI confirmation was shown."))).toBe(true);
    } finally {
      warn.mockRestore();
      h.dispose();
    }
  });

  it("no-UI collision states that no UI confirmation was shown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = await createHarness({ extensions: [ours(), competitor({ summary: { summary: "COMPETITOR", details: { from: "c" } } })], ui: false });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "noui collision");
      await runCommand(h, id);
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => /^Collision: /.test(m) && m.endsWith("No UI confirmation was shown."))).toBe(true);
    } finally {
      warn.mockRestore();
      h.dispose();
    }
  });

  it("no-UI cancellation states that no UI confirmation was shown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = await createHarness({
      extensions: [
        ours({
          matchPreparation: () => {
            throw new Error("injected verifier failure");
          },
        }),
      ],
      ui: false,
    });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "noui cancel");
      const leaf = h.sessionManager.getLeafId();
      await runCommand(h, id);
      expect(h.sessionManager.getLeafId()).toBe(leaf);
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => /^Tree handoff cancelled \(hook decision: error\)/.test(m) && m.endsWith("No UI confirmation was shown."))).toBe(true);
    } finally {
      warn.mockRestore();
      h.dispose();
    }
  });

  it("no-UI pre-navigation rejection is warned to stderr, without the post-navigation confirmation suffix", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = await createHarness({ extensions: [ours()], ui: false });
    try {
      await buildHistory(h);
      await runCommand(h, randomUUID());
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);
      const messages = warn.mock.calls.map((c) => String(c[0]));
      const rejection = messages.find((m) => /^NO_VALID_HANDOFF: /.test(m));
      expect(rejection).toBeDefined();
      expect(rejection?.endsWith("No UI confirmation was shown.")).toBe(false);
    } finally {
      warn.mockRestore();
      h.dispose();
    }
  });

  it("no-UI overlapping invocation is rejected and warned to stderr while the first is in flight", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    let entered = false;
    const readSessionFile = async (path: string) => {
      calls += 1;
      if (calls === 1) {
        entered = true;
        await gate;
      }
      return readFileSync(path);
    };
    const h = await createHarness({ extensions: [ours({ readSessionFile })], ui: false });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "noui overlap");
      const first = runCommand(h, id);
      for (let i = 0; i < 400 && !entered; i++) await new Promise((r) => setTimeout(r, 5));
      expect(entered).toBe(true);

      await runCommand(h, id);
      release();
      await first;

      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m === "ALREADY_IN_PROGRESS: another tree handoff is in flight. Nothing was changed.")).toBe(true);
      expect(messages.some((m) => /^Tree handoff applied: /.test(m) && m.endsWith("No UI confirmation was shown."))).toBe(true);
      expect(branchSummaries(h.sessionManager)).toHaveLength(1);
    } finally {
      warn.mockRestore();
      h.dispose();
    }
  });
});

describe("native tree handoff confirmation timeout (fake timers; no real sleep)", () => {
  it("passes a confirm timeout; an unanswered dialog declines when the timeout elapses and releases the lock", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = await createHarness({ extensions: [ours()] });
    try {
      const target = await buildHistory(h);
      const id = await recordHandoff(h, target, "timeout handoff");
      const leaf = h.sessionManager.getLeafId();
      h.confirmMode.value = "rpc-timeout";

      const first = runCommand(h, id);
      await h.nextConfirm();
      expect(h.confirms).toHaveLength(1);
      expect(h.confirms[0].opts).toEqual({ timeout: CONFIRM_TIMEOUT_MS });
      expect(CONFIRM_TIMEOUT_MS).toBe(120_000);

      // Still in flight: the dialog is unanswered, so a second invocation is rejected.
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^ALREADY_IN_PROGRESS: /);

      // Advance exactly to the timeout; Pi's dialog resolves false and the command declines.
      await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
      await first;
      expect(lastNotice(h)).toMatch(/^Tree handoff declined \(or confirmation timed out\)/);
      expect(branchSummaries(h.sessionManager)).toHaveLength(0);
      expect(h.sessionManager.getLeafId()).toBe(leaf);

      // Lock released: with an answer available, a later invocation runs the normal path to success.
      h.confirmMode.value = "answer";
      await runCommand(h, id);
      expect(lastNotice(h)).toMatch(/^Tree handoff applied: /);
      expect(branchSummaries(h.sessionManager)).toHaveLength(1);
    } finally {
      h.dispose();
      vi.useRealTimers();
    }
  });
});

describe("artifact recorder: session-file absence is represented explicitly, not ENOENT or fabricated", () => {
  it("no-model fresh harness: before() on a missing session file writes fileAbsent metadata, not an empty-session claim", async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "native-tree-absence-"));
    try {
      // No provider, no model: the session file does not exist until the first prompt.
      const h = await createHarness({ extensions: [ours()], withModel: false, logDir: artifactDir, testId: "recorder-absence-regression" });
      try {
        // The session file does not exist yet (fresh harness, no prompt).
        const pre = existsSync(h.file);
        expect(pre).toBe(false);

        // before() must not throw ENOENT and must not fabricate an empty session.
        const token = h.artifactLog!.before("pre-absence");
        expect(token.id).toBe("cmd-000");

        // The absence marker is written; no session.jsonl (only .absent).
        // Read the origin.json to get the actual testDirName (slug + hash), not the explicit testId string.
        const { readdirSync } = await import("node:fs");
        const testDirName = readdirSync(artifactDir).find((d) => existsSync(join(artifactDir, d, h.artifactLog!.harnessId, "origin.json")));
        if (!testDirName) throw new Error("origin.json not found for harness");
        const stepDir = join(artifactDir, testDirName, h.artifactLog!.harnessId, token.id, "pre-absence");
        expect(existsSync(join(stepDir, "session.jsonl.absent"))).toBe(true);
        expect(existsSync(join(stepDir, "session.jsonl"))).toBe(false);
        expect(existsSync(join(stepDir, "tree.json"))).toBe(false);

        // Metadata explicitly represents absence.
        const meta = JSON.parse(readFileSync(join(stepDir, "meta.json"), "utf8")) as any;
        expect(meta.fileAbsent).toBe(true);
        expect(meta.fileBytes).toBe(0);
        expect(meta.fileSha256).toBeNull();
        expect(meta.phase).toBe("pre-absence");
      } finally {
        h.dispose();
      }
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});

/**
 * Row-to-test mapping for the native-tree retirement evidence matrix.
 * Each row is identified by the original test name in this file. The mapping is
 * documentation only — it does not alter any existing test, assertion, or control flow.
 *
 * Row 14 is the record-tool guard: a target equal to the current leaf is rejected at record
 * time. The tool throws a plain Error (src/native-tree-handoff.ts:557). The exact test is
 * "rejects a target equal to the current leaf before anything is recorded" in
 * test/native-tree-handoff.test.ts. This is distinct from the command-time validation code
 * TARGET_IS_LEAF (src/native-tree-handoff.ts:349), which the row-14 tool test does not
 * exercise.
 *
 * Row 2b is a competitor-throw proxy: the competitor's escaping throw is swallowed by the
 * real runner, and the chain continues so ours still wins. This is a proxy, not our own
 * escaping throw. The gate retains row 2b as an unmet criterion.
 */
export const rowMapping: Record<string, { test: string; caveat?: string }> = {
  "1": { test: "row 1 analogue: happy path commits the exact branch_summary, keeps old bytes, reloads the same state, and the next provider payload carries the summary" },
  "2a": { test: "row 2a: our handler's caught internal error cancels; no session_tree; leaf unchanged" },
  "2b": { test: "row 2b proxy (real runner, competitor's escaping throw is swallowed; the chain continues): ours still wins", caveat: "proxy only — not our own escaping throw" },
  "3a": { test: "row 3a: competitor registered before ours; ours overwrites (last truthy) -> success with our details" },
  "3b": { test: "row 3b: competitor registered after ours; its summary wins -> collision, reported as not ours" },
  "4": { test: "row 4: competitor after ours returns a truthy non-summary -> default LLM fallback committed -> collision" },
  "5a": { test: "row 5a: competitor before ours cancels; early cancel short-circuits ours -> cancellation, no session_tree" },
  "5b": { test: "row 5b: competitor after ours cancels -> cancellation, no session_tree" },
  "6": { test: "row 6: absent, malformed (sha256 mismatch), and superseded handoff ids reject before navigation; file unchanged" },
  "7": { test: "row 7: restart after handoff leaves nothing pending; command re-validates from the file and applies" },
  "8": { test: "row 1 analogue (old bytes prefix check covers row 8)" },
  "11": { test: "row 11: ordinary navigation (no pending, summarize:false) keeps native behaviour: no summary, hook sees the event" },
  "12": { test: "row 12: post-record metadata entries are accepted; custom_message is rejected as non-metadata" },
  "13": { test: "row 13: no model configured -> rejected before navigation; hook never invoked" },
  "14": { test: "rejects a target equal to the current leaf before anything is recorded (test/native-tree-handoff.test.ts)", caveat: "record-tool guard; command-time TARGET_IS_LEAF not exercised here" },
  "15": { test: "row 15: navigateTree during streaming throws; the command waits for idle and then rejects (later user message)" },
  "16": { test: "row 16: an effectful tool call after the record rejects pre-commit" },
  "16b": { test: "row 16b: a later user message rejects pre-commit" },
  "17": { test: "row 17: final same-turn response is the allowed shape (covered by row 1); row 19: no record -> no valid handoff" },
  "18": { test: "row 18: post-commit session-file re-read failure is reported as uncertain, not success" },
  "19": { test: "row 19 shape: a record without a same-turn final response rejects with NO_FINAL_RESPONSE" },
};
