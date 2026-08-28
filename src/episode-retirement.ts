import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import {
  buildSessionContext,
  keyHint,
  type ExtensionAPI,
  type SessionManager,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { ThinkingLevel } from "@earendil-works/pi-ai";

/** Public extension hooks expose these structurally; avoid importing Pi's private transitive agent-core package. */
type AgentMessage = {
  role: string;
  content: unknown;
  timestamp: number;
  [key: string]: unknown;
};

export const EPISODE_RETIREMENT_ENABLED_VAR = "PI_EPISODE_RETIREMENT_ENABLED";
const RECEIPT_TYPE = "episode-retirement";
const MODEL_VAR = "PI_EPISODE_RETIREMENT_MODEL";
const EFFORT_VAR = "PI_EPISODE_RETIREMENT_REASONING_EFFORT";
const REDACT_VAR = "PI_EPISODE_RETIREMENT_REDACT";
const THINKING_LEVELS = new Set<ThinkingLevel>([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export const CAPSULE_MAX_FIELD_CHARS = 2_000;
export const CAPSULE_MAX_ITEM_CHARS = 1_000;
export const CAPSULE_MAX_ITEMS = 32;
export const CAPSULE_MAX_JSON_CHARS = 8_000;
export const CONTINUATION_GOAL_MAX_CHARS = 1_000;

export type SessionLikeEntry = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: AgentMessage;
  data?: unknown;
  customType?: string;
};

export type ContinuationCapsule = {
  objective: string;
  findings: string[];
  decisions: string[];
  unresolved: string[];
  nextStep: string;
};

type ReceiptBase = {
  kind: "episode-retirement";
  sourceEntryIds: string[];
  sourceFingerprints: string[];
  activeUserEntryId: string;
  capsule: ContinuationCapsule;
  replacementMetrics?: {
    completedEpisodeCount: number;
    sourceMessageCount: number;
    sourceMessageBytes: number;
    capsuleTextBytes: number;
  };
};
export type EpisodeRetirementReceiptV1 = ReceiptBase & { version: 1 };
export type EpisodeRetirementReceiptV2 = ReceiptBase & {
  version: 2;
  provider: string;
  model: string;
  reasoningEffort: ThinkingLevel;
  promptVersion: string;
  usage: Record<string, unknown>;
};
export type EpisodeRetirementReceiptV3 = ReceiptBase & {
  version: 3;
  generation: number;
  parentReceiptEntryId: string;
  parentReceiptFingerprint: string;
  priorCapsuleFingerprint: string;
  newlyCompletedEpisodeEntries: Array<{ id: string; fingerprint: string }>;
  provider: string;
  model: string;
  reasoningEffort: ThinkingLevel;
  promptVersion: "capsule-v3";
  usage: Record<string, unknown>;
  deltaMetrics: {
    newlyCompletedEpisodeCount: number;
    newlyCompletedMessageCount: number;
    newlyCompletedSourceBytes: number;
    cumulativeMessageCount: number;
    cumulativeSourceBytes: number;
    priorCapsuleTextBytes: number;
    newCapsuleTextBytes: number;
  };
};
export type EpisodeRetirementReceiptV4 = ReceiptBase & {
  version: 4;
  generation: number;
  parentReceiptEntryId: string;
  parentReceiptFingerprint: string;
  priorCapsuleFingerprint: string;
  newlyIncorporatedBeforeParentEntries: Array<{ id: string; fingerprint: string }>;
  newlyCompletedAfterParentEntries: Array<{ id: string; fingerprint: string }>;
  provider: string;
  model: string;
  reasoningEffort: ThinkingLevel;
  promptVersion: "capsule-v4";
  usage: Record<string, unknown>;
  compositionMetrics: {
    earlierEpisodeCount: number; earlierMessageCount: number; earlierSourceBytes: number;
    laterEpisodeCount: number; laterMessageCount: number; laterSourceBytes: number;
    cumulativeMessageCount: number; cumulativeSourceBytes: number;
    priorCapsuleTextBytes: number; newCapsuleTextBytes: number;
  };
};
export type EpisodeRetirementReceipt =
  | EpisodeRetirementReceiptV1
  | EpisodeRetirementReceiptV2
  | EpisodeRetirementReceiptV3
  | EpisodeRetirementReceiptV4;
type AnyReceipt = EpisodeRetirementReceipt;
type ReceiptEntry = SessionLikeEntry & { data: AnyReceipt };
const hashJson = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type SelectionReason =
  | "insufficient completed episodes"
  | "unsupported or nonstandard slot inside candidate"
  | "candidate does not end in a completed assistant"
  | "unmatched or out-of-order tool result"
  | "open tool calls"
  | "active user/source alignment";
type PreflightReason = SelectionReason
  | "parent range is unavailable"
  | "selection partially overlaps or gaps the parent range"
  | "V4 requires a completed after-parent interval"
  | "repeated retirement requires an exact forward delta";
type RefusalReasonKey =
  | "insufficientCompletedEpisodes"
  | "unsupportedCandidate"
  | "incompleteAssistantBoundary"
  | "unmatchedToolResult"
  | "openToolCalls"
  | "activeAlignment"
  | "parentUnavailable"
  | "partialOverlapOrGap"
  | "v4MissingAfterInterval"
  | "exactForwardRequired";
const refusalReasonKey: Record<PreflightReason, RefusalReasonKey> = {
  "insufficient completed episodes": "insufficientCompletedEpisodes",
  "unsupported or nonstandard slot inside candidate": "unsupportedCandidate",
  "candidate does not end in a completed assistant": "incompleteAssistantBoundary",
  "unmatched or out-of-order tool result": "unmatchedToolResult",
  "open tool calls": "openToolCalls",
  "active user/source alignment": "activeAlignment",
  "parent range is unavailable": "parentUnavailable",
  "selection partially overlaps or gaps the parent range": "partialOverlapOrGap",
  "V4 requires a completed after-parent interval": "v4MissingAfterInterval",
  "repeated retirement requires an exact forward delta": "exactForwardRequired",
};
type Selection = {
  sourceEntryIds: string[];
  sourceFingerprints: string[];
  activeUserEntryId: string;
  reason?: SelectionReason;
};
function refusedSelection(reason: SelectionReason): Selection {
  return { sourceEntryIds: [], sourceFingerprints: [], activeUserEntryId: "", reason };
}

type Projection = { applied: true; messages: AgentMessage[] } | {
  applied: false;
  reason: string;
};

function isPlainMessage(
  entry: SessionLikeEntry,
): entry is SessionLikeEntry & { message: AgentMessage } {
  return entry.type === "message" && entry.message !== undefined;
}

function isSupportedMessage(message: AgentMessage): boolean {
  if (message.role === "user" && typeof message.content === "string") {
    return true;
  }
  if (
    message.role === "user" || message.role === "assistant" ||
    message.role === "toolResult"
  ) {
    return Array.isArray(message.content) &&
      !message.content.some((part) => part.type === "image");
  }
  return false;
}

export function fingerprintEntry(entry: SessionLikeEntry): string {
  return createHash("sha256").update(JSON.stringify(entry.message)).digest(
    "hex",
  );
}

export function selectLatestCompletedEpisodes(
  entries: SessionLikeEntry[],
  count: number,
): Selection {
  if (!Number.isInteger(count) || count < 1) return refusedSelection("insufficient completed episodes");
  const userIndexes = entries.flatMap((entry, index) =>
    entry.type === "message" && entry.message?.role === "user" ? [index] : []
  );
  if (userIndexes.length < count + 1) return refusedSelection("insufficient completed episodes");
  const activeUserIndex = userIndexes.at(-1)!;
  const sourceStart = userIndexes[userIndexes.length - count - 1];
  const selected = entries.slice(sourceStart, activeUserIndex);
  if (selected.length === 0) return refusedSelection("active user/source alignment");
  if (selected.some((entry) => !isPlainMessage(entry) || !isSupportedMessage(entry.message))) {
    return refusedSelection("unsupported or nonstandard slot inside candidate");
  }
  if (selected.at(-1)?.message?.role !== "assistant") {
    return refusedSelection("candidate does not end in a completed assistant");
  }

  const openToolCalls = new Set<string>();
  for (const entry of selected) {
    const message = entry.message!;
    if (message.role === "assistant") {
      for (
        const part of message.content as Array<{ type: string; id?: string }>
      ) if (part.type === "toolCall" && part.id) openToolCalls.add(part.id);
    }
    if (message.role === "toolResult") {
      if (!openToolCalls.delete(message.toolCallId as string)) return refusedSelection("unmatched or out-of-order tool result");
    }
  }
  if (openToolCalls.size > 0) return refusedSelection("open tool calls");

  return {
    sourceEntryIds: selected.map((entry) => entry.id),
    sourceFingerprints: selected.map(fingerprintEntry),
    activeUserEntryId: entries[activeUserIndex].id,
  };
}

function capsuleText(
  capsule: ContinuationCapsule,
  sourceEntryIds: string[],
): string {
  const list = (title: string, items: string[]) =>
    items.length
      ? "\n" + title + ":\n" + items.map((item) => "- " + item).join("\n")
      : "";
  return "[CONTINUATION CAPSULE — episode retirement]\n" +
    "Objective: " + capsule.objective +
    list("Findings", capsule.findings) + list("Decisions", capsule.decisions) +
    list("Unresolved", capsule.unresolved) +
    "\nNext step: " + capsule.nextStep +
    "\nOriginal source entry IDs (recover with recall_episode): " +
    sourceEntryIds.join(", ");
}

function validatedRange(
  entries: SessionLikeEntry[],
  receipt: AnyReceipt,
): { start: number; activeIndex: number } | Projection {
  const activeIndex = entries.findIndex((entry) =>
    entry.id === receipt.activeUserEntryId
  );
  const sourceIndexes = receipt.sourceEntryIds.map((id) =>
    entries.findIndex((entry) => entry.id === id)
  );
  if (activeIndex < 0 || sourceIndexes.some((index) => index < 0)) {
    return { applied: false, reason: "source entries unavailable" };
  }
  const start = sourceIndexes[0];
  if (
    start < 0 ||
    sourceIndexes.some((index, offset) => index !== start + offset) ||
    start >= activeIndex
  ) return { applied: false, reason: "noncontiguous source entries" };
  const selected = entries.slice(start, activeIndex);
  if (
    selected.length !== receipt.sourceEntryIds.length ||
    selected.some((entry, index) =>
      !isPlainMessage(entry) ||
      fingerprintEntry(entry) !== receipt.sourceFingerprints[index]
    )
  ) return { applied: false, reason: "fingerprint mismatch" };
  if (
    !isPlainMessage(entries[activeIndex]) ||
    entries[activeIndex].message.role !== "user" ||
    !isSupportedMessage(entries[activeIndex].message)
  ) return { applied: false, reason: "active episode is not protected" };
  return { start, activeIndex };
}

function prependCapsule(message: AgentMessage, text: string): AgentMessage {
  if (typeof message.content === "string") {
    return { ...message, content: text + "\n\n" + message.content };
  }
  return {
    ...message,
    content: [
      { type: "text", text: text + "\n\n" },
      ...(message.content as unknown[]),
    ],
  };
}

export function applyEpisodeRetirement(
  entries: SessionLikeEntry[],
  receipt: AnyReceipt,
): Projection {
  const range = validatedRange(entries, receipt);
  if ("applied" in range) return range;
  const capsule = capsuleText(receipt.capsule, receipt.sourceEntryIds);
  const messages = entries.map((entry) => entry.message!);
  messages.splice(range.start, range.activeIndex - range.start);
  messages[range.start] = prependCapsule(messages[range.start], capsule);
  return { applied: true, messages };
}

export function projectEventMessages(
  entries: SessionLikeEntry[],
  eventMessages: AgentMessage[],
  receipt: AnyReceipt,
): Projection {
  if (
    entries.length !== eventMessages.length ||
    entries.some((entry, index) =>
      fingerprintEntry(entry) !==
        createHash("sha256").update(JSON.stringify(eventMessages[index]))
          .digest("hex")
    )
  ) return { applied: false, reason: "event message mismatch" };
  const range = validatedRange(entries, receipt);
  if ("applied" in range) return range;
  const messages = [...eventMessages];
  messages.splice(range.start, range.activeIndex - range.start);
  messages[range.start] = prependCapsule(
    messages[range.start],
    capsuleText(receipt.capsule, receipt.sourceEntryIds),
  );
  return { applied: true, messages };
}

/** Pair public context entries with their exact public slot payloads, then verify canonical context parity. */
type ContextReadonlyManager = Pick<SessionManager,
  "buildContextEntries" | "getEntries" | "getLeafId">;
function resolvedSlots(manager: ContextReadonlyManager): SessionLikeEntry[] {
  const slots: SessionLikeEntry[] = [];
  for (const entry of manager.buildContextEntries()) {
    for (const message of sessionEntryToContextMessages(entry)) {
      if (entry.type === "message" && createHash("sha256")
        .update(JSON.stringify(entry.message)).digest("hex") !== createHash("sha256")
        .update(JSON.stringify(message)).digest("hex")) {
        throw new Error("Episode retirement refused: resolved standard-message fingerprint mismatch.");
      }
      slots.push({ ...entry, message } as SessionLikeEntry);
    }
  }
  const canonical = buildSessionContext(manager.getEntries(), manager.getLeafId()).messages;
  if (slots.length !== canonical.length) {
    throw new Error("Episode retirement refused: resolved entry/message count mismatch.");
  }
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    const canonicalFingerprint = createHash("sha256").update(JSON.stringify(canonical[index])).digest("hex");
    if (fingerprintEntry(slot) !== canonicalFingerprint) {
      throw new Error("Episode retirement refused: resolved entry/message fingerprint mismatch.");
    }
  }
  return slots;
}

function getReceiptEntries(entries: SessionLikeEntry[]): ReceiptEntry[] {
  return entries.flatMap((entry) => entry.type === "custom" &&
    entry.customType === RECEIPT_TYPE && isReceipt(entry.data)
    ? [{ ...entry, data: entry.data }] : []);
}
function receiptRangeIsValid(entries: SessionLikeEntry[], receipt: AnyReceipt): boolean {
  return !("applied" in validatedRange(entries, receipt));
}
function exactCompletedInterval(entries: SessionLikeEntry[], start: number, active: number): boolean {
  const interval = entries.slice(start, active);
  const completedEpisodes = interval.filter((entry) => entry.type === "message" && entry.message?.role === "user").length;
  const selection = selectLatestCompletedEpisodes(entries.slice(0, active + 1), completedEpisodes);
  return completedEpisodes > 0 && selection.sourceEntryIds.length === interval.length &&
    selection.sourceEntryIds.every((id, index) => id === interval[index].id);
}
type RawMetrics = { completedEpisodeCount: number; sourceMessageCount: number; sourceMessageBytes: number };
function requiredRepeatedEpisodeCount(entries: SessionLikeEntry[], parentActiveId: string, activeId: string): number | undefined {
  const start = entries.findIndex((entry) => entry.id === parentActiveId);
  const active = entries.findIndex((entry) => entry.id === activeId);
  if (start < 0 || active <= start) return undefined;
  const interval = entries.slice(start, active);
  const required = interval.filter((entry) => entry.type === "message" && entry.message?.role === "user").length;
  const selection = selectLatestCompletedEpisodes([...interval, entries[active]], required);
  return required > 0 && selection.sourceEntryIds.length === interval.length &&
    selection.sourceEntryIds.every((id, index) => id === interval[index].id) ? required : undefined;
}
function rawMetrics(entries: SessionLikeEntry[], ids: string[]): RawMetrics {
  const source = ids.map((id) => entries.find((entry) => entry.id === id)!);
  return {
    completedEpisodeCount: source.filter((entry) => entry.message!.role === "user").length,
    sourceMessageCount: source.length,
    sourceMessageBytes: Buffer.byteLength(JSON.stringify(source.map((entry) => entry.message))),
  };
}
type RetirementRelation = "initial" | "forward" | "recompose" | "deepen";
type RetirementPreflight = {
  selection: Selection;
  relation: RetirementRelation;
  before: SessionLikeEntry[];
  after: SessionLikeEntry[];
  parentSource: SessionLikeEntry[];
  emitsV4: boolean;
} | { reason: PreflightReason };
function preflightRetirement(
  entries: SessionLikeEntry[],
  parentEntry: ReceiptEntry | undefined,
  count: number,
): RetirementPreflight {
  const selection = selectLatestCompletedEpisodes(entries, count);
  if (selection.reason) return { reason: selection.reason };
  if (!parentEntry) return { selection, relation: "initial", before: [], after: [], parentSource: [], emitsV4: false };
  const parentRange = validatedRange(entries, parentEntry.data);
  if ("applied" in parentRange) return { reason: "parent range is unavailable" };
  const selectedStart = entries.findIndex((entry) => entry.id === selection.sourceEntryIds[0]);
  const activeIndex = entries.findIndex((entry) => entry.id === selection.activeUserEntryId);
  const after = entries.slice(parentRange.activeIndex, activeIndex);
  const exactForward = selectedStart === parentRange.activeIndex &&
    selection.sourceEntryIds.length === after.length &&
    selection.sourceEntryIds.every((id, index) => id === after[index]?.id);
  const parentSource = entries.slice(parentRange.start, parentRange.activeIndex);
  const before = entries.slice(selectedStart, parentRange.start);
  const recomposed = selectedStart <= parentRange.start &&
    JSON.stringify(selection.sourceEntryIds) === JSON.stringify([...before, ...parentSource, ...after].map((entry) => entry.id));
  if (!exactForward && !recomposed) return { reason: "selection partially overlaps or gaps the parent range" };
  const emitsV4 = recomposed || parentEntry.data.version === 1 || parentEntry.data.version === 4;
  if (emitsV4 && after.length === 0) return { reason: "V4 requires a completed after-parent interval" };
  if (!emitsV4 && !exactForward) return { reason: "repeated retirement requires an exact forward delta" };
  return {
    selection,
    relation: exactForward ? "forward" : before.length === 0 ? "recompose" : "deepen",
    before,
    after,
    parentSource,
    emitsV4,
  };
}
type ReceiptAssessment = { state: "none" | "malformed" | "compacted" } | { state: "valid"; entry: ReceiptEntry };
function assessLatestReceipt(branch: SessionLikeEntry[], contextEntries: SessionLikeEntry[]): ReceiptAssessment {
  const receiptSlots = branch.filter((entry) => entry.type === "custom" && entry.customType === RECEIPT_TYPE);
  if (receiptSlots.length === 0) return { state: "none" };
  if (receiptSlots.some((entry) => !isReceipt(entry.data))) return { state: "malformed" };
  const receipts = getReceiptEntries(branch);
  const latest = receipts.at(-1)!;
  if (branch.slice(branch.findIndex((entry) => entry.id === latest.id) + 1).some((entry) => entry.type === "compaction")) return { state: "compacted" };
  const validate = (entry: ReceiptEntry): boolean => {
    if (!receiptRangeIsValid(contextEntries, entry.data)) return false;
    if (entry.data.version !== 3 && entry.data.version !== 4) return true;
    const receipt = entry.data;
    const parent = receipts.find((candidate) => candidate.id === receipt.parentReceiptEntryId);
    if (!parent || parent !== receipts[receipts.indexOf(entry) - 1] || !validate(parent)) return false;
    const expectedGeneration = parent.data.version === 3 || parent.data.version === 4 ? parent.data.generation + 1 : 2;
    const cumulative = rawMetrics(contextEntries, receipt.sourceEntryIds);
    if (receipt.version === 4) {
      const parentRange = validatedRange(contextEntries, parent.data);
      if ("applied" in parentRange) return false;
      const start = contextEntries.findIndex((item) => item.id === receipt.sourceEntryIds[0]);
      const before = contextEntries.slice(start, parentRange.start);
      const after = contextEntries.slice(parentRange.activeIndex, contextEntries.findIndex((item) => item.id === receipt.activeUserEntryId));
      const expectedIds = [...before, ...contextEntries.slice(parentRange.start, parentRange.activeIndex), ...after].map((item) => item.id);
      if (!exactCompletedInterval(contextEntries, start, contextEntries.findIndex((item) => item.id === receipt.activeUserEntryId))) return false;
      const earlier = rawMetrics(contextEntries, before.map((item) => item.id));
      const later = rawMetrics(contextEntries, after.map((item) => item.id));
      const expectedReplacement = { ...cumulative, capsuleTextBytes: Buffer.byteLength(capsuleText(receipt.capsule, receipt.sourceEntryIds)) };
      const expectedComposition = { earlierEpisodeCount: earlier.completedEpisodeCount, earlierMessageCount: earlier.sourceMessageCount, earlierSourceBytes: earlier.sourceMessageBytes, laterEpisodeCount: later.completedEpisodeCount, laterMessageCount: later.sourceMessageCount, laterSourceBytes: later.sourceMessageBytes, cumulativeMessageCount: cumulative.sourceMessageCount, cumulativeSourceBytes: cumulative.sourceMessageBytes, priorCapsuleTextBytes: Buffer.byteLength(capsuleText(parent.data.capsule, parent.data.sourceEntryIds)), newCapsuleTextBytes: expectedReplacement.capsuleTextBytes };
      return receipt.generation === expectedGeneration && JSON.stringify(receipt.sourceEntryIds) === JSON.stringify(expectedIds) &&
        JSON.stringify(receipt.replacementMetrics) === JSON.stringify(expectedReplacement) && JSON.stringify(receipt.compositionMetrics) === JSON.stringify(expectedComposition) &&
        receipt.parentReceiptFingerprint === hashJson(parent.data) && receipt.priorCapsuleFingerprint === hashJson(parent.data.capsule) &&
        JSON.stringify(receipt.newlyIncorporatedBeforeParentEntries) === JSON.stringify(before.map((item) => ({ id: item.id, fingerprint: fingerprintEntry(item) }))) &&
        JSON.stringify(receipt.newlyCompletedAfterParentEntries) === JSON.stringify(after.map((item) => ({ id: item.id, fingerprint: fingerprintEntry(item) })));
    }
    const deltaIds = receipt.sourceEntryIds.slice(parent.data.sourceEntryIds.length);
    const requiredDeltaEpisodes = requiredRepeatedEpisodeCount(contextEntries, parent.data.activeUserEntryId, receipt.activeUserEntryId);
    if (requiredDeltaEpisodes === undefined) return false;
    const delta = rawMetrics(contextEntries, deltaIds);
    if (delta.completedEpisodeCount !== requiredDeltaEpisodes) return false;
    const expectedReplacement = { ...cumulative, capsuleTextBytes: Buffer.byteLength(capsuleText(receipt.capsule, receipt.sourceEntryIds)) };
    const expectedDelta = {
      newlyCompletedEpisodeCount: delta.completedEpisodeCount, newlyCompletedMessageCount: delta.sourceMessageCount,
      newlyCompletedSourceBytes: delta.sourceMessageBytes, cumulativeMessageCount: cumulative.sourceMessageCount,
      cumulativeSourceBytes: cumulative.sourceMessageBytes,
      priorCapsuleTextBytes: Buffer.byteLength(capsuleText(parent.data.capsule, parent.data.sourceEntryIds)),
      newCapsuleTextBytes: expectedReplacement.capsuleTextBytes,
    };
    return receipt.generation === expectedGeneration &&
      JSON.stringify(receipt.replacementMetrics) === JSON.stringify(expectedReplacement) &&
      JSON.stringify(receipt.deltaMetrics) === JSON.stringify(expectedDelta) &&
      receipt.parentReceiptFingerprint === hashJson(parent.data) &&
      receipt.priorCapsuleFingerprint === hashJson(parent.data.capsule) &&
      receipt.sourceEntryIds.length === parent.data.sourceEntryIds.length + receipt.newlyCompletedEpisodeEntries.length &&
      receipt.sourceEntryIds.slice(0, parent.data.sourceEntryIds.length).every((id, i) => id === parent.data.sourceEntryIds[i]) &&
      receipt.sourceFingerprints.slice(0, parent.data.sourceFingerprints.length).every((id, i) => id === parent.data.sourceFingerprints[i]) &&
      receipt.newlyCompletedEpisodeEntries.every((item, i) =>
        item.id === receipt.sourceEntryIds[parent.data.sourceEntryIds.length + i] &&
        item.fingerprint === receipt.sourceFingerprints[parent.data.sourceFingerprints.length + i]);
  };
  return validate(latest) ? { state: "valid", entry: latest } : { state: "malformed" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasReplacementMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = ["completedEpisodeCount", "sourceMessageCount", "sourceMessageBytes", "capsuleTextBytes"];
  if (Object.keys(value).length !== keys.length || !keys.every((key) => key in value)) return false;
  return keys.every((key) =>
    typeof value[key] === "number" && Number.isInteger(value[key]) &&
    (key === "completedEpisodeCount" || key === "sourceMessageCount" ? value[key] > 0 : value[key] >= 0)
  );
}
function isReceipt(value: unknown): value is AnyReceipt {
  if (
    !isRecord(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4) ||
    value.kind !== RECEIPT_TYPE ||
    !Array.isArray(value.sourceEntryIds) ||
    !value.sourceEntryIds.every((id) => typeof id === "string") ||
    !Array.isArray(value.sourceFingerprints) ||
    !value.sourceFingerprints.every((fingerprint) =>
      typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint)
    ) ||
    value.sourceEntryIds.length === 0 ||
    new Set(value.sourceEntryIds).size !== value.sourceEntryIds.length ||
    value.sourceEntryIds.some((id) => !id) ||
    value.sourceEntryIds.length !== value.sourceFingerprints.length ||
    typeof value.activeUserEntryId !== "string" || !value.activeUserEntryId ||
    !isCapsule(value.capsule) ||
    (value.replacementMetrics !== undefined && !hasReplacementMetrics(value.replacementMetrics))
  ) return false;
  if (value.version === 1) return true;
  const providerFields = typeof value.provider === "string" && value.provider.length > 0 &&
    typeof value.model === "string" && value.model.length > 0 &&
    THINKING_LEVELS.has(value.reasoningEffort as ThinkingLevel) && isRecord(value.usage);
  if (value.version === 2) return providerFields && value.promptVersion === "capsule-v2";
  const exactKeys = (record: Record<string, unknown>, keys: string[]) => Object.keys(record).length === keys.length && keys.every((key) => key in record);
  const exactEntries = (entries: unknown, nonempty: boolean) => Array.isArray(entries) && (!nonempty || entries.length > 0) &&
    new Set(entries.map((item) => isRecord(item) ? item.id : "")).size === entries.length &&
    entries.every((item) => isRecord(item) && exactKeys(item, ["id", "fingerprint"]) && typeof item.id === "string" && item.id.length > 0 && /^[a-f0-9]{64}$/.test(item.fingerprint as string));
  if (value.version === 4) {
    const composition = value.compositionMetrics;
    const compositionKeys = ["earlierEpisodeCount", "earlierMessageCount", "earlierSourceBytes", "laterEpisodeCount", "laterMessageCount", "laterSourceBytes", "cumulativeMessageCount", "cumulativeSourceBytes", "priorCapsuleTextBytes", "newCapsuleTextBytes"];
    const nonnegative = (number: unknown) => typeof number === "number" && Number.isSafeInteger(number) && number >= 0;
    return exactKeys(value, ["version", "kind", "sourceEntryIds", "sourceFingerprints", "activeUserEntryId", "capsule", "replacementMetrics", "generation", "parentReceiptEntryId", "parentReceiptFingerprint", "priorCapsuleFingerprint", "newlyIncorporatedBeforeParentEntries", "newlyCompletedAfterParentEntries", "provider", "model", "reasoningEffort", "promptVersion", "usage", "compositionMetrics"]) &&
      providerFields && value.promptVersion === "capsule-v4" && hasReplacementMetrics(value.replacementMetrics) &&
      typeof value.generation === "number" && Number.isInteger(value.generation) && value.generation >= 2 &&
      typeof value.parentReceiptEntryId === "string" && value.parentReceiptEntryId.length > 0 &&
      typeof value.parentReceiptFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.parentReceiptFingerprint) &&
      typeof value.priorCapsuleFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.priorCapsuleFingerprint) &&
      exactEntries(value.newlyIncorporatedBeforeParentEntries, false) && exactEntries(value.newlyCompletedAfterParentEntries, true) &&
      isRecord(composition) && exactKeys(composition, compositionKeys) && compositionKeys.every((key) => nonnegative(composition[key]));
  }
  const delta = value.deltaMetrics;
  const positive = (number: unknown) => typeof number === "number" && Number.isSafeInteger(number) && number > 0;
  const byteCount = (number: unknown) => typeof number === "number" && Number.isSafeInteger(number) && number >= 0;
  return providerFields && value.promptVersion === "capsule-v3" && hasReplacementMetrics(value.replacementMetrics) &&
    typeof value.generation === "number" && Number.isInteger(value.generation) && value.generation >= 2 &&
    typeof value.parentReceiptEntryId === "string" && value.parentReceiptEntryId.length > 0 &&
    typeof value.parentReceiptFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.parentReceiptFingerprint) &&
    typeof value.priorCapsuleFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.priorCapsuleFingerprint) &&
    Array.isArray(value.newlyCompletedEpisodeEntries) && value.newlyCompletedEpisodeEntries.length > 0 &&
    new Set(value.newlyCompletedEpisodeEntries.map((item) => isRecord(item) ? item.id : "")).size === value.newlyCompletedEpisodeEntries.length &&
    value.newlyCompletedEpisodeEntries.every((item) => isRecord(item) && exactKeys(item, ["id", "fingerprint"]) && typeof item.id === "string" && item.id.length > 0 && /^[a-f0-9]{64}$/.test(item.fingerprint as string)) &&
    isRecord(delta) && exactKeys(delta, ["newlyCompletedEpisodeCount", "newlyCompletedMessageCount", "newlyCompletedSourceBytes", "cumulativeMessageCount", "cumulativeSourceBytes", "priorCapsuleTextBytes", "newCapsuleTextBytes"]) &&
    positive(delta.newlyCompletedEpisodeCount) && positive(delta.newlyCompletedMessageCount) &&
    byteCount(delta.newlyCompletedSourceBytes) && positive(delta.cumulativeMessageCount) && byteCount(delta.cumulativeSourceBytes) && byteCount(delta.priorCapsuleTextBytes) && byteCount(delta.newCapsuleTextBytes);
}
function isCapsule(value: unknown): value is ContinuationCapsule {
  if (
    !isRecord(value) || Object.keys(value).length !== 5 ||
    !["objective", "findings", "decisions", "unresolved", "nextStep"].every((
      key,
    ) => key in value)
  ) return false;
  const validText = (text: unknown, required = false) =>
    typeof text === "string" && text.length <= CAPSULE_MAX_FIELD_CHARS &&
    (!required || text.trim().length > 0);
  const validItems = (items: unknown) =>
    Array.isArray(items) && items.length <= CAPSULE_MAX_ITEMS &&
    items.every((item) =>
      typeof item === "string" && item.length <= CAPSULE_MAX_ITEM_CHARS
    );
  return JSON.stringify(value).length <= CAPSULE_MAX_JSON_CHARS &&
    validText(value.objective, true) && validText(value.nextStep, true) &&
    validItems(value.findings) && validItems(value.decisions) &&
    validItems(value.unresolved);
}
export function parseCapsuleModel(
  value = process.env[MODEL_VAR] ?? "google/gemini-3.7-flash",
): { provider: string; model: string } {
  if (value !== value.trim()) {
    throw new Error(
      MODEL_VAR + " must not contain leading or trailing whitespace.",
    );
  }
  const slash = value.indexOf("/");
  if (slash < 1 || slash === value.length - 1) {
    throw new Error(MODEL_VAR + " must be one provider/model value.");
  }
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}
export function configuredReasoningEffort(
  value = process.env[EFFORT_VAR] ?? "medium",
): ThinkingLevel {
  if (!THINKING_LEVELS.has(value as ThinkingLevel)) {
    throw new Error(EFFORT_VAR + " must be a Pi ThinkingLevel.");
  }
  return value as ThinkingLevel;
}
function redact(text: string): string {
  if (process.env[REDACT_VAR] === "false") return text;
  return text
    .replace(
      /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
      "$1[REDACTED]$2",
    )
    .replace(
      /(authorization\s*[:=]\s*(?:[\"])?bearer\s+)[^\s,\"}]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:[\"])?(?:api[_-]?key|token|secret|password)[\w-]*(?:[\"])?\s*[:=]\s*(?:[\"])?)[^\s,\"}]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:sk-ant-[A-Za-z0-9_-]+|sk-proj-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|xox[a-z]-[A-Za-z0-9-]+)\b/g,
      "[REDACTED]",
    );
}
function parseCapsule(text: string): ContinuationCapsule {
  const fence = String.fromCharCode(96).repeat(3);
  const clean = text.trim().replace(
    new RegExp("^" + fence + "(?:json)?\\s*", "i"),
    "",
  ).replace(new RegExp("\\s*" + fence + "$"), "");
  let value: unknown;
  try {
    value = JSON.parse(clean);
  } catch {
    throw new Error("Capsule model returned invalid JSON.");
  }
  if (!isCapsule(value)) {
    throw new Error("Capsule model returned an invalid capsule.");
  }
  return value;
}
function capsuleRequest(
  selected: SessionLikeEntry[],
  active: AgentMessage,
  continuationGoal: string,
  priorCapsule?: ContinuationCapsule,
  before: SessionLikeEntry[] = [],
  after: SessionLikeEntry[] = selected,
  v4 = false,
): string {
  const payload = redact(
    JSON.stringify(priorCapsule ? v4 ? {
      priorContinuationCapsule: priorCapsule,
      newlyIncorporatedBeforeParentEntries: before,
      newlyCompletedAfterParentEntries: after,
      activeRequest: active,
      continuationGoal,
    } : {
      priorContinuationCapsule: priorCapsule,
      newlyCompletedEpisodeEntries: selected,
      activeRequest: active,
      continuationGoal,
    } : {
      selectedEpisodeEntries: selected,
      activeRequest: active,
      continuationGoal,
    }),
  );
  return "Return JSON only with exactly objective, findings, decisions, unresolved, nextStep; no extras. objective/nextStep non-empty; fields <= " +
    CAPSULE_MAX_FIELD_CHARS + ", items <= " + CAPSULE_MAX_ITEM_CHARS +
    ", arrays <= " + CAPSULE_MAX_ITEMS + ", JSON <= " + CAPSULE_MAX_JSON_CHARS +
    ". Retain working state only; do not copy world/source knowledge.\n" +
    payload;
}
const retireSchema = Type.Object({
  latestCompletedEpisodes: Type.Integer({ minimum: 1 }),
  continuationGoal: Type.String({
    minLength: 1,
    maxLength: CONTINUATION_GOAL_MAX_CHARS,
  }),
});

export default function registerEpisodeRetirement(pi: ExtensionAPI): void {
  if (process.env[EPISODE_RETIREMENT_ENABLED_VAR] !== "true") return;

  pi.registerTool({
    name: "inspect_episode_retirement",
    label: "inspect episode retirement",
    description: "Read-only mechanical inspection of safe completed-episode retirement candidates. Run this first when a prior continuation capsule exists; retain judgment about whether and what to retire.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
      let contextEntries: SessionLikeEntry[];
      try { contextEntries = resolvedSlots(ctx.sessionManager); } catch { throw new Error("Episode inspection refused: resolved context is unavailable."); }
      const assessment = assessLatestReceipt(branch, contextEntries);
      if (assessment.state === "compacted") throw new Error("Episode inspection refused: native compaction after retirement is unsupported.");
      if (assessment.state === "malformed") throw new Error("Episode inspection refused: latest receipt chain is malformed or inactive.");
      const parentEntry = assessment.state === "valid" ? assessment.entry : undefined;
      const maxCount = contextEntries.filter((entry) => entry.type === "message" && entry.message?.role === "user").length - 1;
      type Frontier = { acceptedCount: number; minCount: number; maxCount: number };
      type Candidate = {
        count: number; relation: RetirementRelation;
        earlierAddedEpisodeCount: number; earlierAddedMessageCount: number;
        laterAddedEpisodeCount: number; laterAddedMessageCount: number;
        cumulativeEpisodeCount: number; cumulativeMessageCount: number;
        cumulativeSourceBytes: number; startId: string; endId: string;
      };
      const relationFrontier: Record<RetirementRelation, Frontier | null> = {
        initial: null, forward: null, recompose: null, deepen: null,
      };
      const refusalReasons: Record<RefusalReasonKey, number> = {
        insufficientCompletedEpisodes: 0,
        unsupportedCandidate: 0,
        incompleteAssistantBoundary: 0,
        unmatchedToolResult: 0,
        openToolCalls: 0,
        activeAlignment: 0,
        parentUnavailable: 0,
        partialOverlapOrGap: 0,
        v4MissingAfterInterval: 0,
        exactForwardRequired: 0,
      };
      let acceptedCount = 0;
      let refusedCount = 0;
      let largestSafe: Candidate | null = null;
      for (let count = 1; count <= maxCount; count++) {
        const preflight = preflightRetirement(contextEntries, parentEntry, count);
        if ("reason" in preflight) {
          refusedCount++;
          refusalReasons[refusalReasonKey[preflight.reason]]++;
          continue;
        }
        const cumulativeIds = parentEntry && preflight.emitsV4
          ? [...preflight.before, ...preflight.parentSource, ...preflight.after].map((entry) => entry.id)
          : parentEntry ? [...parentEntry.data.sourceEntryIds, ...preflight.selection.sourceEntryIds]
          : preflight.selection.sourceEntryIds;
        const earlier = rawMetrics(contextEntries, preflight.before.map((entry) => entry.id));
        const later = rawMetrics(contextEntries, preflight.after.map((entry) => entry.id));
        const cumulative = rawMetrics(contextEntries, cumulativeIds);
        const candidate: Candidate = { count, relation: preflight.relation, earlierAddedEpisodeCount: earlier.completedEpisodeCount, earlierAddedMessageCount: earlier.sourceMessageCount, laterAddedEpisodeCount: later.completedEpisodeCount, laterAddedMessageCount: later.sourceMessageCount, cumulativeEpisodeCount: cumulative.completedEpisodeCount, cumulativeMessageCount: cumulative.sourceMessageCount, cumulativeSourceBytes: cumulative.sourceMessageBytes, startId: cumulativeIds[0]!, endId: cumulativeIds.at(-1)! };
        acceptedCount++;
        largestSafe = candidate;
        const frontier = relationFrontier[candidate.relation];
        relationFrontier[candidate.relation] = frontier
          ? { acceptedCount: frontier.acceptedCount + 1, minCount: frontier.minCount, maxCount: count }
          : { acceptedCount: 1, minCount: count, maxCount: count };
      }
      const details = { evaluatedCount: maxCount, acceptedCount, refusedCount, refusalReasons, relationFrontier, largestSafe };
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  });

  pi.registerTool({
    name: "retire_episodes",
    label: "retire episodes",
    description:
      "Choose the largest contiguous suffix of fully settled completed episodes: retained completed episodes continue consuming context, cache, and local inference time. If a prior continuation capsule exists, run inspect_episode_retirement first: latestCompletedEpisodes counts original raw completed episodes including those already represented by the capsule; a broader safe suffix is allowed. Never include active work. Supply a concise continuation goal; the configured secondary model authors the capsule.",
    parameters: retireSchema,
    executionMode: "sequential",
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Authoring retirement capsule…"), 0, 0);
      }
      const receipt = result.details as (EpisodeRetirementReceiptV2 | EpisodeRetirementReceiptV3 | EpisodeRetirementReceiptV4) | undefined;
      const metrics = receipt?.replacementMetrics;
      if (!receipt || !metrics) {
        const text = result.content.flatMap((part) =>
          part.type === "text" ? [part.text] : []
        ).join("\n");
        return new Text(theme.fg(context.isError ? "error" : "success", text), 0, 0);
      }
      const usage = receipt.usage as Record<string, unknown>;
      const usageText = [
        ["input", "input"],
        ["output", "output"],
        ["reasoning", "reasoning"],
        ["cacheRead", "cache read"],
        ["cacheWrite", "cache write"],
        ["totalTokens", "total"],
      ].flatMap(([key, label]) =>
        typeof usage[key] === "number" ? [`${label} ${usage[key]}`] : []
      ).concat(
        isRecord(usage.cost) && typeof usage.cost.total === "number"
          ? [`$${usage.cost.total}`]
          : [],
      ).join(" · ");
      const generation = receipt.version === 3 ? `generation ${receipt.generation}; this retirement: ${receipt.deltaMetrics.newlyCompletedEpisodeCount} episode(s), ${receipt.deltaMetrics.newlyCompletedMessageCount} message(s), ${receipt.deltaMetrics.newlyCompletedSourceBytes} B source → ${receipt.deltaMetrics.newCapsuleTextBytes} B capsule-text` : receipt.version === 4 ? `generation ${receipt.generation}; earlier additions: ${receipt.compositionMetrics.earlierEpisodeCount} episode(s), ${receipt.compositionMetrics.earlierMessageCount} message(s), ${receipt.compositionMetrics.earlierSourceBytes} B; later additions: ${receipt.compositionMetrics.laterEpisodeCount} episode(s), ${receipt.compositionMetrics.laterMessageCount} message(s), ${receipt.compositionMetrics.laterSourceBytes} B; cumulative ${receipt.compositionMetrics.cumulativeMessageCount} message(s), ${receipt.compositionMetrics.cumulativeSourceBytes} B source → ${receipt.compositionMetrics.newCapsuleTextBytes} B capsule-text` : "generation 1";
      const compact = `${generation}; cumulative ${metrics.completedEpisodeCount} completed episode(s), ${metrics.sourceMessageCount} source message(s), ${metrics.sourceMessageBytes} B serialized source → ${metrics.capsuleTextBytes} B capsule-text; ${receipt.provider}/${receipt.model} (${receipt.reasoningEffort})${usageText ? `; LLM: ${usageText}` : ""}`;
      if (!expanded) {
        return new Text(theme.fg("success", `${compact} (${keyHint("app.tools.expand", "to expand")})`), 0, 0);
      }
      return new Text(theme.fg("success", `${compact}\n\nProvider-facing context (exact capsule text; not rewritten JSONL history):\n${capsuleText(receipt.capsule, receipt.sourceEntryIds)}\n\nProvenance: ${receipt.sourceEntryIds.join(", ")}`), 0, 0);
    },
    async execute(_id, params, signal, onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
      if (
        typeof params.continuationGoal !== "string" ||
        !params.continuationGoal.trim() ||
        params.continuationGoal.length > CONTINUATION_GOAL_MAX_CHARS
      ) {
        throw new Error(
          "Episode retirement requires a non-empty bounded continuationGoal.",
        );
      }
      const contextEntries = resolvedSlots(ctx.sessionManager);
      const assessment = assessLatestReceipt(branch, contextEntries);
      if (assessment.state === "compacted") throw new Error("Episode retirement refused: native compaction after retirement is unsupported.");
      if (assessment.state === "malformed") throw new Error("Episode retirement refused: latest receipt chain is malformed or inactive.");
      const parentEntry = assessment.state === "valid" ? assessment.entry : undefined;
      const preflight = preflightRetirement(contextEntries, parentEntry, params.latestCompletedEpisodes);
      if ("reason" in preflight) throw new Error("Episode retirement refused: " + preflight.reason + ".");
      const { selection, before, after, parentSource, emitsV4 } = preflight;
      if (signal?.aborted) {
        throw new Error("Episode retirement capsule request aborted.");
      }
      const configured = parseCapsuleModel();
      const reasoningEffort = configuredReasoningEffort();
      const model = ctx.modelRegistry.find(
        configured.provider,
        configured.model,
      );
      if (!model) {
        throw new Error(
          "Episode retirement model unavailable: " + configured.provider + "/" +
            configured.model + ".",
        );
      }
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        throw new Error(
          "Episode retirement model has no configured authentication: " +
            configured.provider + "/" + configured.model + ".",
        );
      }
      // Public ExtensionAPI progress typing does not expose this structural update shape.
      onUpdate?.(
        {
          content: [{
            type: "text",
            text:
              "Authoring continuation capsule with configured retirement model…",
          }],
        } as any,
      );
      const active = contextEntries.find((entry) =>
        entry.id === selection.activeUserEntryId
      )!.message!;
      const selected = contextEntries.filter((entry) => selection.sourceEntryIds.includes(entry.id));
      // Same public auth + streamSimple boundary used by pi-ai-consortium.
      const response = await streamSimple(model, {
        messages: [{
          role: "user",
          content: [{
            type: "text",
            text: capsuleRequest(selected, active, params.continuationGoal, parentEntry?.data.capsule, before, after, emitsV4),
          }],
          timestamp: Date.now(),
        }],
      }, {
        signal,
        reasoning: reasoningEffort,
        apiKey: auth.apiKey,
        headers: auth.headers,
        env: auth.env,
      }).result();
      if (signal?.aborted) {
        throw new Error("Episode retirement capsule request aborted.");
      }
      if (response.stopReason !== "stop") {
        throw new Error("Capsule model did not stop successfully.");
      }
      const text = response.content
        .flatMap((part) => part.type === "text" ? [part.text] : [])
        .join("\n");
      if (!text.trim()) {
        throw new Error("Capsule model returned an empty response.");
      }
      const capsule = parseCapsule(text);
      const cumulativeIds = parentEntry && emitsV4 ? [...before, ...parentSource, ...after].map((entry) => entry.id) : parentEntry ? [...parentEntry.data.sourceEntryIds, ...selection.sourceEntryIds] : selection.sourceEntryIds;
      const cumulativeFingerprints = cumulativeIds.map((id) => fingerprintEntry(contextEntries.find((entry) => entry.id === id)!));
      const cumulative = contextEntries.filter((entry) => cumulativeIds.includes(entry.id));
      const cumulativeRaw = rawMetrics(contextEntries, cumulativeIds);
      const replacementMetrics = {
        ...cumulativeRaw,
        capsuleTextBytes: Buffer.byteLength(capsuleText(capsule, cumulativeIds)),
      };
      const receipt: EpisodeRetirementReceipt = parentEntry && emitsV4 ? {
        version: 4, kind: RECEIPT_TYPE, sourceEntryIds: cumulativeIds, sourceFingerprints: cumulativeFingerprints,
        activeUserEntryId: selection.activeUserEntryId, capsule, provider: configured.provider, model: configured.model,
        reasoningEffort, promptVersion: "capsule-v4", usage: response.usage as unknown as Record<string, unknown>, replacementMetrics,
        generation: parentEntry.data.version === 3 || parentEntry.data.version === 4 ? parentEntry.data.generation + 1 : 2,
        parentReceiptEntryId: parentEntry.id, parentReceiptFingerprint: hashJson(parentEntry.data), priorCapsuleFingerprint: hashJson(parentEntry.data.capsule),
        newlyIncorporatedBeforeParentEntries: before.map((entry) => ({ id: entry.id, fingerprint: fingerprintEntry(entry) })),
        newlyCompletedAfterParentEntries: after.map((entry) => ({ id: entry.id, fingerprint: fingerprintEntry(entry) })),
        compositionMetrics: { earlierEpisodeCount: rawMetrics(contextEntries, before.map((entry) => entry.id)).completedEpisodeCount, earlierMessageCount: before.length, earlierSourceBytes: Buffer.byteLength(JSON.stringify(before.map((entry) => entry.message))), laterEpisodeCount: rawMetrics(contextEntries, after.map((entry) => entry.id)).completedEpisodeCount, laterMessageCount: after.length, laterSourceBytes: Buffer.byteLength(JSON.stringify(after.map((entry) => entry.message))), cumulativeMessageCount: cumulative.length, cumulativeSourceBytes: replacementMetrics.sourceMessageBytes, priorCapsuleTextBytes: Buffer.byteLength(capsuleText(parentEntry.data.capsule, parentEntry.data.sourceEntryIds)), newCapsuleTextBytes: replacementMetrics.capsuleTextBytes },
      } : parentEntry ? {
        version: 3, kind: RECEIPT_TYPE, sourceEntryIds: cumulativeIds, sourceFingerprints: cumulativeFingerprints,
        activeUserEntryId: selection.activeUserEntryId, capsule, provider: configured.provider, model: configured.model,
        reasoningEffort, promptVersion: "capsule-v3", usage: response.usage as unknown as Record<string, unknown>, replacementMetrics,
        generation: parentEntry.data.version === 3 ? parentEntry.data.generation + 1 : 2,
        parentReceiptEntryId: parentEntry.id, parentReceiptFingerprint: hashJson(parentEntry.data),
        priorCapsuleFingerprint: hashJson(parentEntry.data.capsule), newlyCompletedEpisodeEntries: selected.map((entry) => ({ id: entry.id, fingerprint: fingerprintEntry(entry) })),
        deltaMetrics: { newlyCompletedEpisodeCount: params.latestCompletedEpisodes, newlyCompletedMessageCount: selected.length, newlyCompletedSourceBytes: Buffer.byteLength(JSON.stringify(selected.map((entry) => entry.message))), cumulativeMessageCount: cumulative.length, cumulativeSourceBytes: replacementMetrics.sourceMessageBytes, priorCapsuleTextBytes: Buffer.byteLength(capsuleText(parentEntry.data.capsule, parentEntry.data.sourceEntryIds)), newCapsuleTextBytes: replacementMetrics.capsuleTextBytes },
      } : {
        version: 2, kind: RECEIPT_TYPE, ...selection, capsule, provider: configured.provider, model: configured.model,
        reasoningEffort, promptVersion: "capsule-v2", usage: response.usage as unknown as Record<string, unknown>, replacementMetrics,
      };
      pi.appendEntry(RECEIPT_TYPE, receipt);
      // Public ExtensionAPI tool-result typing does not expose nested completion usage.
      return {
        content: [{
          type: "text",
          text: "Selected completed episodes were retired into a continuation capsule.",
        }],
        details: receipt,
        usage: response.usage,
      } as any;
    },
  });

  pi.registerTool({
    name: "recall_episode",
    label: "recall retired episode",
    description:
      "Mechanically retrieve the exact original messages covered by the stored episode-retirement receipt.",
    parameters: Type.Object({ sourceEntryId: Type.Optional(Type.String()) }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
      let contextEntries: SessionLikeEntry[];
      try { contextEntries = resolvedSlots(ctx.sessionManager); } catch { throw new Error("Episode recall refused: resolved context is unavailable."); }
      const assessment = assessLatestReceipt(branch, contextEntries);
      if (assessment.state !== "valid") throw new Error(assessment.state === "compacted" ? "Episode recall refused: native compaction after retirement." : "Episode recall refused: no valid active receipt chain.");
      const receipt = assessment.entry.data;
      const originals = receipt.sourceEntryIds.map((id) =>
        branch.find((entry) => entry.id === id)
      );
      if (
        originals.some((entry, index) =>
          !entry || !isPlainMessage(entry) ||
          fingerprintEntry(entry) !== receipt.sourceFingerprints[index]
        )
      ) {
        throw new Error(
          "Episode recall refused: source entries are unavailable or changed.",
        );
      }
      if (!params.sourceEntryId) {
        const inventory = originals.map((entry) => ({
          id: entry!.id,
          role: entry!.message!.role,
          bytes: Buffer.byteLength(JSON.stringify(entry!.message)),
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(inventory, null, 2) }],
          details: { sourceEntryIds: receipt.sourceEntryIds },
        };
      }
      const sourceIndex = receipt.sourceEntryIds.indexOf(params.sourceEntryId);
      if (sourceIndex < 0) {
        throw new Error(
          "Episode recall refused: sourceEntryId is outside the receipt.",
        );
      }
      const entry = originals[sourceIndex]!;
      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            { id: entry.id, message: entry.message },
            null,
            2,
          ),
        }],
        details: { sourceEntryId: entry.id },
      };
    },
  });

  // Public ExtensionAPI context handler typing does not expose this structural overlay.
  pi.on("context", (event, ctx): any => {
    const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
    let contextEntries: SessionLikeEntry[];
    try { contextEntries = resolvedSlots(ctx.sessionManager); } catch { return; }
    const assessment = assessLatestReceipt(branch, contextEntries);
    if (assessment.state !== "valid") return;
    const projected = projectEventMessages(
      contextEntries,
      event.messages as AgentMessage[],
      assessment.entry.data,
    );
    if (projected.applied) return { messages: projected.messages as any };
  });
}
