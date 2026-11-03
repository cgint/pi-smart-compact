import { createHash, randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import {
  buildSessionContext,
  keyHint,
  type ExtensionAPI,
  type SessionManager,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-ai";

/** Public extension hooks expose these structurally; avoid importing Pi's private transitive agent-core package. */
type AgentMessage = {
  role: string;
  content: unknown;
  timestamp: number;
  [key: string]: unknown;
};

const RECEIPT_TYPE = "episode-retirement";
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

export default function registerEpisodeRetirement(pi: ExtensionAPI): void {
  // Legacy read-only compatibility: receipt creation tools (inspect_episode_retirement,
  // retire_episodes) are intentionally NOT registered; native-tree handoff is the sole
  // default creation path. recall_episode and the context projection handler remain
  // unconditionally available so historical episode-retirement receipts stay projectable
  // and recallable. This path appends no receipts and performs no model/network egress.

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
      // Defense-in-depth: assessLatestReceipt already validated the receipt range against the
      // resolved context, so this per-source fingerprint check is redundant. It is kept to fail
      // closed if the read path is ever refactored to skip that upstream validation.
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
