#!/usr/bin/env python3
"""
Compaction Test Harness

Runs different compaction strategies against session files, calls the LLM,
scores the outputs, and produces a comparison report.

Usage:
  python3 compaction_test_harness.py --workspace pi-smart-compact
  python3 compaction_test_harness.py --sessions <id_fragment>
  python3 compaction_test_harness.py --strategies pi smart
  python3 compaction_test_harness.py --dry-run
  python3 compaction_test_harness.py --skip-llm   # Just generate prompts, no LLM call

Config (env vars):
  COMPACT_MODEL_URL=http://sparky:8001/v1/chat/completions
  COMPACT_MODEL_ID=qwen36-35b-nvidia-nvfp4
  COMPACT_MAX_TOKENS=4096
"""

import json
import sys
import os
import urllib.request
from pathlib import Path
from dataclasses import dataclass, field

# Config
BASE_DIR = Path(__file__).parent.parent
SESSIONS_DIR = Path(os.environ.get("PI_SESSIONS_DIR", "/Users/cgint/.pi/agent/sessions"))
OUTPUT_DIR = BASE_DIR / "agent" / "compaction_results"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MODEL_URL = os.environ.get("COMPACT_MODEL_URL", "http://sparky:8001/v1/chat/completions")
MODEL_ID = os.environ.get("COMPACT_MODEL_ID", "qwen36-35b-nvidia-nvfp4")
RESERVE_TOKENS = int(os.environ.get("COMPACT_RESERVE_TOKENS", "16384"))  # Pi default
MODEL_MAX_TOKENS = int(os.environ.get("COMPACT_MODEL_MAX_TOKENS", "32768"))  # sparky default

def calc_max_tokens():
    """Pi's formula: min(0.8 * reserveTokens, model.maxTokens)."""
    return min(int(0.8 * RESERVE_TOKENS), MODEL_MAX_TOKENS)


# ============================================================
# Session I/O
# ============================================================

def discover_sessions(workspace_filter=None):
    sessions = []
    if not SESSIONS_DIR.exists():
        print(f"WARNING: Sessions dir not found: {SESSIONS_DIR}", file=sys.stderr)
        return sessions
    for ws_dir in sorted(SESSIONS_DIR.iterdir()):
        if not ws_dir.is_dir():
            continue
        if workspace_filter and workspace_filter not in ws_dir.name:
            continue
        for f in sorted(ws_dir.glob("*.jsonl")):
            sessions.append({"path": str(f), "workspace": ws_dir.name, "filename": f.name})
    return sessions


def load_session(path):
    messages = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") != "message":
                continue
            inner = obj.get("message", {})
            role = inner.get("role", "")
            if role in ("user", "assistant", "toolResult"):
                messages.append({"role": role, "content": inner.get("content", "")})
    return messages


def serialize_conversation(messages):
    parts = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "user":
            if isinstance(content, list):
                content = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
            if content:
                parts.append(f"[User]: {content}")
        elif role == "assistant":
            if isinstance(content, list):
                text = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
                if text:
                    parts.append(f"[Assistant]: {text}")
        elif role == "toolResult":
            if isinstance(content, list):
                content = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
            if content:
                parts.append(f"[Tool result]: {content[:2000]}")
    return "\n\n".join(parts)


def extract_file_ops(messages):
    """Extract file operations from assistant tool calls (matching Pi's extractFileOpsFromMessage)."""
    read_files = []
    modified_files = []
    for msg in messages:
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "toolCall":
                continue
            name = block.get("name", "")
            args = block.get("arguments", {})
            if not args:
                continue
            path = args.get("path", "")
            if not path:
                continue
            if name == "read":
                if path not in read_files:
                    read_files.append(path)
            elif name in ("write", "edit"):
                if path not in modified_files:
                    modified_files.append(path)
    return read_files, modified_files


def format_file_operations(read_files, modified_files):
    """Format file operations exactly like Pi's formatFileOperations."""
    sections = []
    if read_files:
        sections.append(f"<read-files>\n{chr(10).join(read_files)}\n</read-files>")
    if modified_files:
        sections.append(f"<modified-files>\n{chr(10).join(modified_files)}\n</modified-files>")
    if not sections:
        return ""
    return "\n\n" + "\n\n".join(sections)


# ============================================================
# Prompts
# ============================================================

def get_pi_prompt(serialized):
    """Pi's actual initial summarization prompt (from compaction.js)."""
    return (
        "You are a context summarization assistant. Your task is to read a conversation "
        "between a user and an AI assistant, then produce a structured summary following "
        "the exact format specified.\n\n"
        "Do NOT continue the conversation. Do NOT respond to any questions in the conversation. "
        "ONLY output the structured summary.\n\n"
        "The messages above are a conversation to summarize. Create a structured context "
        "checkpoint summary that another LLM will use to continue the work.\n\n"
        "Use this EXACT format:\n\n"
        "## Goal\n"
        "[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]\n\n"
        "## Constraints & Preferences\n"
        "- [Any constraints, preferences, or requirements mentioned by user]\n"
        "- [(none) if none were mentioned]\n\n"
        "## Progress\n"
        "### Done\n"
        "- [x] [Completed tasks/changes]\n\n"
        "### In Progress\n"
        "- [ ] [Current work]\n\n"
        "### Blocked\n"
        "- [Issues preventing progress, if any]\n\n"
        "## Key Decisions\n"
        "- **[Decision]**: [Brief rationale]\n\n"
        "## Next Steps\n"
        "1. [Ordered list of what should happen next]\n\n"
        "## Critical Context\n"
        "- [Any data, examples, or references needed to continue]\n"
        "- [(none) if not applicable]\n\n"
        "Keep each section concise. Preserve exact file paths, function names, and error messages.\n\n"
        f"<conversation>\n{serialized}\n</conversation>"
    )


def get_smart_prompt(serialized, previous_summary=None):
    prompt = (
        "You are a session compaction specialist.\n\n"
        "RULES:\n"
        "1. Summarize what was ACTUALLY DISCUSSED and DONE — NOT file contents.\n"
        "2. Preserve decisions with rationale.\n"
        "3. Preserve unresolved blockers.\n"
        "4. Preserve key file operations with exact paths.\n"
        "5. Do NOT continue the conversation. ONLY output the structured summary.\n"
        "6. If the session contains only file reading with no discussion, summarize what "
        "was read and the agent's observations — do NOT invent decisions.\n\n"
        "OUTPUT FORMAT:\n\n"
        "## What Was Done\n[Brief description]\n\n"
        "## Key Findings / Observations\n[Insights]\n\n"
        "## Key Decisions\n- **[Decision]**: [Rationale]\n\n"
        "## Current State\n[Where things stand]\n\n"
        "## Next Steps\n1. [What should happen next]\n\n"
        "## File Operations\n[Files read/written]\n\n"
        "Be concise. Skip empty sections.\n\n"
        f"<conversation>\n{serialized}\n</conversation>"
    )
    if previous_summary:
        prompt += f"\n\n<previous-summary>\n{previous_summary}\n</previous-summary>"
    return prompt


def get_minimal_prompt(serialized):
    return (
        "Summarize this conversation in 3-5 bullet points. Focus ONLY on:\n"
        "- What the user asked\n"
        "- What the assistant did\n"
        "- Key results or findings\n"
        "- What comes next\n\n"
        "If nothing substantial happened, say so briefly.\n\n"
        f"<conversation>\n{serialized}\n</conversation>"
    )


STRATEGIES = {
    "pi": {"prompt": get_pi_prompt, "append_file_ops": True},
    "smart": {"prompt": get_smart_prompt, "append_file_ops": False},
    "minimal": {"prompt": get_minimal_prompt, "append_file_ops": False},
}


# ============================================================
# LLM Call
# ============================================================

def call_llm(prompt_text, max_tokens=None):
    if max_tokens is None:
        max_tokens = calc_max_tokens()
    payload = json.dumps({
        "model": MODEL_ID,
        "messages": [{"role": "user", "content": prompt_text}],
        "max_tokens": max_tokens,
    }).encode("utf-8")
    req = urllib.request.Request(MODEL_URL, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


# ============================================================
# Scoring
# ============================================================

@dataclass
class Scorecard:
    strategy: str
    summary_length: int
    word_count: int
    has_structure: bool
    has_decisions: bool
    has_next_steps: bool
    has_file_ops: bool
    sections_found: list = field(default_factory=list)


def score_summary(summary):
    words = summary.strip().split()
    lines = summary.strip().split("\n")
    sections = [l.strip().lstrip("# ").strip() for l in lines if l.strip().startswith("##")]
    return Scorecard(
        strategy="",
        summary_length=len(summary),
        word_count=len(words),
        has_structure=bool(sections),
        has_decisions=any("decision" in l.lower() for l in lines if "##" in l),
        has_next_steps=any("next" in l.lower() for l in lines if "##" in l),
        has_file_ops=any("file" in l.lower() for l in lines if "##" in l),
        sections_found=sections,
    )


# ============================================================
# Main Loop
# ============================================================

def run():
    import argparse
    parser = argparse.ArgumentParser(description="Compaction Test Harness")
    parser.add_argument("--sessions", nargs="+", help="Filter sessions by name fragment")
    parser.add_argument("--strategies", nargs="+", choices=list(STRATEGIES.keys()))
    parser.add_argument("--workspace", help="Filter by workspace name")
    parser.add_argument("--dry-run", action="store_true", help="Just list sessions")
    parser.add_argument("--skip-llm", action="store_true", help="Generate prompts only, no LLM call")
    args = parser.parse_args()

    sessions = discover_sessions(args.workspace)
    strategies = args.strategies or list(STRATEGIES.keys())
    print(f"Discovered {len(sessions)} sessions, strategies: {', '.join(strategies)}")

    if args.dry_run:
        for s in sessions:
            print(f"  {s['filename']} ({s['workspace']})")
        return

    all_results = {}

    for sess in sessions:
        if args.sessions:
            if not any(f in sess["filename"] for f in args.sessions):
                continue

        sid = sess["filename"].replace(".jsonl", "")
        sess_out = OUTPUT_DIR / sid
        sess_out.mkdir(parents=True, exist_ok=True)

        print(f"\n{'='*60}")
        print(f"Session: {sid}")

        try:
            messages = load_session(sess["path"])
        except Exception as e:
            print(f"  ERROR: {e}", file=sys.stderr)
            continue

        if len(messages) < 2:
            print(f"  SKIP: too few messages ({len(messages)})")
            continue

        split = int(len(messages) * 0.7)
        messages_to_compact = messages[:split]
        serialized = serialize_conversation(messages_to_compact)
        remaining = serialize_conversation(messages[split:])

        # Extract file operations (like Pi does)
        read_files, modified_files = extract_file_ops(messages_to_compact)
        file_ops_suffix = format_file_operations(read_files, modified_files)

        # Save conversation and remaining for reference
        (sess_out / "conversation.txt").write_text(serialized, encoding="utf-8")
        (sess_out / "remaining.txt").write_text(remaining, encoding="utf-8")

        sess_results = {}

        for strat in strategies:
            strat_cfg = STRATEGIES[strat]
            prompt_fn = strat_cfg["prompt"]
            append_ops = strat_cfg.get("append_file_ops", False)
            print(f"  [{strat}] ", end="")
            prompt = prompt_fn(serialized)

            # Save prompt
            (sess_out / f"prompt_{strat}.txt").write_text(prompt, encoding="utf-8")

            if args.skip_llm:
                print("SKIPPED (prompts written)")
                sess_results[strat] = {"summary": "", "scorecard": Scorecard(
                    strategy=strat, summary_length=0, word_count=0,
                    has_structure=False, has_decisions=False, has_next_steps=False,
                    has_file_ops=False, sections_found=[]
                )}
                continue

            try:
                summary = call_llm(prompt)
                # Append file operations only if the strategy opts in
                if append_ops and file_ops_suffix:
                    summary += file_ops_suffix
                (sess_out / f"summary_{strat}.txt").write_text(summary, encoding="utf-8")
                sc = score_summary(summary)
                sc.strategy = strat
                print(f"OK ({sc.summary_length} chars, {sc.word_count} words)")
                sess_results[strat] = {"summary": summary, "scorecard": sc}
            except Exception as e:
                print(f"ERROR: {e}", file=sys.stderr)

        all_results[sid] = sess_results

    # Report
    report = {}
    for sid, sr in all_results.items():
        report[sid] = {}
        for strat, data in sr.items():
            sc = data["scorecard"]
            report[sid][strat] = {
                "chars": sc.summary_length,
                "words": sc.word_count,
                "structured": sc.has_structure,
                "decisions": sc.has_decisions,
                "next_steps": sc.has_next_steps,
                "file_ops": sc.has_file_ops,
                "sections": sc.sections_found,
            }

    report_path = OUTPUT_DIR / "report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    # Print table
    print(f"\n{'='*80}")
    print(f"{'Session':<50} {'Strategy':<10} {'Chars':<8} {'Words':<8} {'Structured':<12}")
    print("-" * 88)
    for sid, sr in all_results.items():
        short_id = sid[:48]
        for strat, data in sr.items():
            sc = data["scorecard"]
            print(f"{short_id:<50} {strat:<10} {sc.summary_length:<8} {sc.word_count:<8} {str(sc.has_structure):<12}")

    print(f"\nReport: {report_path}")
    print(f"Sessions: {OUTPUT_DIR}/")


if __name__ == "__main__":
    run()