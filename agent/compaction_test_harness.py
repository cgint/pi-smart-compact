#!/usr/bin/env python3
"""
Compaction Test Harness

Runs different compaction strategies against session files and compares outputs.

Usage:
  python3 compaction_test_harness.py                          # Run all sessions, all strategies
  python3 compaction_test_harness.py --sessions <ids>         # Specific sessions
  python3 compaction_test_harness.py --strategies pi smart    # Specific strategies
  python3 compaction_test_harness.py --compare                # Show comparison view
  python3 compaction_test_harness.py --dry-run                # Just list sessions

Strategies:
  pi          - Pi's built-in compaction (baseline)
  smart       - Our custom compaction prompt (structured output)
  minimal     - Minimal summary (just what was done)
"""

import json
import sys
import os
from pathlib import Path
from dataclasses import dataclass, field

# Configuration
BASE_DIR = Path(__file__).parent.parent
SESSIONS_DIR = Path(os.environ.get("PI_SESSIONS_DIR",
    "/Users/cgint/.pi/agent/sessions"))
OUTPUT_DIR = BASE_DIR / "agent" / "compaction_results"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def discover_sessions(workspace_filter=None):
    """Discover all JSONL sessions, optionally filtered by workspace."""
    sessions = []
    if not SESSIONS_DIR.exists():
        print(f"WARNING: Sessions directory not found: {SESSIONS_DIR}", file=sys.stderr)
        return sessions

    for ws_dir in sorted(SESSIONS_DIR.iterdir()):
        if not ws_dir.is_dir():
            continue
        if workspace_filter and workspace_filter not in ws_dir.name:
            continue
        for f in sorted(ws_dir.glob("*.jsonl")):
            sessions.append({
                "path": str(f),
                "workspace": ws_dir.name,
                "filename": f.name,
            })
    return sessions


def load_session(path):
    """Load JSONL session (Pi v0.80+ event-stream format) and return message list."""
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
                messages.append({
                    "role": role,
                    "content": inner.get("content", ""),
                    "timestamp": obj.get("timestamp", ""),
                    "id": obj.get("id", ""),
                })

    return messages


def serialize_conversation(messages):
    """Serialize messages to Pi-like text format."""
    parts = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")

        if role == "user":
            if isinstance(content, list):
                content = " ".join(
                    b.get("text", "") for b in content if b.get("type") == "text"
                )
            if content:
                parts.append(f"[User]: {content}")

        elif role == "assistant":
            text_parts = []
            thinking_parts = []
            tool_calls = []
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        bt = block.get("type", "")
                        if bt == "text":
                            text_parts.append(block.get("text", ""))
                        elif bt == "thinking":
                            thinking_parts.append(block.get("thinking", ""))
                        elif bt == "toolCall":
                            args = block.get("arguments", {})
                            args_str = ", ".join(f"{k}={json.dumps(v)}" for k, v in args.items())
                            tool_calls.append(f"{block.get('name', '')}({args_str})")
            if thinking_parts:
                parts.append(f"[Assistant thinking]: {' '.join(thinking_parts)}")
            if text_parts:
                parts.append(f"[Assistant]: {' '.join(text_parts)}")
            if tool_calls:
                parts.append(f"[Assistant tool calls]: {'; '.join(tool_calls)}")

        elif role == "toolResult":
            if isinstance(content, list):
                content = " ".join(
                    b.get("text", "") for b in content if b.get("type") == "text"
                )
            if content:
                content = content[:2000]
                parts.append(f"[Tool result]: {content}")

    return "\n\n".join(parts)


def get_pi_compaction_prompt(messages_serialized, previous_summary=None):
    """Pi's default compaction prompt (baseline)."""
    return (
        "You are a context summarization assistant.\n\n"
        "The messages above are a conversation to summarize. "
        "Create a structured context checkpoint summary that another LLM will use to continue the work.\n\n"
        "Keep it concise. Focus on what was done, what remains, and any key context.\n\n"
        f"<conversation>\n{messages_serialized}\n</conversation>"
    )


def get_smart_compaction_prompt(messages_serialized, previous_summary=None):
    """Our custom compaction prompt (structured output)."""
    system_prompt = (
        "You are a session compaction specialist. Your task is to read a conversation "
        "between a user and an AI assistant, then produce a structured continuation context "
        "that enables another agent to pick up exactly where the work left off.\n\n"
        "RULES:\n"
        "1. Summarize what was ACTUALLY DISCUSSED and DONE in the conversation — "
        "NOT the content of files that were read.\n"
        "2. Preserve decisions with their rationale and evidence references.\n"
        "3. Preserve unresolved blockers and uncertainty.\n"
        "4. Preserve key file operations (read/write/edit) with exact paths.\n"
        "5. Preserve the last ~20K tokens of conversation verbatim.\n"
        "6. Remove: stale planning chatter, repeated explanations, low-value tool narration.\n"
        "7. Do NOT continue the conversation. Do NOT respond to questions. "
        "ONLY output the structured summary below.\n"
        "8. If the session contains only file reading with no discussion, summarize what "
        "was read and the agent's observations — do NOT invent decisions or goals that weren't discussed.\n\n"
        "OUTPUT FORMAT:\n\n"
        "## What Was Done\n"
        "[Brief description of actions taken in this session]\n\n"
        "## Key Findings / Observations\n"
        "[Any insights discovered during the session]\n\n"
        "## Key Decisions\n"
        "- **[Decision]**: [Rationale]\n"
        "- (or \"None\" if no decisions were made)\n\n"
        "## Current State\n"
        "[Where things stand]\n\n"
        "## Next Steps\n"
        "1. [What should happen next]\n"
        "- (or \"None\" if the session is complete)\n\n"
        "## File Operations\n"
        "[Files read/written with paths]\n\n"
        "## Critical Context\n"
        "[Any data, examples, or references needed to continue]\n"
        "- (or \"None\" if not applicable)\n\n"
        "Be concise. Use bullet points. Skip sections that are empty."
    )

    prompt = f"{system_prompt}\n\n"
    prompt += f"<conversation>\n{messages_serialized}\n</conversation>\n\n"

    if previous_summary:
        prompt += f"<previous-summary>\n{previous_summary}\n</previous-summary>\n\n"

    return prompt


def get_minimal_compaction_prompt(messages_serialized, previous_summary=None):
    """Minimal summary — just what was done."""
    return (
        "Summarize this conversation in 3-5 bullet points. Focus ONLY on:\n"
        "- What the user asked\n"
        "- What the assistant did\n"
        "- Key results or findings\n"
        "- What comes next\n\n"
        "If nothing substantial happened, say so briefly.\n\n"
        f"<conversation>\n{messages_serialized}\n</conversation>"
    )


STRATEGIES = {
    "pi": get_pi_compaction_prompt,
    "smart": get_smart_compaction_prompt,
    "minimal": get_minimal_compaction_prompt,
}


@dataclass
class Scorecard:
    strategy: str
    summary_length: int
    word_count: int
    has_structure: bool
    has_decisions: bool
    has_next_steps: bool
    has_file_ops: bool
    has_actionable_items: bool
    sections_found: list = field(default_factory=list)


def run_compaction_for_strategy(strategy_name, messages, previous_summary=None):
    """Run a compaction strategy and return (summary, scorecard)."""
    splitter = int(len(messages) * 0.7)
    messages_to_compact = messages[:splitter]
    remaining = messages[splitter:]

    serialized = serialize_conversation(messages_to_compact)
    prompt_fn = STRATEGIES.get(strategy_name)
    if not prompt_fn:
        raise ValueError(f"Unknown strategy: {strategy_name}")

    prompt = prompt_fn(serialized, previous_summary)

    prompt_path = OUTPUT_DIR / f"prompt_{strategy_name}.txt"
    with open(prompt_path, "w", encoding="utf-8") as f:
        f.write(prompt)

    conv_path = OUTPUT_DIR / f"conversation_{strategy_name}.txt"
    with open(conv_path, "w", encoding="utf-8") as f:
        f.write(serialized)

    remaining_path = OUTPUT_DIR / f"remaining_{strategy_name}.txt"
    with open(remaining_path, "w", encoding="utf-8") as f:
        f.write(serialize_conversation(remaining))

    scorecard = Scorecard(
        strategy=strategy_name,
        summary_length=0,
        word_count=0,
        has_structure=False,
        has_decisions=False,
        has_next_steps=False,
        has_file_ops=False,
        has_actionable_items=False,
        sections_found=[],
    )

    return ("[LLM CALL REQUIRED — see OUTPUT_DIR]", scorecard)


def run_all_sessions(sessions, strategies=None, session_filters=None):
    """Run compaction tests on all (filtered) sessions."""
    if strategies is None:
        strategies = list(STRATEGIES.keys())

    results = {}
    for sess in sessions:
        if session_filters:
            matches = any(f in sess["filename"] or f in sess["path"] for f in session_filters)
            if not matches:
                continue

        print(f"\n{'='*60}")
        print(f"Testing: {sess['filename']}")
        print(f"Workspace: {sess['workspace']}")

        try:
            messages = load_session(sess["path"])
        except Exception as e:
            print(f"  ERROR loading session: {e}", file=sys.stderr)
            continue

        print(f"  Messages: {len(messages)}")

        if len(messages) < 2:
            print(f"  SKIP: Too few messages")
            continue

        sess_results = {}
        for strategy in strategies:
            print(f"  Running '{strategy}' strategy... ", end="")
            try:
                summary, scorecard = run_compaction_for_strategy(strategy, messages)
                sess_results[strategy] = {
                    "scorecard": scorecard,
                    "message_count": len(messages),
                    "split_point": int(len(messages) * 0.7),
                    "summary_preview": summary[:200],
                }
                print("OK (prompt written)")
            except Exception as e:
                print(f"ERROR: {e}", file=sys.stderr)

        results[sess["filename"]] = sess_results

    return results


def print_comparison_table(results):
    """Print a comparison table of all strategies."""
    print("\n" + "=" * 80)
    print("COMPARISON TABLE")
    print("=" * 80)

    for filename, strategies in results.items():
        print(f"\n### {filename}")
        print("-" * 40)
        for strategy, data in strategies.items():
            sc = data["scorecard"]
            print(f"  [{strategy}]")
            print(f"    Length: {sc.summary_length} chars, {sc.word_count} words")
            print(f"    Sections: {', '.join(sc.sections_found) or '(none)'}")
            preview = data["summary_preview"]
            print(f"    Preview: {preview[:100]}...")


def save_report(results):
    """Save results as JSON."""
    report_path = OUTPUT_DIR / "report.json"
    serializable = {}
    for filename, strategies in results.items():
        serializable[filename] = {}
        for strategy, data in strategies.items():
            sc = data["scorecard"]
            serializable[filename][strategy] = {
                "length": sc.summary_length,
                "words": sc.word_count,
                "has_structure": sc.has_structure,
                "has_decisions": sc.has_decisions,
                "has_next_steps": sc.has_next_steps,
                "has_file_ops": sc.has_file_ops,
                "has_actionable": sc.has_actionable_items,
                "sections": sc.sections_found,
                "preview": data["summary_preview"],
            }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(serializable, f, indent=2, ensure_ascii=False)
    print(f"\nReport saved to: {report_path}")


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Compaction Test Harness")
    parser.add_argument("--sessions", nargs="+", help="Filter sessions by name")
    parser.add_argument("--strategies", nargs="+", choices=list(STRATEGIES.keys()),
                        help="Which strategies to test")
    parser.add_argument("--compare", action="store_true", help="Show comparison view")
    parser.add_argument("--workspace", help="Filter by workspace name")
    parser.add_argument("--dry-run", action="store_true", help="Just list sessions, don't run")
    args = parser.parse_args()

    sessions = discover_sessions(args.workspace)
    print(f"Discovered {len(sessions)} sessions")

    if args.dry_run:
        for s in sessions:
            print(f"  {s['filename']} ({s['workspace']})")
        return

    strategies = args.strategies or list(STRATEGIES.keys())
    print(f"Strategies: {', '.join(strategies)}")

    results = run_all_sessions(sessions, strategies, args.sessions)
    save_report(results)

    if args.compare:
        print_comparison_table(results)

    print(f"\nDone. Prompt files written to: {OUTPUT_DIR}")
    print("Next step: Send each prompt file to an LLM and compare outputs.")


if __name__ == "__main__":
    main()