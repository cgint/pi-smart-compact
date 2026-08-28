// Turn-level reduction — shrink settled tool results between agent turns.
//
// Everything here is PURE except `reduceContext`, which takes its model call as a
// parameter. Eligibility, the floor and the cache are testable with no network and no
// running Pi host.
//
// The safety argument rests on one verified fact (`agent-loop.js:178-184`): the
// `context` transform's result is assigned to a LOCAL before conversion, so the stored
// session keeps every original. This is a view over a lossless record — which is what
// makes dropping anything defensible at all.
//
// What counts as a "turn" (verified in `agent-loop.js`): `turn_end` fires at line 131
// INSIDE `while (hasMoreToolCalls …)`, and only afterwards does line 151 ask
// `shouldStopAfterTurn`. So one turn = one LLM call plus the tool results it produced,
// and many turns occur before the user speaks again — that outer boundary is
// `agent_settled`, not `turn_end`. Counting turns is therefore counting agent
// iterations, which is the unit this reduction is about.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, "..", "prompts", "turn-reduction-prompt.md");

export const ENABLED_VAR = "PI_TURN_REDUCE_ENABLED";
export const AFTER_N_VAR = "PI_TURN_REDUCE_AFTER_N";
export const MIN_CHARS_VAR = "PI_TURN_REDUCE_MIN_CHARS";
export const MIN_RATIO_VAR = "PI_TURN_REDUCE_MIN_RATIO";

// Below this, a reduction cannot save enough to be worth the risk that the reducing
// model misrepresents the result — and the length alone tells us that, so no model call
// is spent to discover it. (Measured 2026-08-11: a 537-char result yielded 18 chars.)
// Raised from 800 on 2026-08-11 evidence: an 874-char result cleared the old gate and
// came back one character shorter, spending a model call to learn nothing.
export const DEFAULT_MIN_INPUT_CHARS = 1_500;
// ONE rule, not two. A reduction must remove at least this share of the result, or the
// original stands. The former absolute companion bar (300 chars) only ever bound between
// 800 and ~857 characters and became dead code the moment the gate rose — two numbers
// that interact are harder to reason about than one that does not.
export const DEFAULT_MIN_GAIN_RATIO = 0.35;
// Above this many restored tokens the reduction is rejected outright rather than patched.
// Measured 2026-08-11: a 12,093-char grep reduced to three useful lines followed by ~150
// bare `file:line` references with their lines stripped — 4,400 characters of unusable
// noise. Density of protected content is evidence that a result should NOT be reduced,
// not something to compensate for after the fact.
export const MAX_RESTORED_TOKENS = 8;
/** One in-place retry. More would block the awaited context hook for longer than it saves. */
export const MAX_ATTEMPTS = 2;

export interface ReductionConfig {
  enabled: boolean;
  /** How many agent turns a tool result must be behind before it may be reduced. */
  afterN: number;
  /** Results shorter than this are never sent to the reducing model. */
  minInputChars: number;
  /** Share of the original a reduction must remove to be kept. */
  minGainRatio: number;
}

/** Why a message was not reduced. Recorded so "nothing happened" can be diagnosed. */
export type Verdict =
  | { kind: "too-small"; chars: number }
  | { kind: "not-worth-it"; before: number; after: number }
  | { kind: "too-protected"; missing: number }
  | { kind: "compaction-protected" }
  | { kind: "failed"; cause: string };

/** Is this reduction a good enough trade to accept the risk of a wrong recap? */
export function worthKeeping(original: string, reduced: string, minRatio = DEFAULT_MIN_GAIN_RATIO): boolean {
  return (original.length - reduced.length) / original.length >= minRatio;
}

/** `afterN` defaults to 1 — reduce as soon as the turn that produced it is over. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ReductionConfig {
  const raw = Number(env[AFTER_N_VAR]);
  const min = Number(env[MIN_CHARS_VAR]);
  const ratio = Number(env[MIN_RATIO_VAR]);
  return {
    enabled: env[ENABLED_VAR] === "true",
    afterN: Number.isInteger(raw) && raw >= 1 ? raw : 1,
    minInputChars: Number.isInteger(min) && min >= 0 ? min : DEFAULT_MIN_INPUT_CHARS,
    minGainRatio: ratio > 0 && ratio < 1 ? ratio : DEFAULT_MIN_GAIN_RATIO,
  };
}

export function loadReductionPrompt(): string | null {
  try {
    return readFileSync(PROMPT_PATH, "utf-8");
  } catch {
    return null;
  }
}

interface ToolResultLike {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text?: string }>;
}

function isToolResult(message: unknown): message is ToolResultLike {
  const m = message as { role?: unknown; toolCallId?: unknown; content?: unknown };
  return m?.role === "toolResult" && typeof m.toolCallId === "string" && Array.isArray(m.content);
}

export function textOf(message: ToolResultLike): string {
  return message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

/**
 * Which turn each tool result arrived in.
 *
 * `turn_end` carries `toolResults` as an ARRAY — one turn can produce many tool calls —
 * so every id in that array is stamped with the same turn number. The counter is ours
 * rather than the event's `turnIndex`: the core emits `{ type, message, toolResults }`
 * at `agent-loop.js:131` without it, so depending on it would be depending on an outer
 * layer we have not verified.
 */
export class TurnTracker {
  private turn = 0;
  private readonly turnOf = new Map<string, number>();

  /** Call from the `turn_end` handler. */
  endTurn(toolResults: ReadonlyArray<{ toolCallId?: unknown }>): void {
    this.turn += 1;
    for (const result of toolResults ?? []) {
      if (typeof result?.toolCallId === "string") this.turnOf.set(result.toolCallId, this.turn);
    }
  }

  /** How many tool calls the tracker has placed. Zero means `turn_end` never delivered any. */
  size(): number {
    return this.turnOf.size;
  }

  /** How many completed turns ago this tool call landed, or undefined if unseen. */
  turnsBehind(toolCallId: string): number | undefined {
    const seen = this.turnOf.get(toolCallId);
    return seen === undefined ? undefined : this.turn - seen;
  }
}

/**
 * Indices of tool results at least `afterN` turns behind.
 *
 * A tool call we never observed is NOT eligible. On a resumed session we cannot place it
 * in time, and reducing something we cannot date is exactly the kind of silent loss the
 * floor exists to prevent. Being conservative costs a missed saving; being wrong costs
 * the session.
 */
export function eligibleIndices(
  messages: readonly unknown[],
  afterN: number,
  turnsBehind: (toolCallId: string) => number | undefined,
): number[] {
  return messages.flatMap((message, index) => {
    if (!isToolResult(message)) return [];
    const behind = turnsBehind(message.toolCallId);
    return behind !== undefined && behind >= afterN ? [index] : [];
  });
}

// The floor. Each pattern marks content whose loss has broken resumption before —
// `prompts/smart-compaction-prompt.md` rules 10-12, applied here at higher frequency.
const PROTECTED = [
  /\b(?:exit(?:\s*code)?|status)[:= ]\s*[1-9]\d*\b/gi, // non-zero exits
  /\bHTTP\s*[45]\d{2}\b|\b[45]\d{2}\s+(?:error|not found|forbidden|unauthorized)\b/gi,
  /\b[\w./-]+\.[a-z]{1,4}:\d+(?::\d+)?\b/g, // file:line[:col]
  /(?:^|\s)(?:\/|\.\/|~\/)[\w./-]{2,}/g, // absolute / relative paths
  /\b(?:E[A-Z]{2,}|[A-Z][a-zA-Z]*(?:Error|Exception))\b/g, // ENOENT, TypeError…
];

/** Protected substrings present in the text, in first-seen order, deduped. */
export function protectedTokens(text: string): string[] {
  const found = PROTECTED.flatMap((re) => [...text.matchAll(re)].map((m) => m[0].trim()));
  return [...new Set(found.filter(Boolean))];
}

/**
 * Enforce the floor, or refuse.
 *
 * A few missing protected tokens are appended back — losing a path should cost a line,
 * not the whole saving. But past `MAX_RESTORED_TOKENS` this returns **null**: restoring
 * hundreds of bare `file:line` references produces line numbers stripped of their lines,
 * which is noise the agent cannot act on. A result that dense should keep its original.
 */
export function applyFloor(
  original: string,
  reduced: string,
  maxRestored = MAX_RESTORED_TOKENS,
): string | null {
  const missing = protectedTokens(original).filter((token) => !reduced.includes(token));
  if (missing.length > maxRestored) return null;
  return missing.length > 0 ? `${reduced}\n[preserved: ${missing.join(" ")}]` : reduced;
}

export interface Reduction {
  toolCallId: string;
  toolName: string;
  before: number;
  after: number;
  restored: number;
  /** The full texts, so a human can judge the trade rather than trust a character count. */
  originalText: string;
  reducedText: string;
}

/**
 * Filename for one reduction's audit file.
 *
 * One file per reduction: a single appended log grows without bound and cannot be
 * navigated, and these entries carry whole file bodies. Timestamp first so the directory
 * sorts chronologically; tool name next so a scan reads as a session; id tail last
 * because the `chatcmpl-tool-` prefix is shared and carries no information.
 */
/**
 * Directory name for one session: creation time first, so the listing sorts by recency.
 *
 * The time comes out of the id itself — Pi's session ids are UUIDv7, whose first 48 bits
 * are the creation instant in milliseconds. Verified 2026-08-11 against Pi's own session
 * filenames: `019ff268-97bb…` → `2026-08-11T19-59-28-699Z`, matching to the millisecond
 * on every pair checked. Deriving it beats recording it, because the id is stable across
 * a resume while "when this extension first saw the session" is not.
 *
 * Truncated to seconds — the milliseconds add noise without separating anything a human
 * is trying to tell apart. Falls back to the bare id if the id is not a parseable v7,
 * because a wrong timestamp is worse than none.
 */
export function sessionDirName(sessionId: string, now = Date.now()): string {
  const hex = sessionId.replace(/-/g, "").slice(0, 12);
  if (!/^[0-9a-f]{12}$/i.test(hex)) return sessionId;
  const ms = Number.parseInt(hex, 16);
  // Plausibility bound: a hex-looking id that is not a v7 timestamp must not be dressed
  // up as one. 2020-01-01 to a day ahead of now.
  if (ms < 1_577_836_800_000 || ms > now + 86_400_000) return sessionId;
  return `${new Date(ms).toISOString().slice(0, 19).replace(/:/g, "-")}Z-${sessionId}`;
}

export function originalFilename(toolCallId: string): string {
  return `${toolCallId.slice(-10)}.original.txt`;
}

/**
 * The line appended to a reduced message so the full result stays reachable
 * (`concepts/context-pointers.md`; design decision 11).
 *
 * Phrased as a possibility, not a guarantee: `.pi/` is scratch space that may be cleaned,
 * and a dangling pointer must degrade to a missing file rather than to a false claim that
 * the detail was preserved.
 */
export function pointerLine(relativePath: string, originalChars: number): string {
  return `[reduced from ${originalChars} chars — full original, if still present: ${relativePath}]`;
}

export function reductionFilename(r: Reduction, at: string): string {
  const stamp = at.replace(/[:.]/g, "-");
  const tool = r.toolName.replace(/[^\w.-]/g, "_") || "tool";
  return `${stamp}__${tool}__${r.toolCallId.slice(-10)}.md`;
}

/** One human-readable audit entry. Pure, so the format is testable without any I/O. */
export function formatReduction(r: Reduction, at: string): string {
  const saved = r.before - r.after;
  const pct = r.before > 0 ? Math.round((saved / r.before) * 100) : 0;
  return [
    `## ${r.toolName} · …${r.toolCallId.slice(-10)} · ${at}`,
    "",
    `${r.before} → ${r.after} chars (−${saved}, ${pct}%)` +
      (r.restored > 0 ? ` · ${r.restored} protected token(s) restored by the floor` : ""),
    "",
    "### What the model now sees",
    "",
    "```",
    r.reducedText,
    "```",
    "",
    "<details><summary>What it replaced</summary>",
    "",
    "```",
    r.originalText,
    "```",
    "",
    "</details>",
    "",
  ].join("\n");
}

/** Minimal shape of a compaction entry for the protected-range check. */
export interface CompactionEntryShape {
  id: string;
  firstKeptEntryId: string;
}

/** Minimal shape of a session entry for membership testing. */
export interface SessionEntryShape {
  id: string;
}

export interface ReduceOptions {
  config: ReductionConfig;
  turnsBehind: (toolCallId: string) => number | undefined;
  /** Reduce one tool result's text. Failure must reject; the caller keeps the original. */
  reduce: (text: string, toolName: string) => Promise<string>;
  onReduced?: (r: Reduction) => void;
  /** Called when a message is decided NOT to be reduced, with the reason. */
  onVerdict?: (toolCallId: string, toolName: string, verdict: Verdict) => void;
  /** Called immediately before each reduction model call — the only thing that costs. */
  onAttempt?: (toolCallId: string, toolName: string) => void;
  /**
   * Persist the untouched original and return a pointer line for it, or undefined to
   * append none. Called only for reductions that are actually kept.
   */
  pointer?: (toolCallId: string, original: string) => string | undefined;
  /**
   * Decisions, keyed by `toolCallId`. A string is the reduction to reuse; `null` is a
   * verdict — never spend another reduction call on this message. Both are final, which
   * is what makes a backlog impossible.
   */
  cache?: Map<string, string | null>;
  /**
   * Tool-call IDs inside the closed compaction-protected range. Derived from the
   * original session branch on every context event; post-compaction material is absent.
   */
  protectedToolCallIds?: Set<string>;
}

/**
 * Return a message array with settled tool results reduced.
 *
 * Write-once is the cost argument, not a nicety: this fires before EVERY request, so
 * re-reducing would rewrite the prefix each turn and miss the provider's prefix cache
 * from the edit point on — spending more than it saves. A `toolCallId` already in the
 * cache is reused byte-identically and never re-reduced.
 *
 * Never throws: any failure leaves that message exactly as it was.
 */
export async function reduceContext<T>(messages: readonly T[], options: ReduceOptions): Promise<T[]> {
  const { config, turnsBehind, reduce, onReduced, onVerdict, onAttempt, pointer, cache = new Map<string, string | null>(), protectedToolCallIds = new Set<string>() } = options;
  if (!config.enabled) return [...messages];

  const out = [...messages];
  for (const index of eligibleIndices(messages, config.afterN, turnsBehind)) {
    const message = out[index] as unknown as ToolResultLike;

    // Compaction-protected range check: entries between firstKeptEntryId (inclusive)
    // and the compaction entry (exclusive) are the working set compaction deliberately
    // kept verbatim. Reducing them destroys content that exists nowhere else in context.
    // This check is stateless — derived fresh each event from session entries.
    if (protectedToolCallIds.has(message.toolCallId)) {
      cache.set(message.toolCallId, null);
      onVerdict?.(message.toolCallId, message.toolName, { kind: "compaction-protected" });
      continue;
    }

    const original = textOf(message);
    if (!original.trim()) continue;

    // Decide in place, once. Every eligible message leaves this block either reduced or
    // verdicted, so none stays pending — which is what prevents a late, deep prefix edit.
    let replacement = cache.get(message.toolCallId);
    if (replacement === undefined) {
      const decide = (verdict: Verdict) => {
        cache.set(message.toolCallId, null);
        onVerdict?.(message.toolCallId, message.toolName, verdict);
      };

      if (original.length < config.minInputChars) {
        decide({ kind: "too-small", chars: original.length });
        continue;
      }

      let candidate: string | null | undefined;
      let cause = "unknown";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && candidate === undefined; attempt++) {
        try {
          onAttempt?.(message.toolCallId, message.toolName);
          candidate = applyFloor(original, (await reduce(original, message.toolName)).trim());
        } catch (error) {
          cause = `attempt ${attempt}/${MAX_ATTEMPTS}: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      if (candidate === undefined) {
        decide({ kind: "failed", cause });
        continue;
      }
      if (candidate === null) {
        decide({ kind: "too-protected", missing: protectedTokens(original).length });
        continue;
      }
      if (!worthKeeping(original, candidate, config.minGainRatio)) {
        decide({ kind: "not-worth-it", before: original.length, after: candidate.length });
        continue;
      }
      // The pointer is appended AFTER the trade is judged — the excerpt earns its keep on
      // its own merits, and ~90 characters of provenance is overhead we accept. It is
      // baked in before caching so the write-once value can never differ between requests.
      const line = pointer?.(message.toolCallId, original);
      if (line) candidate = `${candidate}\n${line}`;
      cache.set(message.toolCallId, candidate);
      onReduced?.({
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        before: original.length,
        after: candidate.length,
        restored: protectedTokens(original).filter((t) => !candidate.includes(t)).length,
        originalText: original,
        reducedText: candidate,
      });
      replacement = candidate;
    }
    if (replacement === null) continue; // verdicted: the main model keeps the original

    out[index] = { ...message, content: [{ type: "text", text: replacement }] } as unknown as T;
  }
  return out;
}
