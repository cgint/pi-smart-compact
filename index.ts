import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerSmartCompact from "./src/smart-compact.js";
import registerEpisodeRetirement from "./src/episode-retirement.js";
import registerRetirePrompt from "./src/episode-retirement-prompt.js";

export default function register(pi: ExtensionAPI): void {
  registerSmartCompact(pi);
  registerEpisodeRetirement(pi);
  registerRetirePrompt(pi);
}
