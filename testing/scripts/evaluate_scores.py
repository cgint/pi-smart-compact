#!/usr/bin/env python3
"""
Calculate weighted scores from evaluation tables.

Usage:
    python3 scripts/evaluate_scores.py session_20-23.json
    python3 scripts/evaluate_scores.py session_20-23.json --show-table
"""
import json
import sys

WEIGHTS = [2, 2, 2, 1, 1, 1, 0.5]
DIM_NAMES = [
    "Trajectory Fidelity",
    "Decision Accuracy",
    "Continuation Sufficiency",
    "Size Discipline",
    "Fact/Inference Separation",
    "Evidence Anchoring",
    "Structural Completeness",
]
MAX_POSSIBLE = sum([10 * w for w in WEIGHTS])  # 10 * 9.5 = 95


def load_scores(path):
    with open(path) as f:
        return json.load(f)


def compute(scores_dict):
    results = {}
    for strategy, dims in scores_dict.items():
        raw = sum(dims[i] * WEIGHTS[i] for i in range(7))
        weighted = raw / sum(WEIGHTS)
        pct = raw / MAX_POSSIBLE * 100
        grade = "Acceptable" if weighted >= 4.0 else ("Marginal" if weighted >= 3.0 else "Fail")
        results[strategy] = {
            "raw_sum": raw,
            "max_possible": MAX_POSSIBLE,
            "weighted_score": round(weighted, 2),
            "pct": round(pct, 1),
            "grade": grade,
            "dimensions": dims,
        }
    return results


def show_table(results):
    print(f"\n{'Strategy':<12} {'Raw':>5} {'Max':>5} {'Weighted':>9} {'%':>6} {'Grade':<10}")
    print("-" * 55)
    for strat, r in results.items():
        print(f"{strat:<12} {r['raw_sum']:>5} {r['max_possible']:>5} {r['weighted_score']:>9} {r['pct']:>6}% {r['grade']:<10}")

    print(f"\nDimension weights: {list(zip(DIM_NAMES, WEIGHTS))}")
    for strat, r in results.items():
        print(f"\n{strat}:")
        for i, (dim, dim_score) in enumerate(zip(DIM_NAMES, r['dimensions'])):
            print(f"  {dim:<28} score={dim_score}  weight={WEIGHTS[i]}")


def main():
    if len(sys.argv) < 2:
        print("Usage: evaluate_scores.py <scores.json> [--show-table]")
        sys.exit(1)

    scores = load_scores(sys.argv[1])
    results = compute(scores)

    show_flag = "--show-table" in sys.argv
    if show_flag:
        show_table(results)

    # Always output JSON for piping
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()