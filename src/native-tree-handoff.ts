import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Native tree handoff spike (docs/native-tree-retirement-plan.md, rev5).
 *
 * Stage 1 (agent): `native_tree_targets` lists candidate non-user ancestors; `handoff_record`
 * stores exact handoff text as a tool result (details: schema, handoffId, targetId, text, sha256).
 * Stage 2 (user, explicit): `/tree-handoff <handoffId>` re-validates the current branch, sets a
 * memory-only pending record, calls `ctx.navigateTree(targetId, { summarize: true })`, and our
 * `session_before_tree` handler supplies the recorded text as the branch summary. A post-commit
 * verifier classifies the outcome from the session file and the in-memory branch.
 */

export const NATIVE_TREE_HANDOFF_ENABLED_VAR = "PI_NATIVE_TREE_HANDOFF_ENABLED";
export const HANDOFF_SCHEMA = "native-tree-handoff/v1";
export const HANDOFF_TOOL = "handoff_record";
export const TARGETS_TOOL = "native_tree_targets";
export const HANDOFF_COMMAND = "tree-handoff";

const EXCERPT_CHARS = 160;
const MAX_CANDIDATES = 20;
/** Appended to outcome reports that follow navigation when no UI is bound (the confirmation step was skipped). */
export const NO_UI_CONFIRMATION_NOTICE = "No UI confirmation was shown.";
/**
 * Timeout passed to ui.confirm. Pi's RPC dialog waits indefinitely without a timeout (modes/rpc/rpc-mode.js
 * createDialogPromise); with a timeout it resolves to the default, which is false for confirm. A timeout
 * bounds how long an unanswered confirmation can hold the in-flight lock.
 */
export const CONFIRM_TIMEOUT_MS = 120_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Entries allowed after the handoff record (classified from session-format.md).
 * usage/custom/label/session_info are metadata. model_change and thinking_level_change are model state, not message content.
 * None of them authors a continuation.
 */
const METADATA_ENTRY_TYPES = new Set([
  "usage",
  "custom",
  "label",
  "session_info",
  "model_change",
  "thinking_level_change",
]);

/** Structural view of a session entry; avoids importing Pi's internal entry types. */
export type BranchEntry = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp?: string;
  message?: Record<string, unknown> & { role?: string };
  [key: string]: unknown;
};

export type HandoffDetails = {
  schema: typeof HANDOFF_SCHEMA;
  handoffId: string;
  targetId: string;
  text: string;
  sha256: string;
};

export type RejectCode =
  | "NO_HANDOFF_ID"
  | "NO_VALID_HANDOFF"
  | "HANDOFF_MALFORMED"
  | "HANDOFF_SUPERSEDED"
  | "TARGET_NOT_ON_PATH"
  | "TARGET_NOT_ASSISTANT"
  | "TARGET_IS_LEAF"
  | "NO_FINAL_RESPONSE"
  | "MULTIPLE_RESPONSES_AFTER_RECORD"
  | "NOT_NORMAL_STOP"
  | "EFFECTFUL_AFTER_RECORD"
  | "USER_AFTER_RECORD"
  | "NON_METADATA_AFTER_RECORD"
  | "NO_MODEL"
  | "NOT_IDLE"
  | "NO_SESSION_FILE"
  | "SESSION_UNREADABLE"
  | "ALREADY_IN_PROGRESS";

export type Rejection = { ok: false; code: RejectCode; message: string };

export type ValidatedHandoff = {
  ok: true;
  record: HandoffDetails;
  recordEntryId: string;
  target: BranchEntry;
  finalResponseId: string;
  leafId: string;
};

export type Pending = {
  handoffId: string;
  targetId: string;
  oldLeafId: string;
  text: string;
  sha256: string;
};

export type CommandStatus =
  | "success"
  | "rejected"
  | "declined"
  | "cancelled"
  | "collision"
  | "unexpected"
  | "thrown"
  | "uncertain"
  | "integrity-violation";

export type CommandReport = {
  status: CommandStatus;
  message: string;
  reasons: string[];
  hookDecision?: "summary" | "cancel" | "error";
  treeEventCount: number;
  summaryEntryId?: string;
};

/** Injection points. Production code uses the defaults; tests may supply them programmatically (no env flags). */
export type NativeTreeHandoffDependencies = {
  /** Decides whether a `session_before_tree` event matches the pending record. Throwing is caught by the handler. */
  matchPreparation?: (pending: Pending, preparation: TreePreparationLike) => boolean;
  /** Reads the session file; used for the pre-commit snapshot and the post-commit re-read. */
  readSessionFile?: (path: string) => Promise<Buffer>;
};

type TreePreparationLike = {
  targetId: string;
  oldLeafId: string | null;
  userWantsSummary?: boolean;
};

type TreeEventLike = {
  newLeafId?: string | null;
  oldLeafId?: string | null;
  summaryEntry?: { id?: string } | null;
  fromExtension?: boolean;
};

type SessionFileState = { bytes?: Buffer; error?: string };

type SharedState = {
  /** Synchronously claimed for the whole command invocation (before any await); overlapping commands are rejected. */
  inFlight: boolean;
  pending?: Pending;
  hookDecision?: "summary" | "cancel" | "error";
  treeEvents: TreeEventLike[];
};

export function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isNativeTreeHandoffEnabled(): boolean {
  return process.env[NATIVE_TREE_HANDOFF_ENABLED_VAR] === "true";
}

/**
 * Pi's no-model placeholder: pi-agent-core DEFAULT_MODEL (0.99.1 and bundled 1.4.0) uses id/provider "unknown".
 * A falsy check never fires in a session without a model, so this sentinel is what NO_MODEL must match.
 */
export function hasUsableModel(model: { provider?: string; id?: string } | undefined): boolean {
  return Boolean(model) && !(model?.provider === "unknown" && model?.id === "unknown");
}

function messageOf(entry: BranchEntry): Record<string, unknown> & { role?: string } {
  return entry.message ?? {};
}

function isToolResultOf(entry: BranchEntry, toolName: string): boolean {
  if (entry.type !== "message") return false;
  const m = messageOf(entry);
  return m.role === "toolResult" && m.toolName === toolName && m.isError !== true;
}

/** Strict shape + integrity check for a stored handoff record. */
export function parseHandoffDetails(details: unknown): HandoffDetails | undefined {
  if (!details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;
  if (d.schema !== HANDOFF_SCHEMA) return undefined;
  if (typeof d.handoffId !== "string" || !UUID_RE.test(d.handoffId)) return undefined;
  if (typeof d.targetId !== "string" || d.targetId.length === 0) return undefined;
  if (typeof d.text !== "string" || d.text.trim().length === 0) return undefined;
  if (typeof d.sha256 !== "string" || d.sha256 !== sha256Utf8(d.text)) return undefined;
  return {
    schema: HANDOFF_SCHEMA,
    handoffId: d.handoffId,
    targetId: d.targetId,
    text: d.text,
    sha256: d.sha256,
  };
}

function textOf(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text as string)
    .join(" ");
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat;
}

/** Non-user ancestors on the current path, newest first, excluding the leaf. Used by the inspection tool. */
export function listTargetCandidates(branch: BranchEntry[], leafId: string | null): BranchEntry[] {
  return branch
    .filter((e) => e.id !== leafId && e.type === "message" && messageOf(e).role === "assistant")
    .reverse()
    .slice(0, MAX_CANDIDATES);
}

function reject(code: RejectCode, message: string): Rejection {
  return { ok: false, code, message };
}

/**
 * Pure preflight over the current branch (root..leaf). Returns the validated handoff or a
 * user-facing rejection. Session data is not mutated.
 */
export function validateHandoff(
  branch: BranchEntry[],
  leafId: string | null,
  handoffId: string,
): ValidatedHandoff | Rejection {
  if (!handoffId) return reject("NO_HANDOFF_ID", `Usage: /${HANDOFF_COMMAND} <handoffId>`);
  if (leafId === null) return reject("NO_VALID_HANDOFF", "The session has no current leaf.");

  const records: { index: number; entry: BranchEntry; details: unknown }[] = [];
  branch.forEach((entry, index) => {
    if (isToolResultOf(entry, HANDOFF_TOOL)) {
      records.push({ index, entry, details: messageOf(entry).details });
    }
  });
  if (records.length === 0) {
    return reject("NO_VALID_HANDOFF", "No handoff record exists on the current branch.");
  }

  const matchIdx = records.findIndex(
    (r) => (r.details as { handoffId?: unknown } | undefined)?.handoffId === handoffId,
  );
  if (matchIdx < 0) {
    return reject(
      "NO_VALID_HANDOFF",
      `No handoff record with id ${handoffId} exists on the current branch.`,
    );
  }
  const latest = records[records.length - 1];
  const record = parseHandoffDetails(records[matchIdx].details);
  if (!record) {
    return reject(
      "HANDOFF_MALFORMED",
      `Handoff ${handoffId} failed the schema or sha256 check and was not used.`,
    );
  }
  if (matchIdx !== records.length - 1) {
    const latestId = (latest.details as { handoffId?: unknown } | undefined)?.handoffId;
    return reject(
      "HANDOFF_SUPERSEDED",
      `Handoff ${handoffId} is superseded by a later record (${String(latestId)}). Use the latest id.`,
    );
  }

  const recordIndex = records[matchIdx].index;
  const recordEntry = records[matchIdx].entry;
  const recordToolCallId = messageOf(recordEntry).toolCallId;

  // Same-batch check: other tool calls in the assistant message that issued handoff_record are effectful.
  for (let i = 0; i < recordIndex; i++) {
    const m = branch[i].type === "message" ? messageOf(branch[i]) : undefined;
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    const calls = (m.content as any[]).filter((b) => b && b.type === "toolCall");
    if (calls.some((c) => c.id === recordToolCallId)) {
      const others = calls.filter((c) => c.id !== recordToolCallId);
      if (others.length > 0) {
        return reject(
          "EFFECTFUL_AFTER_RECORD",
          `The handoff turn also issued other tool calls (${others.map((c) => c.name).join(", ")}); the handoff is not valid.`,
        );
      }
    }
  }

  // Post-record classification: any entry that is not metadata, or any second response, rejects.
  let finalResponseId: string | undefined;
  for (const entry of branch.slice(recordIndex + 1)) {
    if (entry.type === "message") {
      const m = messageOf(entry);
      if (m.role === "assistant") {
        const content = Array.isArray(m.content) ? (m.content as any[]) : [];
        if (content.some((b) => b && b.type === "toolCall")) {
          return reject("EFFECTFUL_AFTER_RECORD", "A tool call was issued after the handoff record.");
        }
        if (m.stopReason !== "stop") {
          return reject(
            "NOT_NORMAL_STOP",
            `The response after the handoff record ended with stopReason ${String(m.stopReason)}.`,
          );
        }
        if (finalResponseId !== undefined) {
          return reject(
            "MULTIPLE_RESPONSES_AFTER_RECORD",
            "More than one assistant response followed the handoff record.",
          );
        }
        finalResponseId = entry.id;
        continue;
      }
      if (m.role === "toolResult") {
        return reject("EFFECTFUL_AFTER_RECORD", "A tool result was recorded after the handoff record.");
      }
      if (m.role === "user") {
        return reject("USER_AFTER_RECORD", "A user message was sent after the handoff record.");
      }
      return reject(
        "NON_METADATA_AFTER_RECORD",
        `An entry (${String(m.role)}) after the handoff record is not classified as metadata.`,
      );
    }
    if (METADATA_ENTRY_TYPES.has(entry.type)) continue;
    return reject(
      "NON_METADATA_AFTER_RECORD",
      `An entry of type ${entry.type} after the handoff record is not classified as metadata.`,
    );
  }
  if (finalResponseId === undefined) {
    return reject("NO_FINAL_RESPONSE", "The handoff turn has no final assistant response yet.");
  }

  const target = branch.slice(0, recordIndex).find((e) => e.id === record.targetId);
  if (!target) {
    return reject("TARGET_NOT_ON_PATH", `Target ${record.targetId} is not on the current path before the record.`);
  }
  if (target.type !== "message" || messageOf(target).role !== "assistant") {
    return reject("TARGET_NOT_ASSISTANT", `Target ${record.targetId} is not an assistant message.`);
  }
  if (target.id === leafId) {
    return reject("TARGET_IS_LEAF", `Target ${record.targetId} is the current leaf; nothing would be abandoned.`);
  }

  return { ok: true, record, recordEntryId: recordEntry.id, target, finalResponseId, leafId };
}

/**
 * File-level verification: `after` must start with the exact pre-commit bytes (old entries untouched),
 * and the appended lines must contain exactly one expected branch_summary entry.
 *
 * Minimal contract: preserve old bytes + exact summary + no unexplained context-changing appends.
 * Other appended entries are accepted only if they match the six source-classified metadata types
 * (METADATA_ENTRY_TYPES) with unique, non-colliding IDs. This is not full untrusted session schema
 * validation, and does not claim all third-party extension effects are safe.
 */
export function verifyFileBytes(
  before: Buffer,
  after: Buffer,
  expected: { summaryEntryId: string; targetId: string; text: string; handoffId: string; sha256: string },
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (after.length < before.length || !after.subarray(0, before.length).equals(before)) {
    reasons.push("session file prefix changed: existing entries are not byte-identical");
    return { ok: false, reasons };
  }
  const appended = after.subarray(before.length).toString("utf8");
  const lines = appended.split("\n").filter((l) => l.trim().length > 0);
  const entries: Record<string, any>[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        typeof parsed.id !== "string" ||
        parsed.id.length === 0 ||
        typeof parsed.type !== "string" ||
        parsed.type.length === 0
      ) {
        reasons.push(`appended line is not a well-formed session entry (id and type must be non-empty strings)`);
        continue;
      }
      entries.push(parsed);
    } catch {
      reasons.push(`appended line is not valid JSON`);
    }
  }
  const found = entries.filter((e) => e.id === expected.summaryEntryId);
  if (found.length === 0) {
    reasons.push("appended file content has no entry with the summary entry id");
    return { ok: false, reasons };
  }
  if (found.length > 1) {
    reasons.push(`appended file content has ${found.length} entries with the summary entry id; expected exactly one`);
    return { ok: false, reasons };
  }
  const entry = found[0];
  if (entry.type !== "branch_summary") reasons.push(`file entry type is ${entry.type}, expected branch_summary`);
  if (entry.parentId !== expected.targetId) reasons.push("file entry parentId is not the target");
  if (entry.fromHook !== true) reasons.push("file entry fromHook is not true");
  if (entry.summary !== expected.text) reasons.push("file entry summary text differs from the recorded text");
  if (entry.details?.handoffId !== expected.handoffId || entry.details?.sha256 !== expected.sha256) {
    reasons.push("file entry details do not match the pending handoffId/sha256");
  }
  // Shared source-grounded metadata set (not a duplicate allowlist): the six types that
  // METADATA_ENTRY_TYPES classifies as metadata. Any other appended entry type — a second
  // branch_summary, a compaction, a custom_message, a message, or an unknown type — is an anomaly.
  // Duplicate IDs within the appended set (including replay of IDs already in `before`) are also
  // anomalies, because the session file is append-only and each entry has a unique ID.
  const beforeIds = new Set(
    before.toString("utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => {
      try {
        const e = JSON.parse(l);
        return e && typeof e === "object" && typeof e.id === "string" && e.id.length > 0 ? e.id : null;
      } catch {
        return null;
      }
    }).filter((id) => id !== null),
  );
  // The summary ID itself must be fresh: if it already appears in `before`, the append is a
  // replay of an existing entry, not a new summary.
  if (beforeIds.has(expected.summaryEntryId)) {
    reasons.push(`summary entry id ${expected.summaryEntryId} already exists in the pre-commit file; this is a replay, not a new summary`);
    return { ok: false, reasons };
  }
  const others = entries.filter((e) => e.id !== expected.summaryEntryId);
  const seenIds = new Set<string>();
  const anomalies: string[] = [];
  for (const e of others) {
    if (!METADATA_ENTRY_TYPES.has(e.type)) {
      anomalies.push(`${e.type}(${e.id})`);
      continue;
    }
    if (seenIds.has(e.id)) {
      anomalies.push(`duplicate ${e.type}(${e.id})`);
      continue;
    }
    if (beforeIds.has(e.id)) {
      anomalies.push(`replayed ${e.type}(${e.id})`);
      continue;
    }
    seenIds.add(e.id);
  }
  if (anomalies.length > 0) {
    reasons.push(`unexplained appended entries beyond the summary: ${anomalies.join(", ")}`);
  }
  return { ok: reasons.length === 0, reasons };
}

function defaultMatch(pending: Pending, preparation: TreePreparationLike): boolean {
  return (
    preparation.targetId === pending.targetId &&
    preparation.oldLeafId === pending.oldLeafId &&
    preparation.userWantsSummary === true
  );
}

function summaryEntryMatches(
  entry: BranchEntry & { summary?: unknown; fromHook?: unknown },
  pending: Pending,
): string[] {
  const reasons: string[] = [];
  const details = (entry as { details?: unknown }).details as Record<string, unknown> | undefined;
  if (entry.type !== "branch_summary") reasons.push(`leaf entry is ${entry.type}, not branch_summary`);
  if (entry.parentId !== pending.targetId) reasons.push("summary parent is not the target");
  if (entry.fromHook !== true) reasons.push("summary fromHook is not true (not produced by our hook)");
  if (details?.handoffId !== pending.handoffId) reasons.push("summary details.handoffId does not match");
  if (details?.sha256 !== pending.sha256) reasons.push("summary details.sha256 does not match");
  if (entry.summary !== pending.text) reasons.push("summary text differs from the recorded text");
  return reasons;
}

async function readFileState(
  read: (path: string) => Promise<Buffer>,
  file: string,
): Promise<SessionFileState> {
  try {
    return { bytes: await read(file) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const defaultReadSessionFile = (path: string): Promise<Buffer> => readFile(path);

/**
 * Registers the spike: the agent-facing tools, the explicit command, and the
 * `session_before_tree` / `session_tree` observers. Registration is idempotent per ExtensionAPI.
 */
export default function registerNativeTreeHandoff(
  pi: ExtensionAPI,
  dependencies: NativeTreeHandoffDependencies = {},
): void {
  const matchPreparation = dependencies.matchPreparation ?? defaultMatch;
  const readSessionFile = dependencies.readSessionFile ?? defaultReadSessionFile;
  const state: SharedState = { inFlight: false, treeEvents: [] };

  pi.registerTool({
    name: TARGETS_TOOL,
    label: "Native tree targets",
    description:
      "List candidate non-user ancestors on the current branch (newest first) with entry ids and excerpts. Use before handoff_record to choose a target for a branch handoff.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_id, _params, _signal, _onUpdate, ctx: ExtensionContext) {
      const branch = ctx.sessionManager.getBranch() as unknown as BranchEntry[];
      const candidates = listTargetCandidates(branch, ctx.sessionManager.getLeafId());
      const lines = candidates.map(
        (c) => `- ${c.id} (assistant, ${c.timestamp ?? "no timestamp"}): ${excerpt(textOf(messageOf(c)))}`,
      );
      return {
        content: [
          {
            type: "text",
            text: candidates.length
              ? `Candidate targets (newest first):\n${lines.join("\n")}`
              : "No candidate targets: the current branch has no earlier assistant message.",
          },
        ],
        details: {
          candidates: candidates.map((c) => ({ id: c.id, timestamp: c.timestamp, excerpt: excerpt(textOf(messageOf(c))) })),
        },
      };
    },
  });

  pi.registerTool({
    name: HANDOFF_TOOL,
    label: "Record native tree handoff",
    description: [
      "Record an exact handoff text that will replace the abandoned branch below targetId as a branch summary when the user runs /tree-handoff.",
      "targetId must be an assistant entry id from native_tree_targets on the current branch.",
      "Call this tool at most once, then give a short final response in the same turn. Do not call any other tool in this turn or after it.",
    ].join(" "),
    parameters: Type.Object({
      targetId: Type.String({ minLength: 1, description: "Assistant entry id on the current branch" }),
      text: Type.String({ minLength: 1, description: "Exact handoff text to keep from the abandoned branch" }),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const branch = ctx.sessionManager.getBranch() as unknown as BranchEntry[];
      const leafId = ctx.sessionManager.getLeafId();
      const target = branch.find((e) => e.id === params.targetId);
      if (!target) throw new Error(`Target ${params.targetId} is not on the current branch.`);
      if (target.type !== "message" || messageOf(target).role !== "assistant") {
        throw new Error(`Target ${params.targetId} is not an assistant message.`);
      }
      if (target.id === leafId) throw new Error(`Target ${params.targetId} is the current leaf.`);
      if (params.text.trim().length === 0) throw new Error("Handoff text must not be blank.");
      const details: HandoffDetails = {
        schema: HANDOFF_SCHEMA,
        handoffId: randomUUID(),
        targetId: params.targetId,
        text: params.text,
        sha256: sha256Utf8(params.text),
      };
      return {
        content: [
          {
            type: "text",
            text: `Recorded handoff ${details.handoffId} for ${details.targetId}. The user runs /${HANDOFF_COMMAND} ${details.handoffId} to apply it.`,
          },
        ],
        details,
      };
    },
  });

  pi.on("session_before_tree", (event) => {
    const pending = state.pending;
    if (!pending) {
      state.hookDecision = undefined;
      return undefined;
    }
    try {
      if (!matchPreparation(pending, event.preparation as TreePreparationLike)) {
        state.hookDecision = "cancel";
        return { cancel: true };
      }
      state.hookDecision = "summary";
      return {
        summary: {
          summary: pending.text,
          details: { schema: HANDOFF_SCHEMA, handoffId: pending.handoffId, sha256: pending.sha256 },
        },
      };
    } catch {
      // Our own internal error, handled as our decision: cancel rather than fall back to the default summarizer.
      state.hookDecision = "error";
      return { cancel: true };
    }
  });

  pi.on("session_tree", (event) => {
    if (state.pending) state.treeEvents.push(event as TreeEventLike);
  });

  pi.registerCommand(HANDOFF_COMMAND, {
    description: "Apply a recorded native tree handoff: /tree-handoff <handoffId>",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      // Without a bound UI, ui.notify is a silent no-op, so every outcome is also written to stderr.
      // The confirmation suffix is added only when navigation was attempted; rejected and declined outcomes happen before navigation.
      const reportNoUi = (message: string, navigationAttempted: boolean) => {
        if (ctx.hasUI) return;
        console.warn(navigationAttempted ? `${message} ${NO_UI_CONFIRMATION_NOTICE}` : message);
      };
      // Claimed synchronously, before the first await, so overlapping invocations cannot both pass the check.
      // Released unconditionally in finally (early rejection, declined confirmation, or throw).
      if (state.inFlight) {
        const message = "ALREADY_IN_PROGRESS: another tree handoff is in flight. Nothing was changed.";
        ctx.ui.notify(message, "warning");
        reportNoUi(message, false);
        return;
      }
      state.inFlight = true;
      try {
        const report = await runHandoffCommand(ctx, args.trim(), {
          state,
          readSessionFile,
          navigate: (targetId) => ctx.navigateTree(targetId, { summarize: true }),
        });
        ctx.ui.notify(report.message, report.status === "success" ? "info" : "warning");
        reportNoUi(report.message, report.status !== "rejected" && report.status !== "declined");
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const message = `UNEXPECTED: tree handoff threw (${detail}). Session state must be inspected.`;
        ctx.ui.notify(message, "warning");
        reportNoUi(message, false);
      } finally {
        state.inFlight = false;
      }
    },
  });

  async function runHandoffCommand(
    ctx: ExtensionCommandContext,
    handoffId: string,
    run: {
      state: SharedState;
      readSessionFile: (path: string) => Promise<Buffer>;
      navigate: (targetId: string) => Promise<{ cancelled: boolean }>;
    },
  ): Promise<CommandReport> {
    const rejected = (code: RejectCode, message: string): CommandReport => ({
      status: "rejected",
      message: `${code}: ${message}. Nothing was changed.`,
      reasons: [code],
      treeEventCount: 0,
    });

    await ctx.waitForIdle();
    if (!hasUsableModel(ctx.model)) return rejected("NO_MODEL", "no model is configured");
    if (!ctx.isIdle()) return rejected("NOT_IDLE", "the session is not idle");
    const file = ctx.sessionManager.getSessionFile();
    if (!file) return rejected("NO_SESSION_FILE", "this session is not file-backed");

    const before = await readFileState(run.readSessionFile, file);
    if (!before.bytes) return rejected("SESSION_UNREADABLE", `session file unreadable: ${before.error}`);

    const preflight = validateHandoff(
      ctx.sessionManager.getBranch() as unknown as BranchEntry[],
      ctx.sessionManager.getLeafId(),
      handoffId,
    );
    if (!preflight.ok) return { status: "rejected", message: `${preflight.code}: ${preflight.message} Nothing was changed.`, reasons: [preflight.code], treeEventCount: 0 };

    const { record, target } = preflight;
    const targetExcerpt = excerpt(textOf(messageOf(target)));
    if (ctx.hasUI) {
      const ok = await ctx.ui.confirm(
        "Apply tree handoff?",
        `Target ${target.id} (assistant): "${targetExcerpt}"\nHandoff ${record.handoffId}, sha256 ${record.sha256}.\nThis confirms this exact target and handoff. The active context after the target will be replaced by a branch summary of the handoff text. The original branch below the target remains accessible.`,
        { timeout: CONFIRM_TIMEOUT_MS },
      );
      if (!ok) {
        return { status: "declined", message: "Tree handoff declined (or confirmation timed out). Nothing was changed.", reasons: ["DECLINED"], treeEventCount: 0 };
      }
    }

    // Re-validate after any confirmation wait; then set pending with no intervening await before navigation.
    const revalidated = validateHandoff(
      ctx.sessionManager.getBranch() as unknown as BranchEntry[],
      ctx.sessionManager.getLeafId(),
      handoffId,
    );
    if (!revalidated.ok) return { status: "rejected", message: `${revalidated.code}: ${revalidated.message} Nothing was changed.`, reasons: [revalidated.code], treeEventCount: 0 };

    const oldLeafId = ctx.sessionManager.getLeafId();
    if (oldLeafId === null) return rejected("NO_VALID_HANDOFF", "no current leaf");
    const pending: Pending = {
      handoffId: record.handoffId,
      targetId: record.targetId,
      oldLeafId,
      text: record.text,
      sha256: record.sha256,
    };

    run.state.treeEvents = [];
    run.state.hookDecision = undefined;
    run.state.pending = pending;
    let navResult: { cancelled: boolean } | undefined;
    let navError: string | undefined;
    try {
      navResult = await run.navigate(pending.targetId);
    } catch (error) {
      navError = error instanceof Error ? error.message : String(error);
    } finally {
      run.state.pending = undefined;
    }
    const treeEvents = run.state.treeEvents;
    const hookDecision = run.state.hookDecision;
    run.state.treeEvents = [];

    return verifyAfterNavigation({
      ctx,
      pending,
      before: before.bytes,
      file,
      navResult,
      navError,
      treeEvents,
      hookDecision,
      readSessionFile: run.readSessionFile,
    });
  }

  async function verifyAfterNavigation(input: {
    ctx: ExtensionCommandContext;
    pending: Pending;
    before: Buffer;
    file: string;
    navResult?: { cancelled: boolean };
    navError?: string;
    treeEvents: TreeEventLike[];
    hookDecision?: "summary" | "cancel" | "error";
    readSessionFile: (path: string) => Promise<Buffer>;
  }): Promise<CommandReport> {
    const { ctx, pending, before, file, navResult, navError, treeEvents, hookDecision } = input;
    const sm = ctx.sessionManager;
    const leafAfter = sm.getLeafId();
    const base = { treeEventCount: treeEvents.length, hookDecision };
    const reasons: string[] = [];

    if (navError !== undefined) {
      reasons.push(`navigateTree threw: ${navError}`);
      const leafEntry = leafAfter ? (sm.getEntry(leafAfter) as BranchEntry | undefined) : undefined;
      const committedOurs = leafEntry?.type === "branch_summary" && summaryEntryMatches(leafEntry as never, pending).length === 0;
      reasons.push(committedOurs ? "verifier: our summary is the leaf" : "verifier: our summary is not the leaf");
      // Verify persisted state after a caught navigation error: if the file is unreadable
      // or the bytes differ from the preflight snapshot, the outcome is uncertain (the
      // persisted state is unverified). If byte-identical, retain the thrown failure but
      // explicitly state the persisted file is unchanged and report the actual in-memory leaf.
      const afterNavError = await readFileState(input.readSessionFile, file);
      if (afterNavError.error !== undefined) {
        return { ...base, status: "uncertain", message: `Tree handoff uncertain: navigateTree threw (${navError}). Persisted state unverified: ${afterNavError.error}. In-memory leaf: ${leafAfter ?? "null"}.`, reasons: [...reasons, "persisted-state-unverified"] };
      }
      if (afterNavError.bytes === undefined || !afterNavError.bytes.equals(before)) {
        return { ...base, status: "uncertain", message: `Tree handoff uncertain: navigateTree threw (${navError}). Persisted state unverified: file bytes differ from preflight snapshot. In-memory leaf: ${leafAfter ?? "null"}.`, reasons: [...reasons, "persisted-state-unverified"] };
      }
      return { ...base, status: "thrown", message: `Tree handoff failed: navigateTree threw (${navError}). ${reasons.join("; ")}. Persisted file unchanged (byte-identical to preflight). In-memory leaf: ${leafAfter ?? "null"}.`, reasons, summaryEntryId: committedOurs ? leafEntry?.id : undefined };
    }

    if (navResult?.cancelled) {
      const anomalous = treeEvents.length > 0 || leafAfter !== pending.oldLeafId;
      if (anomalous) {
        return { ...base, status: "uncertain", message: "Navigation reported cancelled but the session changed; state needs inspection.", reasons: ["cancelled with session change"] };
      }
      return { ...base, status: "cancelled", message: `Tree handoff cancelled (hook decision: ${String(hookDecision)}). No navigation happened.`, reasons: ["CANCELLED"] };
    }

    if (leafAfter === pending.oldLeafId && treeEvents.length === 0) {
      return { ...base, status: "unexpected", message: "navigateTree returned without cancelling, but nothing was committed (leaf and session_tree unchanged).", reasons: ["NOT_COMMITTED"] };
    }

    const leafEntry = leafAfter ? (sm.getEntry(leafAfter) as (BranchEntry & { summary?: unknown; fromHook?: unknown }) | undefined) : undefined;
    if (!leafEntry || leafEntry.type !== "branch_summary") {
      return { ...base, status: "unexpected", message: "The leaf moved without a branch_summary entry; this is not the handoff.", reasons: ["NO_SUMMARY_ENTRY"] };
    }
    if (treeEvents.length !== 1 || treeEvents[0].summaryEntry?.id !== leafEntry.id || treeEvents[0].newLeafId !== leafAfter) {
      reasons.push("session_tree event does not match the committed summary entry");
    }
    reasons.push(...summaryEntryMatches(leafEntry, pending));

    const summaryEntryId = leafEntry.id;
    if (reasons.length > 0) {
      return { ...base, status: "collision", summaryEntryId, message: `Collision: the committed summary is not this handoff (${reasons.join("; ")}).`, reasons };
    }

    const after = await readFileState(input.readSessionFile, file);
    if (!after.bytes) {
      return { ...base, status: "uncertain", summaryEntryId, message: `Committed in memory, but the session file could not be re-read (${after.error}); state is uncertain.`, reasons: ["REREAD_FAILED"] };
    }
    try {
      const fileCheck = verifyFileBytes(before, after.bytes, {
        summaryEntryId,
        targetId: pending.targetId,
        text: pending.text,
        handoffId: pending.handoffId,
        sha256: pending.sha256,
      });
      if (!fileCheck.ok) {
        return { ...base, status: "integrity-violation", summaryEntryId, message: `Session file check failed: ${fileCheck.reasons.join("; ")}`, reasons: fileCheck.reasons };
      }
    } catch (error) {
      return { ...base, status: "uncertain", summaryEntryId, message: `Session file could not be parsed after commit: ${String(error)}`, reasons: ["PARSE_FAILED"] };
    }

    return { ...base, status: "success", summaryEntryId, message: `Tree handoff applied: summary ${summaryEntryId} under ${pending.targetId}; handoff ${pending.handoffId}.`, reasons: [] };
  }
}
