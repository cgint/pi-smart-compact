import { createHash, randomUUID } from "node:crypto";
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
type V5Base = { version: 5; pinnedWorkingState: string; promptVersion: "capsule-v5" };
export type EpisodeRetirementReceiptV5Initial = Omit<EpisodeRetirementReceiptV2, "version" | "promptVersion" | "replacementMetrics"> & V5Base & {
  mode: "initial"; replacementMetrics: NonNullable<ReceiptBase["replacementMetrics"]>;
};
export type EpisodeRetirementReceiptV5Forward = Omit<EpisodeRetirementReceiptV3, "version" | "promptVersion"> & V5Base & { mode: "forward" };
export type EpisodeRetirementReceiptV5Corrective = Omit<EpisodeRetirementReceiptV4, "version" | "promptVersion"> & V5Base & {
  mode: "recompose" | "deepen";
};
export type EpisodeRetirementReceiptV5 = EpisodeRetirementReceiptV5Initial | EpisodeRetirementReceiptV5Forward | EpisodeRetirementReceiptV5Corrective;
export type EpisodeRetirementReceipt = EpisodeRetirementReceiptV1 | EpisodeRetirementReceiptV2 | EpisodeRetirementReceiptV3 | EpisodeRetirementReceiptV4 | EpisodeRetirementReceiptV5;
type AnyReceipt = EpisodeRetirementReceipt;
type ForwardReceipt = EpisodeRetirementReceiptV3 | EpisodeRetirementReceiptV5Forward;
type CorrectiveReceipt = EpisodeRetirementReceiptV4 | EpisodeRetirementReceiptV5Corrective;
type GenerationalReceipt = ForwardReceipt | CorrectiveReceipt;
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

function continuationText(receipt: AnyReceipt): string {
  const capsule = capsuleText(receipt.capsule, receipt.sourceEntryIds);
  return receipt.version === 5 ? "[PINNED WORKING STATE]\n" + receipt.pinnedWorkingState + "\n[/PINNED STATE]\n\n" + capsule : capsule;
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
  const capsule = continuationText(receipt);
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
  messages[range.start] = prependCapsule(messages[range.start], continuationText(receipt));
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
function isForwardReceipt(receipt: AnyReceipt): receipt is ForwardReceipt {
  return receipt.version === 3 || receipt.version === 5 && receipt.mode === "forward";
}
function isCorrectiveReceipt(receipt: AnyReceipt): receipt is CorrectiveReceipt {
  return receipt.version === 4 || receipt.version === 5 && (receipt.mode === "recompose" || receipt.mode === "deepen");
}
function isGenerationalReceipt(receipt: AnyReceipt): receipt is GenerationalReceipt {
  return isForwardReceipt(receipt) || isCorrectiveReceipt(receipt);
}
function nextGeneration(parent: AnyReceipt): number {
  return isGenerationalReceipt(parent) ? parent.generation + 1 : 2;
}
function assessLatestReceipt(branch: SessionLikeEntry[], contextEntries: SessionLikeEntry[]): ReceiptAssessment {
  const receiptSlots = branch.filter((entry) => entry.type === "custom" && entry.customType === RECEIPT_TYPE);
  if (receiptSlots.length === 0) return { state: "none" };
  if (receiptSlots.some((entry) => !isReceipt(entry.data))) return { state: "malformed" };
  const receipts = getReceiptEntries(branch);
  const latest = receipts.at(-1)!;
  if (branch.slice(branch.findIndex((entry) => entry.id === latest.id) + 1).some((entry) => entry.type === "compaction")) return { state: "compacted" };
  const validate = (entry: ReceiptEntry): boolean => {
    if (!receiptRangeIsValid(contextEntries, entry.data)) return false;
    if (!isGenerationalReceipt(entry.data)) return true;
    const receipt = entry.data;
    const parent = receipts.find((candidate) => candidate.id === receipt.parentReceiptEntryId);
    if (!parent || parent !== receipts[receipts.indexOf(entry) - 1] || !validate(parent)) return false;
    const expectedGeneration = nextGeneration(parent.data);
    const cumulative = rawMetrics(contextEntries, receipt.sourceEntryIds);
    if (isCorrectiveReceipt(receipt)) {
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
      return (receipt.version !== 5 || (before.length === 0 ? receipt.mode === "recompose" : receipt.mode === "deepen")) && receipt.generation === expectedGeneration && JSON.stringify(receipt.sourceEntryIds) === JSON.stringify(expectedIds) &&
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
    if (!isForwardReceipt(receipt)) return false;
    return receipt.generation === expectedGeneration &&
      JSON.stringify(receipt.replacementMetrics) === JSON.stringify(expectedReplacement) &&
      JSON.stringify(receipt.deltaMetrics) === JSON.stringify(expectedDelta) &&
      receipt.parentReceiptFingerprint === hashJson(parent.data) &&
      receipt.priorCapsuleFingerprint === hashJson(parent.data.capsule) &&
      receipt.sourceEntryIds.length === parent.data.sourceEntryIds.length + receipt.newlyCompletedEpisodeEntries.length &&
      receipt.sourceEntryIds.slice(0, parent.data.sourceEntryIds.length).every((id: string, i: number) => id === parent.data.sourceEntryIds[i]) &&
      receipt.sourceFingerprints.slice(0, parent.data.sourceFingerprints.length).every((id: string, i: number) => id === parent.data.sourceFingerprints[i]) &&
      receipt.newlyCompletedEpisodeEntries.every((item: any, i: number) =>
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
    !isRecord(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5) ||
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
  if (value.version === 5) {
    const pin = typeof value.pinnedWorkingState === "string" && value.pinnedWorkingState.length <= 2_000 && value.pinnedWorkingState.trim().length > 0;
    const initial = ["version", "kind", "sourceEntryIds", "sourceFingerprints", "activeUserEntryId", "capsule", "replacementMetrics", "provider", "model", "reasoningEffort", "promptVersion", "usage", "mode", "pinnedWorkingState"];
    const forward = [...initial, "generation", "parentReceiptEntryId", "parentReceiptFingerprint", "priorCapsuleFingerprint", "newlyCompletedEpisodeEntries", "deltaMetrics"];
    const corrective = [...initial, "generation", "parentReceiptEntryId", "parentReceiptFingerprint", "priorCapsuleFingerprint", "newlyIncorporatedBeforeParentEntries", "newlyCompletedAfterParentEntries", "compositionMetrics"];
    if (!providerFields || value.promptVersion !== "capsule-v5" || !pin || !hasReplacementMetrics(value.replacementMetrics)) return false;
    const positive = (number: unknown) => typeof number === "number" && Number.isSafeInteger(number) && number > 0;
    const nonnegative = (number: unknown) => typeof number === "number" && Number.isSafeInteger(number) && number >= 0;
    const deltaKeys = ["newlyCompletedEpisodeCount", "newlyCompletedMessageCount", "newlyCompletedSourceBytes", "cumulativeMessageCount", "cumulativeSourceBytes", "priorCapsuleTextBytes", "newCapsuleTextBytes"];
    const compositionKeys = ["earlierEpisodeCount", "earlierMessageCount", "earlierSourceBytes", "laterEpisodeCount", "laterMessageCount", "laterSourceBytes", "cumulativeMessageCount", "cumulativeSourceBytes", "priorCapsuleTextBytes", "newCapsuleTextBytes"];
    const parentFields = typeof value.generation === "number" && Number.isInteger(value.generation) && value.generation >= 2 && typeof value.parentReceiptEntryId === "string" && value.parentReceiptEntryId.length > 0 && typeof value.parentReceiptFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.parentReceiptFingerprint) && typeof value.priorCapsuleFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.priorCapsuleFingerprint);
    if (value.mode === "initial") return exactKeys(value, initial);
    if (value.mode === "forward") { const delta = value.deltaMetrics; return exactKeys(value, forward) && parentFields && exactEntries(value.newlyCompletedEpisodeEntries, true) && isRecord(delta) && exactKeys(delta, deltaKeys) && positive(delta.newlyCompletedEpisodeCount) && positive(delta.newlyCompletedMessageCount) && nonnegative(delta.newlyCompletedSourceBytes) && positive(delta.cumulativeMessageCount) && nonnegative(delta.cumulativeSourceBytes) && nonnegative(delta.priorCapsuleTextBytes) && nonnegative(delta.newCapsuleTextBytes); }
    if (value.mode === "recompose" || value.mode === "deepen") { const composition = value.compositionMetrics; return exactKeys(value, corrective) && parentFields && exactEntries(value.newlyIncorporatedBeforeParentEntries, false) && exactEntries(value.newlyCompletedAfterParentEntries, true) && isRecord(composition) && exactKeys(composition, compositionKeys) && compositionKeys.every((key) => nonnegative(composition[key])); }
    return false;
  }
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
  pinnedWorkingState: string,
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
  return "[PINNED WORKING STATE GUIDANCE — REDACTED]\n" + redact(pinnedWorkingState) + "\n[/PINNED WORKING STATE GUIDANCE]\n" +
    "Return JSON only with exactly objective, findings, decisions, unresolved, nextStep; no extras. Author complementary, non-duplicative five-key state; no pinned field. objective/nextStep non-empty; fields <= " +
    CAPSULE_MAX_FIELD_CHARS + ", items <= " + CAPSULE_MAX_ITEM_CHARS +
    ", arrays <= " + CAPSULE_MAX_ITEMS + ", JSON <= " + CAPSULE_MAX_JSON_CHARS +
    ". Retain working state only; do not copy world/source knowledge.\n" + payload;
}
type InspectCandidate = {
  id: string;
  timestamp: string;
  userPrompt: string;
  retiresEpisodes: number;
  sourceMessageBytes: number;
};
type InspectionBinding = { count: number; summary: string };
type InspectionGrant = {
  witness: string;
  digest: string;
  activeUserEntryId: string;
  bindings: Map<string, InspectionBinding>;
  candidates: InspectCandidate[];
  activeEpisode: { timestamp: string; userPrompt: string };
  evaluatedCount: number;
  acceptedCount: number;
  refusedCount: number;
  refusalReasons: Record<RefusalReasonKey, number>;
  cursors: Map<string, number>;
  relationFrontier: Record<RetirementRelation, { acceptedCount: number; minCount: number; maxCount: number } | null>;
  largestSafe: Record<string, unknown> | null;
};
const INSPECTION_BYTE_LIMIT = 2_048;

function promptPreview(entry: SessionLikeEntry): string {
  const content = entry.message?.content;
  const firstText = typeof content === "string" ? content : Array.isArray(content)
    ? content.find((part): part is { type: "text"; text: string } =>
      typeof part === "object" && part !== null && (part as any).type === "text" && typeof (part as any).text === "string",
    )?.text
    : undefined;
  if (firstText !== undefined) {
    const normalized = firstText.replace(/\s+/g, " ").trim();
    if (!normalized) return "(empty)";
    return normalized.length > 45 ? normalized.slice(0, 44) + "…" : normalized;
  }
  if (content === undefined || content === null || Array.isArray(content) && content.length === 0) return "(empty)";
  return "(non-text prompt)";
}
function isoTimestamp(entry: SessionLikeEntry): string {
  const value = entry.message?.timestamp ?? entry.timestamp;
  const date = new Date(typeof value === "number" ? value : value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
/** Fingerprint exactly the resolved producer/message prefix that can affect retirement selection. */
function activeRootDigest(entries: SessionLikeEntry[], activeUserEntryId: string): string {
  const activeIndex = entries.findIndex((entry) => entry.id === activeUserEntryId);
  if (activeIndex < 0) throw new Error("Episode inspection refused: active root is unavailable.");
  return hashJson(entries.slice(0, activeIndex + 1).map((entry) => ({
    id: entry.id,
    fingerprint: fingerprintEntry(entry),
    providerMessages: sessionEntryToContextMessages(entry as any),
  })));
}
function inspectionPage(grant: InspectionGrant, start: number): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  let end = start;
  let nextCursor: string | null = null;
  const base = {
    inspectionWitness: grant.witness,
    activeEpisode: grant.activeEpisode,
    evaluatedCount: grant.evaluatedCount,
    acceptedCount: grant.acceptedCount,
    refusedCount: grant.refusedCount,
    refusalReasons: grant.refusalReasons,
    relationFrontier: grant.relationFrontier,
    largestSafe: grant.largestSafe,
  };
  while (end < grant.candidates.length) {
    const prospectiveEnd = end + 1;
    const cursor = prospectiveEnd < grant.candidates.length ? randomUUID() : null;
    const details = { ...base, candidates: grant.candidates.slice(start, prospectiveEnd), nextCursor: cursor };
    const serialized = JSON.stringify(details);
    if (Buffer.byteLength(serialized, "utf8") > INSPECTION_BYTE_LIMIT) break;
    end = prospectiveEnd;
    nextCursor = cursor;
  }
  if (end === start && grant.candidates.length > 0) throw new Error("Episode inspection refused: one complete candidate exceeds the response bound.");
  if (nextCursor) grant.cursors.set(nextCursor, end);
  const details = { ...base, candidates: grant.candidates.slice(start, end), nextCursor };
  const text = JSON.stringify(details);
  if (Buffer.byteLength(text, "utf8") > INSPECTION_BYTE_LIMIT || Buffer.byteLength(JSON.stringify(details), "utf8") > INSPECTION_BYTE_LIMIT) {
    throw new Error("Episode inspection refused: response exceeds the bound.");
  }
  return { content: [{ type: "text", text }], details };
}

const retireSchema = Type.Object({
  fromEpisodeInclusive: Type.String({ minLength: 1, description: "Witness-scoped oldest included completed episode anchor; it and every newer completed episode are retired." }),
  inspectionWitness: Type.String({ minLength: 1, description: "Opaque authority returned by the current inspect_episode_retirement call." }),
  continuationGoal: Type.String({ minLength: 1, maxLength: CONTINUATION_GOAL_MAX_CHARS, description: "Non-blank continuation objective for the capsule model; the active agent authors it." }),
  pinnedWorkingState: Type.String({ maxLength: 2_000, description: "Required non-blank <=2000-character critical state, independently authored by the active agent and persisted unchanged by this extension." }),
});
function preflightSummary(preflight: RetirementPreflight): string | undefined {
  if ("reason" in preflight) return undefined;
  return hashJson({ selection: preflight.selection, relation: preflight.relation, before: preflight.before.map((entry) => entry.id), after: preflight.after.map((entry) => entry.id), parentSource: preflight.parentSource.map((entry) => entry.id), emitsV4: preflight.emitsV4 });
}

export default function registerEpisodeRetirement(pi: ExtensionAPI): void {
  if (process.env[EPISODE_RETIREMENT_ENABLED_VAR] !== "true") return;
  let inspectionGrant: InspectionGrant | undefined;

  pi.registerTool({
    name: "inspect_episode_retirement",
    label: "inspect episode retirement",
    description: "Read-only mechanical inspection of safe completed-episode retirement candidates.",
    parameters: Type.Object({ cursor: Type.Optional(Type.String()) }),
    executionMode: "sequential",
    async execute(_id, params: { cursor?: string }, _signal, _onUpdate, ctx) {
      if (params.cursor !== undefined) {
        if (!inspectionGrant) throw new Error("Episode inspection refused: unknown or stale cursor.");
        const start = inspectionGrant.cursors.get(params.cursor);
        if (start === undefined) throw new Error("Episode inspection refused: unknown or stale cursor.");
        let contextEntries: SessionLikeEntry[];
        try { contextEntries = resolvedSlots(ctx.sessionManager); } catch { throw new Error("Episode inspection refused: resolved context is unavailable."); }
        const activeRoot = contextEntries.filter((entry) => entry.type === "message" && entry.message?.role === "user").at(-1);
        if (!activeRoot || activeRoot.id !== inspectionGrant.activeUserEntryId || activeRootDigest(contextEntries, activeRoot.id) !== inspectionGrant.digest) {
          throw new Error("Episode inspection refused: unknown or stale cursor.");
        }
        return inspectionPage(inspectionGrant, start);
      }
      const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
      let contextEntries: SessionLikeEntry[];
      try { contextEntries = resolvedSlots(ctx.sessionManager); } catch { throw new Error("Episode inspection refused: resolved context is unavailable."); }
      const assessment = assessLatestReceipt(branch, contextEntries);
      if (assessment.state === "compacted") throw new Error("Episode inspection refused: native compaction after retirement is unsupported.");
      if (assessment.state === "malformed") throw new Error("Episode inspection refused: latest receipt chain is malformed or inactive.");
      const parentEntry = assessment.state === "valid" ? assessment.entry : undefined;
      const activeRoot = contextEntries.filter((entry) => entry.type === "message" && entry.message?.role === "user").at(-1);
      if (!activeRoot) throw new Error("Episode inspection refused: no active user root.");
      const maxCount = contextEntries.filter((entry) => entry.type === "message" && entry.message?.role === "user").length - 1;
      const refusalReasons: Record<RefusalReasonKey, number> = {
        insufficientCompletedEpisodes: 0, unsupportedCandidate: 0, incompleteAssistantBoundary: 0,
        unmatchedToolResult: 0, openToolCalls: 0, activeAlignment: 0, parentUnavailable: 0,
        partialOverlapOrGap: 0, v4MissingAfterInterval: 0, exactForwardRequired: 0,
      };
      const candidates: InspectCandidate[] = [];
      const bindings = new Map<string, InspectionBinding>();
      const relationFrontier: InspectionGrant["relationFrontier"] = { initial: null, forward: null, recompose: null, deepen: null };
      let largestSafe: Record<string, unknown> | null = null;
      let refusedCount = 0;
      for (let count = 1; count <= maxCount; count++) {
        const preflight = preflightRetirement(contextEntries, parentEntry, count);
        if ("reason" in preflight) {
          refusedCount++;
          refusalReasons[refusalReasonKey[preflight.reason]]++;
          continue;
        }
        const root = contextEntries.find((entry) => entry.id === preflight.selection.sourceEntryIds[0])!;
        const selectedProviderMessages = preflight.selection.sourceEntryIds.map((id) => contextEntries.find((entry) => entry.id === id)!.message);
        const id = `ep-${count}`;
        candidates.push({ id, timestamp: isoTimestamp(root), userPrompt: promptPreview(root), retiresEpisodes: count, sourceMessageBytes: Buffer.byteLength(JSON.stringify(selectedProviderMessages), "utf8") });
        bindings.set(id, { count, summary: preflightSummary(preflight)! });
        const cumulativeIds = parentEntry && preflight.emitsV4 ? [...preflight.before, ...preflight.parentSource, ...preflight.after].map((entry) => entry.id) : parentEntry ? [...parentEntry.data.sourceEntryIds, ...preflight.selection.sourceEntryIds] : preflight.selection.sourceEntryIds;
        const earlier = rawMetrics(contextEntries, preflight.before.map((entry) => entry.id));
        const later = rawMetrics(contextEntries, preflight.after.map((entry) => entry.id));
        const cumulative = rawMetrics(contextEntries, cumulativeIds);
        largestSafe = { count, relation: preflight.relation, earlierAddedEpisodeCount: earlier.completedEpisodeCount, earlierAddedMessageCount: earlier.sourceMessageCount, laterAddedEpisodeCount: later.completedEpisodeCount, laterAddedMessageCount: later.sourceMessageCount, cumulativeEpisodeCount: cumulative.completedEpisodeCount, cumulativeMessageCount: cumulative.sourceMessageCount, cumulativeSourceBytes: cumulative.sourceMessageBytes, startId: cumulativeIds[0]!, endId: cumulativeIds.at(-1)! };
        const frontier = relationFrontier[preflight.relation];
        relationFrontier[preflight.relation] = frontier ? { acceptedCount: frontier.acceptedCount + 1, minCount: frontier.minCount, maxCount: count } : { acceptedCount: 1, minCount: count, maxCount: count };
      }
      inspectionGrant = {
        witness: randomUUID(), digest: activeRootDigest(contextEntries, activeRoot.id), activeUserEntryId: activeRoot.id, bindings, candidates,
        activeEpisode: { timestamp: isoTimestamp(activeRoot), userPrompt: promptPreview(activeRoot) },
        evaluatedCount: maxCount, acceptedCount: candidates.length, refusedCount, refusalReasons, cursors: new Map(), relationFrontier, largestSafe,
      };
      return inspectionPage(inspectionGrant, 0);
    },
  });

  pi.registerTool({
    name: "retire_episodes",
    label: "retire episodes",
    description: "Before every retirement call, inspect_episode_retirement and page as needed. Independently choose fromEpisodeInclusive as the oldest included completed episode, author continuationGoal and pinnedWorkingState, then provide the inspectionWitness. The capsule model does not decide the boundary, goal, or pin. Never include active work.",
    parameters: retireSchema,
    executionMode: "sequential",
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Authoring retirement capsule…"), 0, 0);
      }
      const receipt = result.details as (EpisodeRetirementReceiptV2 | EpisodeRetirementReceiptV3 | EpisodeRetirementReceiptV4 | EpisodeRetirementReceiptV5) | undefined;
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
      const generation = receipt.version === 3 || receipt.version === 5 && receipt.mode === "forward" ? `generation ${receipt.generation}; this retirement: ${receipt.deltaMetrics.newlyCompletedEpisodeCount} episode(s), ${receipt.deltaMetrics.newlyCompletedMessageCount} message(s), ${receipt.deltaMetrics.newlyCompletedSourceBytes} B source → ${receipt.deltaMetrics.newCapsuleTextBytes} B capsule-text` : receipt.version === 4 || receipt.version === 5 && (receipt.mode === "recompose" || receipt.mode === "deepen") ? `generation ${receipt.generation}; earlier additions: ${receipt.compositionMetrics.earlierEpisodeCount} episode(s), ${receipt.compositionMetrics.earlierMessageCount} message(s), ${receipt.compositionMetrics.earlierSourceBytes} B; later additions: ${receipt.compositionMetrics.laterEpisodeCount} episode(s), ${receipt.compositionMetrics.laterMessageCount} message(s), ${receipt.compositionMetrics.laterSourceBytes} B; cumulative ${receipt.compositionMetrics.cumulativeMessageCount} message(s), ${receipt.compositionMetrics.cumulativeSourceBytes} B source → ${receipt.compositionMetrics.newCapsuleTextBytes} B capsule-text` : "generation 1";
      const compact = `${generation}; cumulative ${metrics.completedEpisodeCount} completed episode(s), ${metrics.sourceMessageCount} source message(s), ${metrics.sourceMessageBytes} B serialized source → ${metrics.capsuleTextBytes} B capsule-text; ${receipt.provider}/${receipt.model} (${receipt.reasoningEffort})${usageText ? `; LLM: ${usageText}` : ""}`;
      if (!expanded) {
        return new Text(theme.fg("success", `${compact} (${keyHint("app.tools.expand", "to expand")})`), 0, 0);
      }
      return new Text(theme.fg("success", `${compact}\n\nProvider continuation (exact text; not rewritten JSONL history):\n${continuationText(receipt as AnyReceipt)}\n\nProvenance: ${receipt.sourceEntryIds.join(", ")}`), 0, 0);
    },
    async execute(_id, params, signal, onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
      if (typeof params.continuationGoal !== "string" || !params.continuationGoal.trim() || params.continuationGoal.length > CONTINUATION_GOAL_MAX_CHARS) throw new Error("Episode retirement requires a non-empty bounded continuationGoal.");
      if (typeof params.pinnedWorkingState !== "string" || !params.pinnedWorkingState.trim() || params.pinnedWorkingState.length > 2_000) throw new Error("Episode retirement requires a non-empty bounded pinnedWorkingState.");
      if (!inspectionGrant || params.inspectionWitness !== inspectionGrant.witness) throw new Error("Episode retirement refused: inspection witness authority is unavailable.");
      const binding = inspectionGrant.bindings.get(params.fromEpisodeInclusive);
      if (!binding) throw new Error("Episode retirement refused: inspection witness authority is unavailable.");
      const contextEntries = resolvedSlots(ctx.sessionManager);
      const activeRoot = contextEntries.filter((entry) => entry.type === "message" && entry.message?.role === "user").at(-1);
      if (!activeRoot || activeRoot.id !== inspectionGrant.activeUserEntryId || activeRootDigest(contextEntries, activeRoot.id) !== inspectionGrant.digest) throw new Error("Episode retirement refused: inspection witness authority is stale.");
      const assessment = assessLatestReceipt(branch, contextEntries);
      if (assessment.state === "compacted") throw new Error("Episode retirement refused: native compaction after retirement is unsupported.");
      if (assessment.state === "malformed") throw new Error("Episode retirement refused: latest receipt chain is malformed or inactive.");
      const parentEntry = assessment.state === "valid" ? assessment.entry : undefined;
      const preflight = preflightRetirement(contextEntries, parentEntry, binding.count);
      if ("reason" in preflight || preflightSummary(preflight) !== binding.summary) throw new Error("Episode retirement refused: inspection witness authority is stale.");
      const count = binding.count;
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
            text: capsuleRequest(selected, active, params.continuationGoal, params.pinnedWorkingState, parentEntry?.data.capsule, before, after, emitsV4),
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
      const common = { version: 5 as const, kind: RECEIPT_TYPE as "episode-retirement", sourceEntryIds: cumulativeIds, sourceFingerprints: cumulativeFingerprints, activeUserEntryId: selection.activeUserEntryId, capsule, pinnedWorkingState: params.pinnedWorkingState, provider: configured.provider, model: configured.model, reasoningEffort, promptVersion: "capsule-v5" as const, usage: Object.fromEntries(Object.entries(response.usage)), replacementMetrics } satisfies Omit<EpisodeRetirementReceiptV5Initial, "mode">;
      let receipt: EpisodeRetirementReceiptV5;
      if (parentEntry && emitsV4) {
        receipt = {
          ...common, mode: before.length === 0 ? "recompose" : "deepen", generation: nextGeneration(parentEntry.data),
          parentReceiptEntryId: parentEntry.id, parentReceiptFingerprint: hashJson(parentEntry.data), priorCapsuleFingerprint: hashJson(parentEntry.data.capsule),
          newlyIncorporatedBeforeParentEntries: before.map((entry) => ({ id: entry.id, fingerprint: fingerprintEntry(entry) })), newlyCompletedAfterParentEntries: after.map((entry) => ({ id: entry.id, fingerprint: fingerprintEntry(entry) })),
          compositionMetrics: { earlierEpisodeCount: rawMetrics(contextEntries, before.map((entry) => entry.id)).completedEpisodeCount, earlierMessageCount: before.length, earlierSourceBytes: Buffer.byteLength(JSON.stringify(before.map((entry) => entry.message))), laterEpisodeCount: rawMetrics(contextEntries, after.map((entry) => entry.id)).completedEpisodeCount, laterMessageCount: after.length, laterSourceBytes: Buffer.byteLength(JSON.stringify(after.map((entry) => entry.message))), cumulativeMessageCount: cumulative.length, cumulativeSourceBytes: replacementMetrics.sourceMessageBytes, priorCapsuleTextBytes: Buffer.byteLength(capsuleText(parentEntry.data.capsule, parentEntry.data.sourceEntryIds)), newCapsuleTextBytes: replacementMetrics.capsuleTextBytes },
        } satisfies EpisodeRetirementReceiptV5Corrective;
      } else if (parentEntry) {
        receipt = {
          ...common, mode: "forward", generation: nextGeneration(parentEntry.data),
          parentReceiptEntryId: parentEntry.id, parentReceiptFingerprint: hashJson(parentEntry.data), priorCapsuleFingerprint: hashJson(parentEntry.data.capsule), newlyCompletedEpisodeEntries: selected.map((entry) => ({ id: entry.id, fingerprint: fingerprintEntry(entry) })),
          deltaMetrics: { newlyCompletedEpisodeCount: count, newlyCompletedMessageCount: selected.length, newlyCompletedSourceBytes: Buffer.byteLength(JSON.stringify(selected.map((entry) => entry.message))), cumulativeMessageCount: cumulative.length, cumulativeSourceBytes: replacementMetrics.sourceMessageBytes, priorCapsuleTextBytes: Buffer.byteLength(capsuleText(parentEntry.data.capsule, parentEntry.data.sourceEntryIds)), newCapsuleTextBytes: replacementMetrics.capsuleTextBytes },
        } satisfies EpisodeRetirementReceiptV5Forward;
      } else {
        receipt = { ...common, mode: "initial" } satisfies EpisodeRetirementReceiptV5Initial;
      }
      pi.appendEntry(RECEIPT_TYPE, receipt);
      inspectionGrant = undefined;
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
