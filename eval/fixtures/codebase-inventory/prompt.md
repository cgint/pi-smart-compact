Work only from the files in this workspace. Do not guess.

1. Read every file in `src/` and every file in `test/`.
2. Read `EVALUATION.md`, `findings/07-floor-as-code-not-prose.md`, and
   `concepts/compaction-principles.md`.
3. Run `ls -la` and `wc -l` over `src/` and `test/` so the sizes are on record.

Then produce a single final answer with exactly these three parts:

**A. Exported symbols.** Every exported function, type and constant in `src/`, with a
one-line description of what it does. Group by file.

**B. Test coverage map.** For each exported symbol in part A, name the test that covers it,
or write `UNCOVERED`.

**C. Three specific risks** you can point at with a `file:line` reference, each with the
exact quoted line that shows the problem.

Be precise. Every claim in part B and C must carry a `file:line` you actually read.
