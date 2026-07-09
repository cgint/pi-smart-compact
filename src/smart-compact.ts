import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { complete } from "@earendil-works/pi-ai/compat";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, "..", "prompts", "smart-compaction-prompt.md");
const STATUS_KEY = "smart-compact";
const LOG_PREFIX = "[pi-smart-compact]";

/**
 * Load the compaction prompt from the markdown file.
 * This is the single configuration point — edit the file to change behavior.
 */
export function loadPrompt(): string | null {
  try {
    return readFileSync(PROMPT_PATH, "utf-8");
  } catch {
    return null;
  }
}

export default function register(pi: ExtensionAPI): void {
  const customPrompt = loadPrompt();
  if (!customPrompt) {
    console.warn(`${LOG_PREFIX} Failed to load prompt from ${PROMPT_PATH} — compaction interception disabled`);
    return;
  }

  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, signal } = event;
    const { messagesToSummarize, turnPrefixMessages, firstKeptEntryId, previousSummary, tokensBefore } = preparation;

    // Prefer a cheap/fast model for summarization; fall back to current model
    const summaryModel = ctx.modelRegistry.find("google", "gemini-2.5-flash") ?? ctx.model;
    if (!summaryModel) {
      console.warn(`${LOG_PREFIX} No model available for summarization, falling back to Pi's default`);
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(summaryModel);
    if (!auth.ok) {
      console.warn(`${LOG_PREFIX} Auth failed for ${summaryModel.id}: ${auth.error}, falling back`);
      return;
    }
    if (!auth.apiKey && summaryModel.provider !== "8081-twins" && summaryModel.provider !== "8081-sparky") {
      console.warn(`${LOG_PREFIX} No API key for ${summaryModel.provider}, falling back`);
      return;
    }

    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
    if (allMessages.length === 0) {
      return;
    }

    const conversationText = serializeConversation(convertToLlm(allMessages));

    ctx.ui.notify?.(
      `Smart compaction: summarizing ${allMessages.length} msgs (${tokensBefore.toLocaleString()} tokens) with ${summaryModel.id}…`,
      "info",
    );

    const summaryMessages = [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: buildSummaryRequest(customPrompt, conversationText, previousSummary),
          },
        ],
        timestamp: Date.now(),
      },
    ];

    try {
      const response = await complete(
        summaryModel,
        { messages: summaryMessages },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          env: auth.env,
          maxTokens: 8192,
          signal,
        },
      );

      const summary = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      if (!summary.trim()) {
        console.warn(`${LOG_PREFIX} Empty summary, falling back to Pi's default`);
        return;
      }

      ctx.ui.notify?.("Smart compaction complete", "info");
      ctx.ui.setStatus?.(STATUS_KEY, "✓ compacted");

      return {
        compaction: {
          summary,
          firstKeptEntryId,
          tokensBefore,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${LOG_PREFIX} Compaction failed: ${message}, falling back to Pi's default`);
      return;
    }
  });
}

function buildSummaryRequest(
  customPrompt: string,
  conversationText: string,
  previousSummary: string | undefined,
): string {
  const parts = [customPrompt];
  if (previousSummary) {
    parts.push(`\n<previous-summary>\n${previousSummary}\n</previous-summary>`);
  }
  parts.push(`\n<conversation>\n${conversationText}\n</conversation>`);
  return parts.join("\n");
}