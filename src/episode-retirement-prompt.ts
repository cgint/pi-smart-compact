import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RETIRE_PROMPT_PATH = fileURLToPath(new URL("../prompts/retire.md", import.meta.url));

/**
 * The `/retire` prompt template is always discoverable. It now guides the active agent to the
 * native-tree handoff path (native_tree_targets -> handoff_record -> explicit `/tree-handoff`),
 * not the removed episode-retirement creation tools. No env flag gates it.
 */
export default function registerRetirePrompt(pi: ExtensionAPI): void {
  pi.on("resources_discover", () => ({ promptPaths: [RETIRE_PROMPT_PATH] }));
}
