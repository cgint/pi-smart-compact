import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";

/** Real AgentSession + real extension runner + faux provider (deterministic). No runner stubs. */
export type Harness = {
  dir: string;
  session: AgentSession;
  sessionManager: SessionManager;
  file: string;
  notices: { message: string; type?: string }[];
  confirmAnswer: { value: boolean | Promise<boolean> };
  /** Every ui.confirm call as the runner delivered it (title, message, options). */
  confirms: { title: string; message: string; opts?: { timeout?: number } }[];
  /** "answer": resolve with confirmAnswer. "rpc-timeout": mirror Pi RPC dialogs (see confirmStub). */
  confirmMode: { value: "answer" | "rpc-timeout" };
  /** Resolves on the next ui.confirm call, so tests can advance fake timers only after the dialog exists. */
  nextConfirm(): Promise<void>;
  core: ReturnType<typeof createFauxCore>;
  /**
   * TEST-ONLY artifact logger. Undefined when artifact logging is disabled (no env var, no explicit logDir).
   * When present, the passive observer extension has been appended and events are captured in a closure-scoped buffer.
   */
  artifactLog?: ArtifactLog;
  dispose(): void;
};

/** A Pi extension factory: receives ExtensionAPI and returns void. */
export type Extension = (pi: ExtensionAPI) => void;

/**
 * Opaque command token returned by before() and consumed by after().
 * Carries the command sequence number and the observer event-index boundary
 * at the start of the command, so per-command event slices are exact.
 */
export type CommandToken = {
  /** Unique command identifier for this command. */
  id: string;
  /** Index into the observer's event buffer at the moment before() was called. */
  eventIndexStart: number;
};

/**
 * TEST-ONLY artifact recorder. Owns before/after raw .jsonl bytes, full getTree() JSON,
 * model/SDK metadata, notices, and the observer's actual event buffer.
 * Writes to unique per-command subdirs under the artifact directory.
 */
export type ArtifactLog = {
  /** Write the exact session .jsonl Buffer and full tree before a command. Returns an opaque token. */
  before(phase: string): CommandToken;
  /** Write the exact session .jsonl Buffer, full tree, and the command-scoped event slice. Takes the token from before(). */
  after(token: CommandToken, phase: string): void;
  /** Write the observer's full event buffer to a file (entire capture interval). */
  flushFullEvents(label: string): void;
  /** Persist the full event buffer at harness disposal (restart halves with no command). */
  finalizeFullEvents(): void;
  /** The observer's in-memory event buffer (actual events, not invented fields). */
  events: Record<string, unknown>[];
  /** Deterministic per-test/per-harness ID for unique paths. */
  testId: string;
  /** Harness instance ID (distinguishes restart halves in the same test). */
  harnessId: string;
};

function resolveArtifactDir(options: { logDir?: string }): string | undefined {
  return options.logDir ?? process.env.NATIVE_TREE_ARTIFACT_DIR ?? process.env.TEST_ARTIFACT_DIR;
}

/**
 * Read the current Vitest test name from expect.getState().currentTestName (vitest 5.1.0).
 * Uses a static ESM import of expect from vitest (the standard Vitest pattern; require('vitest')
 * fails in Vitest's ESM module graph and the catch would mask a real resolution failure).
 * Returns undefined only when the test name is genuinely absent (e.g., typecheck-only, no test running).
 */
function vitestCurrentTestName(): string | undefined {
  try {
    return expect.getState().currentTestName;
  } catch {
    return undefined;
  }
}

/** Read the SDK version from its package.json metadata (bypasses the exports restriction). */
function readSdkVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function createHarness(options: {
  extensions: Extension[];
  withModel?: boolean;
  /** Bind a UI context (hasUI true, notifications captured). Default true. */
  ui?: boolean;
  /** Bind commandContextActions (navigateTree, waitForIdle) as print/RPC modes do. Default true. */
  bindCommandActions?: boolean;
  dir?: string;
  sessionFile?: string;
  /** Explicit artifact directory; overrides env var. */
  logDir?: string;
  /** Deterministic per-test/per-harness ID for unique artifact paths. Overrides Vitest's current test name. */
  testId?: string;
}): Promise<Harness> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "native-tree-handoff-"));
  const core = createFauxCore({ provider: "faux-handoff", models: [{ id: "faux-handoff-1", reasoning: false }] } as never);
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  if (options.withModel !== false) {
    modelRuntime.registerProvider(core.provider, {
      api: core.api as never,
      streamSimple: core.streamSimple as never,
      apiKey: "faux-key",
      baseUrl: "http://faux.invalid",
      models: [
        {
          id: "faux-handoff-1",
          name: "faux",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 100_000,
          maxTokens: 1_000,
        },
      ] as never,
    });
  }
  const model = options.withModel === false ? undefined : modelRuntime.getModel(core.provider, "faux-handoff-1");
  const settingsManager = SettingsManager.create(dir, dir);
  const sessionManager = options.sessionFile
    ? SessionManager.open(options.sessionFile, dir)
    : SessionManager.create(dir, dir);

  const artifactDir = resolveArtifactDir(options);
  const testIdRaw = options.testId ?? vitestCurrentTestName();
  // Fail artifact capture if test identity is absent; no generic "common" fallback that hides attribution.
  if (artifactDir && !testIdRaw) {
    throw new Error("ARTIFACT_LOG_NO_TEST_ID: artifact logging is enabled but the current Vitest test name is unavailable; pass an explicit testId or run under Vitest");
  }
  // Full actual test name for attribution (origin.json, meta.json, manifest).
  const testName: string = testIdRaw ?? "disabled";
  // Bounded readable slug + hash for collision-free stable filesystem identity.
  // The slug is the first 60 chars of the test name (readable), the hash is sha256 of the
  // full name (collision-free). This avoids 80-char truncation collapsing all main-suite rows.
  const slug = testName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const nameHash = createHash("sha256").update(testName).digest("hex").slice(0, 12);
  const testDirName = `${slug}__${nameHash}`;
  const harnessId = `h${Math.random().toString(36).slice(2, 8)}`;
  const capturedEvents: Record<string, unknown>[] = [];
  let cmdCounter = 0;

  const extensions: Extension[] = [...options.extensions];
  if (artifactDir) {
    mkdirSync(join(artifactDir, testDirName, harnessId), { recursive: true });
    const observer: Extension = (pi) => {
      pi.on("session_start", (e) => {
        capturedEvents.push({ kind: "session_start", reason: e.reason, leafId: sessionManager.getLeafId(), entryCount: sessionManager.getEntries().length });
      });
      pi.on("session_before_tree", (e) => {
        capturedEvents.push({ kind: "session_before_tree", preparation: e.preparation, leafId: sessionManager.getLeafId() });
      });
      pi.on("session_tree", (e) => {
        capturedEvents.push({ kind: "session_tree", newLeafId: e.newLeafId, oldLeafId: e.oldLeafId, summaryEntry: e.summaryEntry, fromExtension: e.fromExtension });
      });
      pi.on("tool_call", (e) => {
        capturedEvents.push({ kind: "tool_call", toolName: e.toolName, toolCallId: e.toolCallId, input: e.input, parentToolCallId: e.parentToolCallId });
      });
      pi.on("tool_result", (e) => {
        capturedEvents.push({ kind: "tool_result", toolName: e.toolName, toolCallId: e.toolCallId, input: e.input, isError: e.isError, details: e.details, parentToolCallId: e.parentToolCallId });
      });
      pi.on("tool_execution_start", (e) => {
        capturedEvents.push({ kind: "tool_execution_start", toolName: e.toolName, toolCallId: e.toolCallId, args: e.args });
      });
      pi.on("tool_execution_end", (e) => {
        capturedEvents.push({ kind: "tool_execution_end", toolName: e.toolName, toolCallId: e.toolCallId, isError: e.isError, durationMs: e.durationMs });
      });
      pi.on("before_provider_request", (e) => {
        capturedEvents.push({ kind: "before_provider_request", payload: e.payload });
      });
      pi.on("agent_settled", (e) => {
        capturedEvents.push({ kind: "agent_settled", aborted: e.aborted, leafId: sessionManager.getLeafId() });
      });
    };
    // The observer never mutates event args or results; every handler returns undefined.
    extensions.push(observer);
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    extensionFactories: extensions.map((factory) => (pi: ExtensionAPI) => factory(pi)),
  });
  await resourceLoader.reload();
  const { session, extensionsResult } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime,
    model,
    settingsManager,
    sessionManager,
    resourceLoader,
  });
  if (extensionsResult.errors.length > 0) throw new Error(`extension load errors: ${JSON.stringify(extensionsResult.errors)}`);

  const notices: { message: string; type?: string }[] = [];
  const confirmAnswer: { value: boolean | Promise<boolean> } = { value: true };
  const confirms: { title: string; message: string; opts?: { timeout?: number } }[] = [];
  const confirmMode: { value: "answer" | "rpc-timeout" } = { value: "answer" };
  const confirmWaiters: (() => void)[] = [];
  const confirmStub = (title: string, message: string, opts?: { timeout?: number; signal?: AbortSignal }) => {
    confirms.push({ title, message, opts: opts ? { timeout: opts.timeout } : undefined });
    for (const wake of confirmWaiters.splice(0)) wake();
    if (confirmMode.value === "answer") return Promise.resolve(confirmAnswer.value);
    return new Promise<boolean>((resolve) => {
      if (opts?.timeout) setTimeout(() => resolve(false), opts.timeout);
    });
  };
  const uiContext =
    options.ui === false
      ? undefined
      : {
          notify: (message: string, type?: string) => notices.push({ message, type }),
          confirm: confirmStub,
          select: async () => undefined,
          input: async () => undefined,
          editor: async () => undefined,
          setStatus: () => {},
          setWidget: () => {},
          setTitle: () => {},
          setEditorText: () => {},
          getEditorText: () => "",
          theme: undefined,
        };
  const commandContextActions =
    options.bindCommandActions === false
      ? undefined
      : {
          waitForIdle: () => session.waitForIdle(),
          navigateTree: (targetId: string, opts?: Record<string, unknown>) => session.navigateTree(targetId, opts as never),
        };
  await session.bindExtensions({ uiContext, commandContextActions } as never);

  const file = sessionManager.getSessionFile() ?? "";

  let artifactLog: ArtifactLog | undefined;
  if (artifactDir) {
    const sdkVersion = readSdkVersion();
    // Persist per-harness origin metadata so h1/h2 linkage is via the captured session
    // path, not lexical sorting of random directory names. A harness with options.sessionFile
    // is a reopened session (h2 in row 7); one without is fresh (h1).
    writeFileSync(
      join(artifactDir, testDirName, harnessId, "origin.json"),
      JSON.stringify(
        {
          harnessId,
          testName,
          testDirName,
          sessionFile: file,
          reopenedFrom: options.sessionFile ?? null,
          isReopen: Boolean(options.sessionFile),
          dir,
          sdkVersion,
        },
        null,
        2,
      ),
    );
    const writeStep = (cmdDir: string, phase: string): void => {
      const stepDir = join(cmdDir, phase);
      mkdirSync(stepDir, { recursive: true });
      if (!existsSync(file)) {
        // Explicit absence: the session file does not exist yet (fresh no-provider harness
        // before any prompt). Do NOT throw ENOENT and do NOT fabricate an empty session claim.
        writeFileSync(join(stepDir, "session.jsonl.absent"), Buffer.alloc(0));
        writeFileSync(join(stepDir, "meta.json"), JSON.stringify({
          phase,
          fileAbsent: true,
          fileBytes: 0,
          fileSha256: null,
          leafId: sessionManager.getLeafId(),
          entryCount: sessionManager.getEntries().length,
          model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined,
          sdkVersion,
          notices: notices.map((n) => n.message),
        }, null, 2));
        return;
      }
      const bytes = readFileSync(file);
      writeFileSync(join(stepDir, "session.jsonl"), bytes);
      writeFileSync(join(stepDir, "tree.json"), JSON.stringify(sessionManager.getTree(), null, 2));
      const meta = {
        phase,
        fileAbsent: false,
        leafId: sessionManager.getLeafId(),
        entryCount: sessionManager.getEntries().length,
        model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined,
        sdkVersion,
        notices: notices.map((n) => n.message),
        fileBytes: bytes.length,
        fileSha256: createHash("sha256").update(bytes).digest("hex"),
        // Passive snapshots of the actual SDK phase flags at this moment. These are read-only
        // observations of the real session/agent state, not invented fields: sdkIsStreaming is the
        // run flag (AgentSession.isStreaming, true once _startRun sets _isAgentRunActive before
        // _prepareRun), sdkIsIdle the derived idle state, and coreIsStreaming the agent-core
        // pre-token streaming flag (false while a run is still in its prepare phase). Together
        // they make the exact busy-valid phase (run active, not yet streaming tokens) visible in
        // the raw artifact alongside the .jsonl bytes and tree.
        sdkIsStreaming: session.isStreaming,
        sdkIsIdle: session.isIdle,
        coreIsStreaming: session.agent.state.isStreaming,
      };
      writeFileSync(join(stepDir, "meta.json"), JSON.stringify(meta, null, 2));
    };
    artifactLog = {
      events: capturedEvents,
      testId: testName,
      harnessId,
      before(phase: string): CommandToken {
        const token: CommandToken = {
          id: `cmd-${String(cmdCounter++).padStart(3, "0")}`,
          eventIndexStart: capturedEvents.length,
        };
        const cmdDir = join(artifactDir, testDirName, harnessId, token.id);
        writeStep(cmdDir, phase);
        return token;
      },
      after(token: CommandToken, phase: string): void {
        const cmdDir = join(artifactDir, testDirName, harnessId, token.id);
        writeStep(cmdDir, phase);
        // Command-scoped event slice: from the boundary recorded at before() to the current buffer end.
        const slice = capturedEvents.slice(token.eventIndexStart);
        writeFileSync(join(cmdDir, phase, "events.jsonl"), slice.map((e) => JSON.stringify(e)).join("\n") + "\n");
        writeFileSync(join(cmdDir, phase, "event-boundary.json"), JSON.stringify({
          commandId: token.id,
          eventIndexStart: token.eventIndexStart,
          eventIndexEnd: capturedEvents.length,
          eventCount: slice.length,
          observerRegistered: true,
        }, null, 2));
        // Persist the full event buffer too: tool_call/tool_result events for the handoff
        // record happen BEFORE the command (during recordHandoff), so the command slice
        // alone would miss them. The full buffer preserves the actual tool execution lifecycle.
        const fullDir = join(cmdDir, `${phase}-full-events`);
        mkdirSync(fullDir, { recursive: true });
        writeFileSync(join(fullDir, "events.jsonl"), capturedEvents.map((e) => JSON.stringify(e)).join("\n") + "\n");
        writeFileSync(join(fullDir, "event-boundary.json"), JSON.stringify({
          commandId: token.id,
          eventIndexStart: 0,
          eventIndexEnd: capturedEvents.length,
          eventCount: capturedEvents.length,
          observerRegistered: true,
          note: "full buffer from harness creation through this after() call",
        }, null, 2));
      },
      flushFullEvents(label: string): void {
        const stepDir = join(artifactDir, testDirName, harnessId, label);
        mkdirSync(stepDir, { recursive: true });
        writeFileSync(join(stepDir, "events.jsonl"), capturedEvents.map((e) => JSON.stringify(e)).join("\n") + "\n");
        writeFileSync(join(stepDir, "event-boundary.json"), JSON.stringify({
          commandId: label,
          eventIndexStart: 0,
          eventIndexEnd: capturedEvents.length,
          eventCount: capturedEvents.length,
          observerRegistered: true,
        }, null, 2));
      },
      finalizeFullEvents(): void {
        this.flushFullEvents("disposal-full-events");
      },
    };
  }

  const result: Harness = {
    dir,
    session,
    sessionManager,
    file,
    notices,
    confirmAnswer,
    confirms,
    confirmMode,
    nextConfirm: () => new Promise<void>((resolve) => confirmWaiters.push(resolve)),
    core,
    artifactLog,
    dispose() {
      artifactLog?.finalizeFullEvents();
      session.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return result;
}

export function lastAssistantId(sm: SessionManager): string {
  const entries = sm.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as any;
    if (e.type === "message" && e.message?.role === "assistant") return e.id;
  }
  throw new Error("no assistant entry");
}

export function readBytes(file: string): Buffer {
  return readFileSync(file);
}

export function responses(...steps: FauxResponseStep[]): FauxResponseStep[] {
  return steps;
}

export { fauxAssistantMessage, fauxText, fauxToolCall };
