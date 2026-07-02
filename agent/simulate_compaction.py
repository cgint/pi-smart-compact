#!/usr/bin/env python3
"""
Simulate compaction by running the draft prompt against a test session.

Reads a JSONL session, serializes the first 70% of messages,
runs the draft compaction prompt, and outputs the result.

Writes all outputs to agent/ directory only.
"""

import json
import sys
from pathlib import Path

# Import the serialization logic from Pi's compaction
# We'll replicate it here to avoid importing the compiled JS
def serialize_conversation(messages):
    """Replicate Pi's serializeConversation from utils.js"""
    parts = []
    for msg in messages:
        if msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, list):
                content = " ".join(
                    b.get("text", "") for b in content if b.get("type") == "text"
                )
            if content:
                parts.append(f"[User]: {content}")
        elif msg.get("role") == "assistant":
            text_parts = []
            thinking_parts = []
            tool_calls = []
            content = msg.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                        elif block.get("type") == "thinking":
                            thinking_parts.append(block.get("thinking", ""))
                        elif block.get("type") == "toolCall":
                            args = block.get("arguments", {})
                            args_str = ", ".join(f"{k}={json.dumps(v)}" for k, v in args.items())
                            tool_calls.append(f"{block.get('name', '')}({args_str})")
            if thinking_parts:
                parts.append(f"[Assistant thinking]: {' '.join(thinking_parts)}")
            if text_parts:
                parts.append(f"[Assistant]: {' '.join(text_parts)}")
            if tool_calls:
                parts.append(f"[Assistant tool calls]: {'; '.join(tool_calls)}")
        elif msg.get("role") == "toolResult":
            content = msg.get("content", [])
            if isinstance(content, list):
                content = " ".join(
                    b.get("text", "") for b in content if b.get("type") == "text"
                )
            if content:
                # Truncate to 2000 chars like Pi does
                content = content[:2000]
                parts.append(f"[Tool result]: {content}")
    return "\n\n".join(parts)


def load_session(path: str) -> list:
    """Load JSON or JSONL session and return message list."""
    messages = []
    
    # Try JSONL first
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    
    if content.startswith("{"):
        # Single JSON file
        obj = json.loads(content)
        if "messages" in obj:
            raw_messages = obj["messages"]
        else:
            raw_messages = [obj]
    else:
        # JSONL
        raw_messages = []
        for line in content.split("\n"):
            line = line.strip()
            if line:
                try:
                    raw_messages.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    
    for msg in raw_messages:
        # Handle different formats
        if "type" in msg and "content" in msg:
            role = msg.get("type", "")
            if role in ("user", "gemini", "assistant", "toolResult"):
                messages.append({
                    "role": role,
                    "content": msg.get("content", ""),
                    "timestamp": msg.get("timestamp", ""),
                    "id": msg.get("id", ""),
                })
        elif "type" == "message" and "message" in msg:
            # JSONL format from Pi
            m = msg.get("message", {})
            role = m.get("role", "")
            if role in ("user", "assistant", "toolResult"):
                messages.append({
                    "role": role,
                    "content": m.get("content", ""),
                    "timestamp": msg.get("timestamp", ""),
                    "id": msg.get("id", ""),
                })
    
    return messages


def build_prompt(messages_serialized: str, previous_summary: str = None) -> str:
    """Build the full compaction prompt."""
    system_prompt = """You are a session compaction specialist. Your task is to read a conversation between a user and an AI assistant, then produce a structured continuation context that enables another agent to pick up exactly where the work left off.

RULES:
1. Preserve the bigger-picture objective and the current work phase.
2. Preserve decisions with their rationale and evidence references.
3. Preserve unresolved blockers and uncertainty.
4. Preserve key file operations (read/write/edit) with exact paths.
5. Preserve the last ~20K tokens of conversation verbatim (do not summarize recent work).
6. Remove: stale planning chatter, repeated explanations, low-value tool narration, details that no longer influence the next decision, outdated hypotheses, redundant summaries.
7. Do NOT continue the conversation. Do NOT respond to questions. ONLY output the structured summary below.
"""
    
    base_prompt = """The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages."""
    
    # Build the full prompt
    prompt = f"{system_prompt}\n\n"
    prompt += f"<conversation>\n{messages_serialized}\n</conversation>\n\n"
    
    if previous_summary:
        prompt += f"<previous-summary>\n{previous_summary}\n</previous-summary>\n\n"
    
    prompt += base_prompt
    
    return prompt


def main():
    if len(sys.argv) < 2:
        print("Usage: python simulate_compaction.py <session.jsonl> [--output <output.md>]")
        sys.exit(1)
    
    session_path = sys.argv[1]
    output_path = "agent/compaction_test_result.md"
    
    # Parse --output flag if present
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_path = sys.argv[idx + 1]
    
    # Load session
    print(f"Loading session: {session_path}")
    messages = load_session(session_path)
    print(f"Loaded {len(messages)} messages")
    
    if not messages:
        print("ERROR: No messages found in session")
        sys.exit(1)
    
    # Take first 70% for compaction (simulating compaction mid-session)
    split_point = int(len(messages) * 0.7)
    messages_to_compact = messages[:split_point]
    messages_remaining = messages[split_point:]
    
    print(f"Compacting first {split_point}/{len(messages)} messages ({70}% of session)")
    print(f"Remaining: {len(messages_remaining)} messages for validation")
    
    # Serialize
    serialized = serialize_conversation(messages_to_compact)
    print(f"Serialized to {len(serialized)} characters")
    
    # Build prompt
    prompt = build_prompt(serialized)
    print(f"Prompt built: {len(prompt)} characters")
    
    # Write prompt to file for inspection
    prompt_path = "agent/compaction_test_prompt.md"
    with open(prompt_path, "w", encoding="utf-8") as f:
        f.write(prompt)
    print(f"Prompt written to: {prompt_path}")
    
    # Print summary (the actual compaction would require an LLM call)
    print("\n=== COMPACTION TEST READY ===")
    print(f"Session: {session_path}")
    print(f"Messages to compact: {split_point}")
    print(f"Messages for validation: {len(messages_remaining)}")
    print(f"\nTo run the actual compaction:")
    print(f"  1. Send the prompt at {prompt_path} to an LLM")
    print(f"  2. Capture the structured output")
    print(f"  3. Evaluate against the remaining {len(messages_remaining)} messages")
    print(f"\nThe prompt file is ready for manual testing or API invocation.")


if __name__ == "__main__":
    main()