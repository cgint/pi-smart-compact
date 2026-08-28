import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Public extension hooks expose these structurally; avoid importing Pi's private transitive agent-core package. */
type AgentMessage = { role: string; content: unknown; timestamp: number; [key: string]: unknown };

const ENABLED_VAR = "PI_EPISODE_RETIREMENT_ENABLED";
const RECEIPT_TYPE = "episode-retirement";

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

export type EpisodeRetirementReceipt = {
  version: 1;
  kind: "episode-retirement";
  sourceEntryIds: string[];
  sourceFingerprints: string[];
  activeUserEntryId: string;
  capsule: ContinuationCapsule;
};

type Selection = {
  sourceEntryIds: string[];
  sourceFingerprints: string[];
  activeUserEntryId: string;
};

type Projection = { applied: true; messages: AgentMessage[] } | { applied: false; reason: string };

function isPlainMessage(entry: SessionLikeEntry): entry is SessionLikeEntry & { message: AgentMessage } {
  return entry.type === "message" && entry.message !== undefined;
}

function isSupportedMessage(message: AgentMessage): boolean {
  if (message.role === "user" && typeof message.content === "string") return true;
  if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
    return Array.isArray(message.content) && !message.content.some((part) => part.type === "image");
  }
  return false;
}

export function fingerprintEntry(entry: SessionLikeEntry): string {
  return createHash("sha256").update(JSON.stringify(entry.message)).digest("hex");
}

export function selectLatestCompletedEpisodes(entries: SessionLikeEntry[], count: number): Selection | undefined {
  if (!Number.isInteger(count) || count < 1) return undefined;
  if (entries.some((entry) => !isPlainMessage(entry) || !isSupportedMessage(entry.message))) return undefined;

  const userIndexes = entries.flatMap((entry, index) => entry.message!.role === "user" ? [index] : []);
  if (userIndexes.length < count + 1) return undefined;
  const activeUserIndex = userIndexes.at(-1)!;
  const sourceStart = userIndexes[userIndexes.length - count - 1];
  const selected = entries.slice(sourceStart, activeUserIndex);
  if (selected.length === 0 || selected.at(-1)!.message!.role !== "assistant") return undefined;

  const openToolCalls = new Set<string>();
  for (const entry of selected) {
    const message = entry.message!;
    if (message.role === "assistant") {
      for (const part of message.content as Array<{ type: string; id?: string }>) if (part.type === "toolCall" && part.id) openToolCalls.add(part.id);
    }
    if (message.role === "toolResult") {
      if (!openToolCalls.delete(message.toolCallId as string)) return undefined;
    }
  }
  if (openToolCalls.size > 0) return undefined;

  return {
    sourceEntryIds: selected.map((entry) => entry.id),
    sourceFingerprints: selected.map(fingerprintEntry),
    activeUserEntryId: entries[activeUserIndex].id,
  };
}

function capsuleText(capsule: ContinuationCapsule, sourceEntryIds: string[]): string {
  const list = (title: string, items: string[]) => items.length ? "\n" + title + ":\n" + items.map((item) => "- " + item).join("\n") : "";
  return "[CONTINUATION CAPSULE — episode retirement]\n" +
    "Objective: " + capsule.objective +
    list("Findings", capsule.findings) + list("Decisions", capsule.decisions) +
    list("Unresolved", capsule.unresolved) +
    "\nNext step: " + capsule.nextStep +
    "\nOriginal source entry IDs (recover with recall_episode): " + sourceEntryIds.join(", ");
}

function validatedRange(entries: SessionLikeEntry[], receipt: EpisodeRetirementReceipt): { start: number; activeIndex: number } | Projection {
  const activeIndex = entries.findIndex((entry) => entry.id === receipt.activeUserEntryId);
  const sourceIndexes = receipt.sourceEntryIds.map((id) => entries.findIndex((entry) => entry.id === id));
  if (activeIndex < 0 || sourceIndexes.some((index) => index < 0)) return { applied: false, reason: "source entries unavailable" };
  const start = sourceIndexes[0];
  if (start < 0 || sourceIndexes.some((index, offset) => index !== start + offset) || start >= activeIndex) return { applied: false, reason: "noncontiguous source entries" };
  const selected = entries.slice(start, activeIndex);
  if (selected.length !== receipt.sourceEntryIds.length || selected.some((entry, index) => !isPlainMessage(entry) || fingerprintEntry(entry) !== receipt.sourceFingerprints[index])) return { applied: false, reason: "fingerprint mismatch" };
  if (!isPlainMessage(entries[activeIndex]) || entries[activeIndex].message.role !== "user" || !isSupportedMessage(entries[activeIndex].message)) return { applied: false, reason: "active episode is not protected" };
  if (entries.some((entry) => !isPlainMessage(entry) || !isSupportedMessage(entry.message))) return { applied: false, reason: "unsupported session shape" };
  return { start, activeIndex };
}

function prependCapsule(message: AgentMessage, text: string): AgentMessage {
  if (typeof message.content === "string") return { ...message, content: text + "\n\n" + message.content };
  return { ...message, content: [{ type: "text", text: text + "\n\n" }, ...(message.content as unknown[])] };
}

export function applyEpisodeRetirement(entries: SessionLikeEntry[], receipt: EpisodeRetirementReceipt): Projection {
  const range = validatedRange(entries, receipt);
  if ("applied" in range) return range;
  const capsule = capsuleText(receipt.capsule, receipt.sourceEntryIds);
  const messages = entries.map((entry) => entry.message!);
  messages.splice(range.start, range.activeIndex - range.start);
  messages[range.start] = prependCapsule(messages[range.start], capsule);
  return { applied: true, messages };
}

export function projectEventMessages(entries: SessionLikeEntry[], eventMessages: AgentMessage[], receipt: EpisodeRetirementReceipt): Projection {
  if (entries.length !== eventMessages.length || entries.some((entry, index) => fingerprintEntry(entry) !== createHash("sha256").update(JSON.stringify(eventMessages[index])).digest("hex"))) return { applied: false, reason: "event message mismatch" };
  const range = validatedRange(entries, receipt);
  if ("applied" in range) return range;
  const messages = [...eventMessages];
  messages.splice(range.start, range.activeIndex - range.start);
  messages[range.start] = prependCapsule(messages[range.start], capsuleText(receipt.capsule, receipt.sourceEntryIds));
  return { applied: true, messages };
}

function activePathIsSupported(entries: SessionLikeEntry[]): boolean {
  return !entries.some((entry) => entry.type === "compaction" || entry.type === "branch_summary" || (entry.type === "custom" && entry.customType !== RECEIPT_TYPE));
}

function treeHasBranch(nodes: Array<{ children?: unknown[] }>): boolean {
  return nodes.some((node) => (node.children?.length ?? 0) > 1 || treeHasBranch((node.children ?? []) as Array<{ children?: unknown[] }>));
}

function getReceipts(entries: SessionLikeEntry[]): EpisodeRetirementReceipt[] {
  return entries.flatMap((entry) => entry.type === "custom" && entry.customType === RECEIPT_TYPE && isReceipt(entry.data) ? [entry.data] : []);
}

function isReceipt(value: unknown): value is EpisodeRetirementReceipt {
  const candidate = value as Partial<EpisodeRetirementReceipt> | undefined;
  return candidate?.version === 1 && candidate.kind === RECEIPT_TYPE && Array.isArray(candidate.sourceEntryIds) && Array.isArray(candidate.sourceFingerprints) && typeof candidate.activeUserEntryId === "string" && typeof candidate.capsule?.objective === "string";
}

const capsuleSchema = Type.Object({
  objective: Type.String(), findings: Type.Array(Type.String()), decisions: Type.Array(Type.String()),
  unresolved: Type.Array(Type.String()), nextStep: Type.String(),
});

export default function registerEpisodeRetirement(pi: ExtensionAPI): void {
  if (process.env[ENABLED_VAR] !== "true") return;

  pi.registerTool({
    name: "retire_episodes", label: "retire episodes",
    description: "Replace the latest N completed episodes with your structured continuation capsule. The active episode is never selected.",
    parameters: Type.Object({ latestCompletedEpisodes: Type.Integer({ minimum: 1 }), capsule: capsuleSchema }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
      if (!activePathIsSupported(branch) || treeHasBranch(ctx.sessionManager.getTree() as Array<{ children?: unknown[] }>) || getReceipts(branch).length > 0) return { content: [{ type: "text", text: "Episode retirement refused: unsupported or overlapping session shape." }], details: {}, isError: true };
      const messageEntries = branch.filter(isPlainMessage);
      const selection = selectLatestCompletedEpisodes(messageEntries, params.latestCompletedEpisodes);
      if (!selection) return { content: [{ type: "text", text: "Episode retirement refused: no unambiguous completed episode suffix." }], details: {}, isError: true };
      const receipt: EpisodeRetirementReceipt = { version: 1, kind: RECEIPT_TYPE, ...selection, capsule: params.capsule };
      pi.appendEntry(RECEIPT_TYPE, receipt);
      return { content: [{ type: "text", text: "Episode retirement accepted for source entries: " + receipt.sourceEntryIds.join(", ") + "." }], details: receipt };
    },
  });

  pi.registerTool({
    name: "recall_episode", label: "recall retired episode",
    description: "Mechanically retrieve the exact original messages covered by the stored episode-retirement receipt.",
    parameters: Type.Object({ sourceEntryId: Type.Optional(Type.String()) }), executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
      if (!activePathIsSupported(branch) || treeHasBranch(ctx.sessionManager.getTree() as Array<{ children?: unknown[] }>)) return { content: [{ type: "text", text: "Episode recall refused: unsupported session shape." }], details: {}, isError: true };
      const receipts = getReceipts(branch);
      if (receipts.length !== 1) return { content: [{ type: "text", text: "Episode recall refused: expected exactly one receipt." }], details: {}, isError: true };
      const receipt = receipts[0];
      const originals = receipt.sourceEntryIds.map((id) => branch.find((entry) => entry.id === id));
      if (originals.some((entry, index) => !entry || !isPlainMessage(entry) || fingerprintEntry(entry) !== receipt.sourceFingerprints[index])) {
        return { content: [{ type: "text", text: "Episode recall refused: source entries are unavailable or changed." }], details: {}, isError: true };
      }
      if (!params.sourceEntryId) {
        const inventory = originals.map((entry) => ({ id: entry!.id, role: entry!.message!.role, bytes: Buffer.byteLength(JSON.stringify(entry!.message)) }));
        return { content: [{ type: "text", text: JSON.stringify(inventory, null, 2) }], details: { sourceEntryIds: receipt.sourceEntryIds } };
      }
      const sourceIndex = receipt.sourceEntryIds.indexOf(params.sourceEntryId);
      if (sourceIndex < 0) return { content: [{ type: "text", text: "Episode recall refused: sourceEntryId is outside the receipt." }], details: {}, isError: true };
      const entry = originals[sourceIndex]!;
      return { content: [{ type: "text", text: JSON.stringify({ id: entry.id, message: entry.message }, null, 2) }], details: { sourceEntryId: entry.id } };
    },
  });

  pi.on("context", (event, ctx): any => {
    const branch = ctx.sessionManager.getBranch() as SessionLikeEntry[];
    const receipts = getReceipts(branch);
    if (!activePathIsSupported(branch) || treeHasBranch(ctx.sessionManager.getTree() as Array<{ children?: unknown[] }>) || receipts.length !== 1) return;
    const messageEntries = branch.filter(isPlainMessage);
    const projected = projectEventMessages(messageEntries, event.messages as AgentMessage[], receipts[0]);
    if (projected.applied) return { messages: projected.messages as any };
  });
}
