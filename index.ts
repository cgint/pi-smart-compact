import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
console.log("[pi-smart-compact] Module loaded, __dirname:", __dirname);

/**
 * Load the compaction prompt from the markdown file at startup.
 * This is the only configuration point — edit the markdown to change behavior.
 */
function loadPrompt(): string | null {
  const probePath = join(__dirname, "findings", "DRAFT_COMPACTION_PROMPT.md");
  try {
    const content = readFileSync(probePath, "utf-8");
    console.log("[pi-smart-compact] Prompt loaded at startup:", content.length, "chars");
    return content;
  } catch (err: any) {
    console.warn("[pi-smart-compact] Failed to load prompt:", err.message);
    return null;
  }
}

// Pi's default compaction prompts (from compaction.js)
const PI_DEFAULT_SYSTEM_PROMPT = "You are a context summarization assistant.";
const PI_DEFAULT_INITIAL_PROMPT = "The messages above are a conversation to summarize. Create a structured context checkpoint summary";
const PI_DEFAULT_UPDATE_PROMPT = "The messages above are NEW conversation messages to incorporate into the existing summary";
const PI_DEFAULT_TURN_PREFIX_PROMPT = "This is the PREFIX of a turn that was too large to keep";

/**
 * Detect if this request is a compaction summarization call by checking
 * for Pi's distinctive default prompt texts in the payload.
 */
function isCompactionRequest(payload: any): boolean {
  if (!payload || !payload.messages) return false;
  const text = JSON.stringify(payload);
  // Check for Pi's distinctive compaction prompt signatures
  return (
    text.includes(PI_DEFAULT_SYSTEM_PROMPT) ||
    text.includes(PI_DEFAULT_INITIAL_PROMPT) ||
    text.includes(PI_DEFAULT_UPDATE_PROMPT) ||
    text.includes(PI_DEFAULT_TURN_PREFIX_PROMPT)
  );
}

/**
 * Replace Pi's default compaction prompts with our custom prompt.
 * Handles both OpenAI-style (messages with role: "system") and
 * Anthropic-style (top-level system field) payloads.
 */
function swapCompactionPrompts(payload: any, customPrompt: string): any {
  // Clone to avoid mutating the original
  const modified = JSON.parse(JSON.stringify(payload));

  // --- Handle system prompt ---
  if (modified.system) {
    // Anthropic-style: top-level system field
    if (typeof modified.system === "string" && modified.system.includes(PI_DEFAULT_SYSTEM_PROMPT)) {
      modified.system = "You are a session compaction specialist. Produce only the structured output — no conversation, no commentary.";
    }
  } else if (Array.isArray(modified.messages)) {
    // OpenAI-style: system in messages array
    for (const msg of modified.messages) {
      if (msg.role === "system" && typeof msg.content === "string" && msg.content.includes(PI_DEFAULT_SYSTEM_PROMPT)) {
        msg.content = "You are a session compaction specialist. Produce only the structured output — no conversation, no commentary.";
        break;
      }
    }
  }

  // --- Handle user prompt (the main compaction template) ---
  if (Array.isArray(modified.messages)) {
    for (let i = 0; i < modified.messages.length; i++) {
      const msg = modified.messages[i];
      if (msg.role === "user" && typeof msg.content === "string") {
        // Check if this is a compaction prompt (contains one of Pi's default templates)
        if (
          msg.content.includes(PI_DEFAULT_INITIAL_PROMPT) ||
          msg.content.includes(PI_DEFAULT_UPDATE_PROMPT) ||
          msg.content.includes(PI_DEFAULT_TURN_PREFIX_PROMPT)
        ) {
          // Replace the compaction template with our custom prompt
          // Keep the conversation and previous-summary wrappers if present
          const convMatch = msg.content.match(/<conversation>[\s\S]*<\/conversation>/);
          const prevMatch = msg.content.match(/<previous-summary>[\s\S]*<\/previous-summary>/);
          
          let replacement = `<conversation>\n${convMatch ? convMatch[0] : ""}\n</conversation>`;
          if (prevMatch) {
            replacement += `\n\n${prevMatch[0]}`;
          }
          replacement += `\n\n${customPrompt}`;
          
          console.log("[pi-smart-compact] Swapped compaction prompt for turn");
          msg.content = replacement;
          break;
        }
      }
    }
  }

  return modified;
}

export default function register(pi: ExtensionAPI): void {
  try {
    console.log("[pi-smart-compact] register() called");

    const customPrompt = loadPrompt();
    if (!customPrompt) {
      console.warn("[pi-smart-compact] No prompt loaded, compaction interception disabled");
      return;
    }

    // Intercept compaction requests before they reach the LLM
    pi.on("before_provider_request", (event) => {
      if (!event.payload) return;

      if (isCompactionRequest(event.payload)) {
        console.log("[pi-smart-compact] Detected compaction request, swapping prompts");
        const swapped = swapCompactionPrompts(event.payload, customPrompt);
        console.log("[pi-smart-compact] Prompt swapped successfully");
        return swapped; // Return modified payload to Pi
      }
    });

    console.log("[pi-smart-compact] Registered before_provider_request handler");
  } catch (err) {
    console.error("[pi-smart-compact] register() crashed:", err);
  }
}