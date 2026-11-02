import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  confirmAnswer: { value: boolean };
  /** Every ui.confirm call as the runner delivered it (title, message, options). */
  confirms: { title: string; message: string; opts?: { timeout?: number } }[];
  /** "answer": resolve with confirmAnswer. "rpc-timeout": mirror Pi RPC dialogs (see confirmStub). */
  confirmMode: { value: "answer" | "rpc-timeout" };
  /** Resolves on the next ui.confirm call, so tests can advance fake timers only after the dialog exists. */
  nextConfirm(): Promise<void>;
  core: ReturnType<typeof createFauxCore>;
  dispose(): void;
};

export type Extension = (pi: ExtensionAPI) => void;

export async function createHarness(options: {
  extensions: Extension[];
  withModel?: boolean;
  /** Bind a UI context (hasUI true, notifications captured). Default true. */
  ui?: boolean;
  /** Bind commandContextActions (navigateTree, waitForIdle) as print/RPC modes do. Default true. */
  bindCommandActions?: boolean;
  dir?: string;
  sessionFile?: string;
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
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    extensionFactories: options.extensions.map((factory) => (pi: ExtensionAPI) => factory(pi)),
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
  const confirmAnswer = { value: true };
  const confirms: { title: string; message: string; opts?: { timeout?: number } }[] = [];
  const confirmMode: { value: "answer" | "rpc-timeout" } = { value: "answer" };
  const confirmWaiters: (() => void)[] = [];
  /**
   * Mirrors Pi RPC dialogs (modes/rpc/rpc-mode.js createDialogPromise, verified in the installed runtime):
   * without a timeout the promise waits for a response that never comes; with opts.timeout it resolves to the
   * default, false for confirm. Both branches of the real contract are reproduced; no response is ever sent.
   */
  const confirmStub = (title: string, message: string, opts?: { timeout?: number; signal?: AbortSignal }) => {
    confirms.push({ title, message, opts: opts ? { timeout: opts.timeout } : undefined });
    for (const wake of confirmWaiters.splice(0)) wake();
    if (confirmMode.value === "answer") return Promise.resolve(confirmAnswer.value);
    return new Promise<boolean>((resolve) => {
      if (opts?.timeout) setTimeout(() => resolve(false), opts.timeout);
    });
  };
  // Bind a UI context so command notifications and confirmations are observable through the real runner.
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
  // Same binding print/RPC modes provide. Unbound, ctx.navigateTree is a silent no-op (0.99.1 SDK default).
  const commandContextActions =
    options.bindCommandActions === false
      ? undefined
      : {
          waitForIdle: () => session.waitForIdle(),
          navigateTree: (targetId: string, opts?: Record<string, unknown>) => session.navigateTree(targetId, opts as never),
        };
  await session.bindExtensions({ uiContext, commandContextActions } as never);

  const file = sessionManager.getSessionFile() ?? "";
  return {
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
    dispose() {
      session.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
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
