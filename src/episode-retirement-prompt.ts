import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EPISODE_RETIREMENT_ENABLED_VAR } from "./episode-retirement.js";

const RETIRE_PROMPT_PATH = fileURLToPath(new URL("../prompts/retire.md", import.meta.url));

export default function registerRetirePrompt(pi: ExtensionAPI): void {
  if (process.env[EPISODE_RETIREMENT_ENABLED_VAR] !== "true") return;
  pi.on("resources_discover", () => ({ promptPaths: [RETIRE_PROMPT_PATH] }));
}
