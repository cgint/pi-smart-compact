#!/usr/bin/env python3
"""
inspect.py — lay out what a parcour campaign produced, for a human to read.

This is a FINDER, not a scorer (EVALUATION.md §3a). It surfaces artifacts and counts.
It does not judge quality, and nothing it prints is evidence of benefit — there is no
verifier in this rung.

Usage:
  eval/inspect.py <campaign-id> [--pairs N]
"""

import json
import re
import sys
from pathlib import Path

RUNS = Path("/tmp")


def load_session(root: Path):
    files = sorted(root.glob("sessions/**/*.jsonl"))
    if not files:
        return []
    return [json.loads(line) for line in files[-1].read_text().splitlines() if line.strip()]


def tally(entries):
    """Mechanical counts only. Every number here is derived, none is judged."""
    t = {
        "assistant_turns": 0, "tool_results": 0, "tool_errors": 0,
        "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0,
        "cost": 0.0, "peak_input": 0, "tool_calls": [],
    }
    for e in entries:
        m = e.get("message") or {}
        role = m.get("role")
        if role == "assistant":
            t["assistant_turns"] += 1
            u = m.get("usage") or {}
            for k in ("input", "output", "cacheRead", "cacheWrite"):
                t[k] += u.get(k, 0) or 0
            t["total"] += u.get("totalTokens", 0) or 0
            t["peak_input"] = max(t["peak_input"], u.get("input", 0) or 0)
            c = u.get("cost") or {}
            t["cost"] += c.get("total", 0) or 0
            for block in m.get("content") or []:
                if isinstance(block, dict) and block.get("type") in ("toolCall", "tool_use"):
                    name = block.get("name") or block.get("toolName") or "?"
                    args = block.get("input") or block.get("arguments") or {}
                    t["tool_calls"].append((name, json.dumps(args, sort_keys=True)[:200]))
        elif role == "toolResult":
            t["tool_results"] += 1
            if m.get("isError"):
                t["tool_errors"] += 1
    return t


def repeats(tool_calls):
    """Same tool, same arguments, more than once — a candidate re-read, not a verdict."""
    seen, dupes = {}, []
    for name, args in tool_calls:
        key = (name, args)
        seen[key] = seen.get(key, 0) + 1
        if seen[key] == 2:
            dupes.append(key)
    return dupes


def reductions(root: Path):
    audit = root / "turn-reduce-audit"
    if not audit.is_dir():
        return None
    logs = list(audit.glob("*/_requests.log"))
    entries, verdicts = [], {}
    for log in logs:
        for line in log.read_text().splitlines():
            for tool, before, after, pct in re.findall(
                r"(\w+):(\d+)→(\d+)\((\d+)%\)", line
            ):
                entries.append((tool, int(before), int(after), int(pct)))
            for v in re.findall(r"=(\w[\w-]*)\(", line):
                verdicts[v] = verdicts.get(v, 0) + 1
    pairs = []
    for orig in audit.glob("*/*.original.txt"):
        rid = orig.name.replace(".original.txt", "")
        md = next((p for p in orig.parent.glob(f"*__{rid}.md")), None)
        pairs.append((orig, md))
    return {"gains": entries, "verdicts": verdicts, "pairs": pairs}


def main():
    campaign = sys.argv[1]
    npairs = int(sys.argv[sys.argv.index("--pairs") + 1]) if "--pairs" in sys.argv else 3

    roots = sorted(RUNS.glob(f"parcour-{campaign}-*"))
    if not roots:
        sys.exit(f"no runs found for campaign {campaign}")

    print(f"# Parcour inspection — {campaign}\n")
    print("> Finder output. Counts are mechanical; nothing here is a quality judgement,")
    print("> and nothing here is evidence of benefit (no verifier in this rung).\n")

    stats = {}
    for root in roots:
        man = json.loads((root / "manifest.json").read_text())
        arm = man["arm"]
        t = tally(load_session(root))
        stats[arm] = t
        print(f"## Arm `{arm}` — `{man['run_id']}`\n")
        print(f"- env: `{' '.join(man['arm_env']) or '(none)'}`")
        print(f"- assistant turns: **{t['assistant_turns']}**, "
              f"tool results: {t['tool_results']}, errors: {t['tool_errors']}")
        print(f"- tokens: input {t['input']:,} · output {t['output']:,} · "
              f"cacheRead {t['cacheRead']:,} · cacheWrite {t['cacheWrite']:,}")
        print(f"- **total billed {t['total']:,}**, cost {t['cost']:.4f}, "
              f"peak single-request input {t['peak_input']:,}")
        rep = repeats(t["tool_calls"])
        print(f"- repeated identical tool calls: {len(rep)}"
              + ("".join(f"\n    - `{n}` {a[:90]}" for n, a in rep[:5]) if rep else ""))
        answer = root / "final-answer.txt"
        if answer.exists():
            print(f"- final answer: {len(answer.read_text()):,} chars → `{answer}`")
        print()

    if "on" in stats and "off" in stats:
        on, off = stats["on"], stats["off"]
        print("## Side by side\n")
        print("| | off | on | delta |")
        print("|---|---|---|---|")
        for label, key in [("assistant turns", "assistant_turns"),
                           ("tool results", "tool_results"),
                           ("tool errors", "tool_errors"),
                           ("total billed tokens", "total"),
                           ("cacheWrite", "cacheWrite"),
                           ("peak input", "peak_input")]:
            a, b = off[key], on[key]
            d = f"{b - a:+,}" + (f" ({(b - a) / a * 100:+.0f}%)" if a else "")
            print(f"| {label} | {a:,} | {b:,} | {d} |")
        print("\n**n=1 per arm. These deltas are anecdote, not measurement.**")
        print("Agent runs are nondeterministic; the two arms diverge on the first "
              "differing choice. Read them as 'what happened', never as 'the effect'.\n")

    for root in roots:
        r = reductions(root)
        if not r or not r["gains"]:
            continue
        print(f"## What the reducer actually did — `{root.name}`\n")
        print(f"- verdicts: {r['verdicts'] or '(none logged)'}")
        print(f"- {len(r['gains'])} reductions:\n")
        print("| tool | before | after | cut |")
        print("|---|---|---|---|")
        for tool, b, a, pct in sorted(r["gains"], key=lambda x: -x[1]):
            print(f"| {tool} | {b:,} | {a:,} | {pct}% |")
        print(f"\n### Read these pairs yourself (top {npairs} by original size)\n")
        biggest = sorted(r["pairs"], key=lambda p: p[0].stat().st_size, reverse=True)
        for orig, md in biggest[:npairs]:
            print(f"- original `{orig}` ({orig.stat().st_size:,} bytes)")
            print(f"  excerpt  `{md}`" if md else "  excerpt  (not found)")
        print()


if __name__ == "__main__":
    main()
