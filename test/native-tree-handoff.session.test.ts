import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  return h.session.prompt(`/${HANDOFF_COMMAND} ${args}`);
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
      const result = await h.session.navigateTree(target, { summarize: false });
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

      await expect(h.session.navigateTree(target, { summarize: false })).rejects.toThrow(
        /Wait for the current response to finish/,
      );
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
