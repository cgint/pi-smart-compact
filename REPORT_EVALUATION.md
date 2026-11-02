# Evaluation: prompt discovery and `/retire`

## Conclusion

**Do not add `"prompts": ["./prompts"]` (nor `"prompts": ["./prompts/retire.md"]`) to the package manifest.** Horst correctly found a real package-resolution asymmetry, but the proposed manifest fix would defeat the intentional default-off gate for episode retirement and would also accidentally surface the smart-compaction implementation prompt. The existing dynamic discovery design is the right architecture for `/retire`; the operational fix is to start Pi with `PI_EPISODE_RETIREMENT_ENABLED=true` and keep `index.ts` enabled.

## Evidence inspected

- Repository: `package.json`, `index.ts`, both files in `prompts/`, `src/smart-compact.ts`, `src/episode-retirement-prompt.ts`, `src/episode-retirement.ts`, README, OpenSpec artifacts, and prompt/retirement tests.
- Pi 0.85.1 installed package loader: `.../dist/core/package-manager.js`, especially `collectPackageResources()` and `collectDefaultResources()` (lines 1801–1881).
- Pi package/prompt/extension documentation.
- Historical project record: `findings/09-episode-retirement-v0.md`, section “Native /retire prompt”.

## Findings

### 1. Horst’s loader diagnosis is correct, including the filter-dependent result

The current manifest is present and declares only `extensions`. With **no package filter**, `collectPackageResources()` sees a manifest and calls `addManifestEntries()` for each resource type. For `prompts`, the missing manifest key means `undefined`, so no prompt path is added; conventional `prompts/` discovery is not reached.

With a package filter object, the loader instead visits each resource type separately. When `filter.prompts` is omitted, it calls `collectDefaultResources()`. That method sees that `manifest.prompts` is absent, then falls back to conventional `prompts/` discovery. Thus the observed “extension filtered off -> `/retire` appears” behavior is an accidental consequence of loader control flow, not intended feature enablement.

The package docs also make the broader rule explicit: a package may use a `pi` manifest **or** conventional directories. Once this package supplies a manifest, it must explicitly expose any always-on package resource it wants discovered in normal manifest mode.

### 2. `smart-compaction-prompt.md` is internal, not a user template

`src/smart-compact.ts` computes `PROMPT_PATH` as `prompts/smart-compaction-prompt.md` and reads it with `readFileSync()` in `loadPrompt()`. Its own comment calls that file “the single configuration point.” It is prompt material sent to the compaction model by `buildSummaryRequest()`, not an instruction intended as a normal user turn.

Consequently, `"prompts": ["./prompts"]` would incorrectly create `/smart-compaction-prompt`. Pi’s template contract derives a slash command directly from a Markdown filename. The command would expand this specialized compaction instruction into an ordinary user message—confusing at best and a prompt-exposure/UX defect at worst.

A specific manifest list such as `"prompts": ["./prompts/retire.md"]` avoids exposing the internal file, but it is still the wrong solution because it makes `/retire` unconditional (next finding). Moving the internal file to a non-conventional directory (for example `src/internal-prompts/`) would be structurally cleaner if this package later needs an **always-on** declarative template, but it does not solve the retirement gate and is unnecessary for the recommended design.

### 3. `/retire` was deliberately designed to be selectively discovered under the feature flag

This is not an inference alone; it is directly documented and tested:

- `src/episode-retirement-prompt.ts` returns before registering any event unless `PI_EPISODE_RETIREMENT_ENABLED === "true"`; when enabled it contributes exactly the absolute `prompts/retire.md` path through `resources_discover`.
- `test/episode-retirement-prompt.test.ts` asserts no registration for unset, `"1"`, `"TRUE"`, or `"false"`, and asserts exactly one path ending in `/prompts/retire.md`—explicitly not `smart-compaction-prompt.md`—for exact lowercase `"true"`.
- `findings/09-episode-retirement-v0.md` states: “`/retire ...` is feature-gated and selectively discovered as a native Pi prompt template.”
- The README says episode retirement is off by default, while describing `/retire` as its native template. It should be read as available after enabling the feature, though that prerequisite should be made clearer (see recommendation).

A `pi.prompts` declaration is static package discovery. It cannot honor this runtime environment decision. Therefore either directory-wide or a retire-only manifest declaration bypasses the gate: `/retire` will be offered even when the tools and retirement event hooks are absent. That produces a misleading command which expands to instructions for unavailable tools.

### 4. Why dynamic discovery can legitimately appear not to work

Pi documents that extensions are loaded before `resources_discover`, and that `resources_discover` fires on startup and reload. Therefore this registration pattern should expose `/retire` on every profile **when all of the following are true**:

1. `index.ts` is actually enabled and loaded;
2. the Pi process was launched with `PI_EPISODE_RETIREMENT_ENABLED=true` (exact casing/value); and
3. resource discovery runs after that extension registration, as in normal startup or `/reload`.

The partner/default state in the handoff had explicitly disabled `index.ts` through a package filter. In that state, dynamic discovery cannot run at all. The fact that `/retire` appeared anyway was the unrelated conventional-directory fallback described above.

Conversely, after reinstall cleared the filter, `index.ts` could load again, but `/retire` should remain absent if the exact flag was not in that already-running Pi process’s environment. Shell `export` performed after Pi starts does not alter Pi’s `process.env`; `/reload` reloads extensions/resources but cannot import a changed parent-shell environment. Pi must be quit and launched from an environment/profile launcher that sets the flag (or otherwise be started with the variable already supplied). This is the most likely explanation for an expected-but-missing command; it is not proven for the user’s particular invocation because I did not inspect their process environment or profile settings.

## Critique / overlooked points

1. **The initial proposed fix conflicts with a tested and documented product contract.** It repairs only the accidental discovery symptom while silently changing “default off” into “template always visible.”
2. **The two Markdown files intentionally have different discovery roles.** One is a dynamically exposed user template; one is a file-backed internal LLM instruction. Sharing `prompts/` is safe only because the manifest does not statically expose that directory. Adding it makes directory naming misleading.
3. **The observed prior profile behavior is not evidence that `/retire` was correctly enabled.** It occurred while the extension that registers its tools and guarded prompt was disabled. The template may have been visible while nonfunctional.
4. **Documentation ambiguity remains.** README’s “Use the native `/retire` prompt template” is located after explaining default-off retirement but does not repeat “after launching with the flag.” This is a UX/documentation issue, not a reason to change discovery semantics.
5. **Version scope:** the loader control-flow conclusion was verified against installed Pi 0.85.1. The repository’s dev dependency is `^0.84.2`; the relevant dynamic prompt feature is also documented in the installed Pi docs and is exercised by repository tests, but I did not execute a live 0.84.2/0.85.1 profile matrix.

## Recommendation

### Recommended architecture: retain guarded dynamic discovery; make enablement operationally explicit

1. **Leave `package.json.pi.prompts` absent.** Do not add a directory-wide or retire-only static prompt declaration.
2. **Keep `registerRetirePrompt()` as the sole `/retire` publisher.** It already correctly exposes only `retire.md` and only when `PI_EPISODE_RETIREMENT_ENABLED=true`.
3. **Ensure the package extension is enabled, not filtered out.** Do not use disabling `index.ts` as a means to manage the feature; it disables the retirement tools and its guarded template together.
4. **Launch the relevant Pi profile with the exact flag before process start**, then restart Pi. Verify `/retire` after startup (or a resource reload performed within that already-flagged process). A concise supported launch form is:
   ```bash
   PI_EPISODE_RETIREMENT_ENABLED=true pi
   ```
   The actual profile launcher should set the same environment variable before invoking `pi`.
5. **At the subsequent agreed implementation/documentation phase**, clarify README configuration with a dedicated `/retire` subsection stating that the template is available only after that environment flag is set and Pi is started/restarted. Add an integration-level regression test if the project has a suitable Pi resource-discovery harness: flag off yields no `/retire`; flag on yields `/retire` only; the internal file never becomes a template.

### Optional future structural cleanup

If a future requirement introduces an always-on package prompt, move `smart-compaction-prompt.md` from conventional `prompts/` to an explicitly internal location such as `src/internal-prompts/` (and update `PROMPT_PATH` plus package publish files as necessary). Then use an explicit manifest list only for truly unconditional user templates. Do not do this merely to repair today’s symptom: it adds churn without improving the current guarded design.

## Verification status

- Static source, project tests, Pi docs, and installed Pi 0.85.1 loader implementation: inspected.
- `npm test`: **not run successfully**; it failed before tests started because `vitest` is not installed/available (`sh: vitest: command not found`, exit 127). No dependency installation or source modification was performed because the handoff permits only this report write.
- Live profile/process-environment reproduction: **not performed**. It is the remaining check needed to distinguish missing startup environment from a separate runtime loading issue.
