import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { complete } from "@earendil-works/pi-ai/compat";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load the compaction prompt from the markdown file at startup.
 * This is the only configuration point — edit the markdown to change behavior.
 */
function loadPrompt(): string | null {
  const probePath = join(__dirname, "findings", "DRAFT_COMPACTION_PROMPT.md");
  try {
    const content = readFileSync(probePath, "utf-8");
    return content;
  } catch (err: any) {
    console.warn("[pi-smart-compact] Failed to load prompt:", err.message);
    return null;
  }
}

export default function register(pi: ExtensionAPI): void {
  try {
    const customPrompt = loadPrompt();
    if (!customPrompt) {
      console.warn("[pi-smart-compact] No prompt loaded, compaction interception disabled");
      return;
    }

    pi.on("session_before_compact", async (event, ctx) => {
      const { preparation, signal } = event;
      const { messagesToSummarize, turnPrefixMessages, firstKeptEntryId, previousSummary, tokensBefore } = preparation;

      // Get the session's current model from ctx
      const model = ctx.model;
      if (!model) {
        console.warn("[pi-smart-compact] No current model available, falling back to Pi's default");
        return;
      }

      // Resolve auth via Pi's model registry (handles models.json, env vars, etc.)
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        console.warn("[pi-smart-compact] Auth resolution failed:", auth.error || "unknown error", "falling back");
        return;
      }
      if (!auth.apiKey && model.provider !== "8001-twins" && model.provider !== "8001-sparky") {
        console.warn("[pi-smart-compact] No API key for provider:", model.provider, "falling back");
        return;
      }

      // Combine all messages for summarization
      const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
      if (allMessages.length === 0) {
        return;
      }

      // Convert messages to LLM format and serialize
      const llmMessages = convertToLlm(allMessages);
      const conversationText = serializeConversation(llmMessages);

      // Build the summary request
      const summaryMessages = [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: `You are a conversation summarizer. Create a comprehensive summary of this conversation that captures:

1. The main goals and objectives discussed
2. Key decisions made and their rationale
3. Important code changes, file modifications, or technical details
4. Current state of any ongoing work
5. Any blockers, issues, or open questions
6. Next steps that were planned or suggested

Be thorough but concise. The summary will replace the ENTIRE conversation history, so include all information needed to continue the work effectively.

Format the summary as structured markdown with clear sections.

${previousSummary ? `Previous session summary for context:\n${previousSummary}` : ""}

<conversation>
${conversationText}
</conversation>

---

${customPrompt}`,
            },
          ],
          timestamp: Date.now(),
        },
      ];

      try {
        const response = await complete(
          model,
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
          console.warn("[pi-smart-compact] Summary was empty, falling back to Pi's default");
          return;
        }

        return {
          compaction: {
            summary,
            firstKeptEntryId,
            tokensBefore,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[pi-smart-compact] Compaction failed:", message, "falling back to Pi's default");
        return;
      }
    });
  } catch (err) {
    console.error("[pi-smart-compact] register() crashed:", err);
  }
}