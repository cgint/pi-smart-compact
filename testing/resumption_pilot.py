#!/usr/bin/env python3
"""
Behavioral Resumption Pilot

Feeds a compaction summary (or no summary for control) to a fresh agent
via the model endpoint and captures the first turn output.

Usage:
  # Run a single condition
  python3 resumption_pilot.py --condition pi --compaction summary_pi.txt
  python3 resumption_pilot.py --condition smart --compaction summary_smart.txt
  python3 resumption_pilot.py --condition control

  # Run all three conditions at once
  python3 resumption_pilot.py --all

Config (env vars, same as compaction harness):
  COMPACT_MODEL_URL=http://sparky:8001/v1/chat/completions
  COMPACT_MODEL_ID=qwen36-35b-nvidia-nvfp4
"""

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

# Config
BASE_DIR = Path(__file__).parent.parent
RESULTS_DIR = BASE_DIR / "testing" / "compaction_results"
SLOT2_DIR = RESULTS_DIR / "--Users-cgint-dev-web-scrape-meno--"

MODEL_URL = os.environ.get("COMPACT_MODEL_URL", "http://sparky:8001/v1/chat/completions")
MODEL_ID = os.environ.get("COMPACT_MODEL_ID", "qwen36-35b-nvidia-nvfp4")
TEMPERATURE = 0.1  # Low for determinism
MAX_TOKENS = 4096

# Default compaction files
DEFAULT_COMPACT_FILES = {
    "pi": SLOT2_DIR / "summary_pi.txt",
    "smart": SLOT2_DIR / "summary_smart.txt",
    "smart_a": SLOT2_DIR / "summary_smart_a.txt",
    "smart_b": SLOT2_DIR / "summary_smart_b.txt",
    "smart_meta": SLOT2_DIR / "summary_smart_meta.txt",
}

# Output directory for pilot results
PILOT_OUT_DIR = Path(__file__).parent / "behavioral_pilot_outputs"
PILOT_OUT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# Prompts
# ============================================================

NEUTRAL_RESUMPTION_PROMPT = """You are a resumed agent. Below is the compaction summary of the previous session.
Review the context, state the active goal, and execute the single next step.

--- COMPACTION SUMMARY ---
{compaction_content}
--- END COMPACTION SUMMARY ---"""

CONTROL_PROMPT = """You are a resumed agent. No compaction summary is available.
The workspace is at the state where the previous session ended.
Inspect the workspace and determine the active goal and next step."""


def build_prompt(condition, compaction_content=None):
    """Build the resumption prompt for the given condition."""
    if condition == "control":
        return CONTROL_PROMPT
    return NEUTRAL_RESUMPTION_PROMPT.format(compaction_content=compaction_content)


# ============================================================
# LLM Call
# ============================================================

def call_model(prompt_text):
    """Send a single message to the model and return the response."""
    payload = json.dumps({
        "model": MODEL_ID,
        "messages": [{"role": "user", "content": prompt_text}],
        "max_tokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
    }).encode("utf-8")

    req = urllib.request.Request(
        MODEL_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read())

    return data["choices"][0]["message"]["content"]


# ============================================================
# Run one condition
# ============================================================

def run_condition(condition, compaction_path=None):
    """Run a single condition and save the output."""
    print(f"\n{'='*60}")
    print(f"Condition: {condition}")

    # Load compaction content (unless control)
    compaction_content = None
    if condition != "control" and compaction_path:
        comp_file = Path(compaction_path)
        if not comp_file.exists():
            print(f"ERROR: Compaction file not found: {comp_file}", file=sys.stderr)
            return None
        compaction_content = comp_file.read_text(encoding="utf-8")
        print(f"Loaded compaction: {comp_file.name} ({len(compaction_content)} chars)")
    else:
        print("Control condition (no compaction)")

    # Build prompt
    prompt = build_prompt(condition, compaction_content)
    print(f"Prompt length: {len(prompt)} chars")

    # Call model
    print("Calling model...", end=" ", flush=True)
    try:
        response = call_model(prompt)
        print(f"OK ({len(response)} chars)")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return None

    # Save output
    out_file = PILOT_OUT_DIR / f"output_{condition}.json"
    result = {
        "condition": condition,
        "compaction_file": str(compaction_path) if compaction_path else None,
        "prompt_length": len(prompt),
        "response_length": len(response),
        "model": MODEL_ID,
        "temperature": TEMPERATURE,
        "response": response,
    }
    out_file.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved: {out_file}")

    return result


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Behavioral Resumption Pilot"
    )
    parser.add_argument(
        "--condition",
        choices=["pi", "smart", "smart_a", "smart_b", "smart_meta", "control"],
        help="Run a single condition",
    )
    parser.add_argument(
        "--compaction",
        help="Path to compaction file (required for pi/smart conditions)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all three conditions (control, pi, smart)",
    )
    args = parser.parse_args()

    if args.all:
        conditions = [
            ("control", None),
            ("pi", DEFAULT_COMPACT_FILES["pi"]),
            ("smart", DEFAULT_COMPACT_FILES["smart"]),
            ("smart_b", DEFAULT_COMPACT_FILES["smart_b"]),
            ("smart_meta", DEFAULT_COMPACT_FILES["smart_meta"]),
        ]
        results = []
        for cond, comp_path in conditions:
            result = run_condition(cond, str(comp_path) if comp_path else None)
            if result:
                results.append(result)
        print(f"\n{'='*60}")
        print(f"Done. {len(results)}/5 conditions completed.")
        print(f"Outputs: {PILOT_OUT_DIR}/")
    elif args.condition:
        comp_path = args.compaction
        if args.condition != "control" and not comp_path:
            comp_path = DEFAULT_COMPACT_FILES.get(args.condition)
            if not comp_path:
                print(f"ERROR: No compaction file for condition '{args.condition}'.", file=sys.stderr)
                sys.exit(1)
        result = run_condition(args.condition, comp_path)
        if result:
            print(f"\nDone. Output: {PILOT_OUT_DIR}/output_{args.condition}.json")
        else:
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()