import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ExtensionAPI, Model } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load the compaction prompt from the markdown file.
 * This is the only configuration point — edit the markdown to change behavior.
 */
function loadPrompt(): string {
  try {
    return readFileSync(join(__dirname, "findings", "DRAFT_COMPACTION_PROMPT.md"), "utf-8");
  } catch {
    // Fallback: use Pi's built-in prompt if our file is missing
    return "";
  }
}

/**
 * Minimal serialization of messages (mirrors Pi's serializeConversation).
 * Only handles the fields we need from CompactionPreparation.messagesToSummarize.
 */
function serializeMessages(messages: Array<{ role: string; content: string | Array<any> }>): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const content = msg.content;
      if (typeof content === "string") {
        parts.push(`[User]: ${content}`);
      } else if (Array.isArray(content)) {
        parts.push(`[User]: ${content.filter(b => b.type === "text").map(b => b.text).join(" ")}`);
      }
    } else if (msg.role === "assistant") {
      const content = msg.content;
      if (typeof content === "string") {
        parts.push(`[Assistant]: ${content}`);
      } else if (Array.isArray(content)) {
        const textParts = content.filter(b => b.type === "text").map(b => b.text).join(" ");
        const thinkingParts = content.filter(b => b.type === "thinking").map(b => b.thinking).join(" ");
        const toolCalls = content.filter(b => b.type === "toolCall").map(b => `${b.name}(${JSON.stringify(b.arguments)})`).join("; ");
        if (thinkingParts) parts.push(`[Assistant thinking]: ${thinkingParts}`);
        if (textParts) parts.push(`[Assistant]: ${textParts}`);
        if (toolCalls) parts.push(`[Assistant tool calls]: ${toolCalls}`);
      }
    } else if (msg.role === "toolResult") {
      const content = msg.content;
      if (typeof content === "string") {
        parts.push(`[Tool result]: ${content.slice(0, 2000)}`);
      } else if (Array.isArray(content)) {
        parts.push(`[Tool result]: ${content.filter(b => b.type === "text").map(b => b.text).join(" ").slice(0, 2000)}`);
      }
    }
  }
  return parts.join("\n\n");
}

/**
 * Main compaction function. Called from the session_before_compact hook.
 * Returns the compacted summary or undefined to fall back to Pi's compaction.
 */
async function runSmartCompact(
  model: Model<any>,
  conversationText: string,
  previousSummary: string | undefined,
  customInstructions: string | undefined,
  signal: AbortSignal,
  prompt: string,
): Promise<string | undefined> {
  try {
    // Build the full prompt for the LLM
    let llmPrompt = `<conversation>\n${conversationText}\n</conversation>\n\n`;
    if (previousSummary) {
      llmPrompt += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
    }
    llmPrompt += prompt;

    if (customInstructions) {
      llmPrompt += `\n\nAdditional focus: ${customInstructions}`;
    }

    // Call the LLM
    const response = await completeSimple(model, {
      systemPrompt: "You are a session compaction specialist. Produce only the structured output — no conversation, no commentary.",
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: llmPrompt }] }],
    }, { signal, maxTokens: Math.min(8192, model.maxTokens > 0 ? model.maxTokens : 8192) });

    if (response.stopReason === "error") {
      console.warn(`[pi-smart-compact] Compaction failed: ${response.errorMessage || "Unknown error"}`);
      return undefined; // Fall back to Pi's compaction
    }

    const textContent = response.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");

    return textContent;
  } catch (err) {
    console.warn("[pi-smart-compact] Compaction error:", err);
    return undefined; // Fall back to Pi's compaction
  }
}

export default function register(pi: ExtensionAPI): void {
  let currentModel: Model<any> | null = null;

  // Track the current model so we can use it for LLM calls
  pi.on("model_select", (event) => {
    currentModel = event.model;
  });

  // Intercept compaction before Pi runs it
  pi.on("session_before_compact", async (event, result) => {
    // Need a model to make LLM calls
    if (!currentModel) {
      console.warn("[pi-smart-compact] No model available, falling back to Pi's compaction");
      return;
    }

    const prompt = loadPrompt();
    if (!prompt) {
      console.warn("[pi-smart-compact] No prompt loaded, falling back to Pi's compaction");
      return;
    }

    const conversationText = serializeMessages(event.preparation.messagesToSummarize);
    const summary = await runSmartCompact(
      currentModel,
      conversationText,
      event.preparation.previousSummary,
      event.customInstructions,
      event.signal,
      prompt,
    );

    if (summary) {
      // Replace Pi's compaction with ours
      result.compaction = {
        summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      };
    }
    // If summary is undefined, fall back to Pi's compaction (result.compaction is not set)
  });
}