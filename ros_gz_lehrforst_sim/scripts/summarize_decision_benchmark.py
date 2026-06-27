#!/usr/bin/env python3

import argparse
import csv
import glob
import os


EXPECTED_DECISIONS = {
    "soft": "SOFT_TRAVERSABLE",
    "hard": "HARD_BLOCKED",
}


def load_latest(log_dir, pattern):
    matches = sorted(glob.glob(os.path.join(log_dir, pattern)))
    return matches[-1] if matches else None


def summarize_case(log_dir, label):
    path = load_latest(log_dir, f"{label}_decisions_*.csv")
    expected = EXPECTED_DECISIONS.get(label, "")
    summary = {
        "label": label,
        "expected": expected,
        "final_decision": "missing",
        "expected_seen": False,
        "obstacle_seen": False,
        "min_front_range": None,
        "max_force_proxy": 0.0,
        "pose_delta": 0.0,
        "progress_after_contact": 0.0,
        "path": path or "",
    }

    if not path:
        return summary

    with open(path, newline="") as decision_file:
        for row in csv.DictReader(decision_file):
            decision = row["decision"]
            summary["final_decision"] = decision
            if decision == expected:
                summary["expected_seen"] = True
            if row["obstacle_ahead"] == "1":
                summary["obstacle_seen"] = True
            if row["min_front_range_m"]:
                value = float(row["min_front_range_m"])
                if summary["min_front_range"] is None:
                    summary["min_front_range"] = value
                else:
                    summary["min_front_range"] = min(summary["min_front_range"], value)
            if row["force_event_p_n"]:
                summary["max_force_proxy"] = max(
                    summary["max_force_proxy"], float(row["force_event_p_n"])
                )
            summary["pose_delta"] = float(row["pose_delta_x"])
            summary["progress_after_contact"] = float(row["progress_after_contact_x"])

    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log-dir", default="/workspace/logs/decision_benchmarks")
    parser.add_argument("labels", nargs="*", default=["soft", "hard"])
    args = parser.parse_args()

    summaries = [summarize_case(args.log_dir, label) for label in args.labels]

    print()
    print("=== Decision benchmark summary ===")
    print(
        "case,expected,final_decision,expected_seen,obstacle_seen,"
        "min_front_range_m,max_force_proxy_N,pose_delta_x,"
        "progress_after_contact_x,result"
    )
    for row in summaries:
        result = (
            "PASS"
            if row["expected_seen"] and row["obstacle_seen"]
            else "FAIL"
        )
        min_front = (
            "none"
            if row["min_front_range"] is None
            else f"{row['min_front_range']:.3f}"
        )
        print(
            f"{row['label']},{row['expected']},{row['final_decision']},"
            f"{int(row['expected_seen'])},{int(row['obstacle_seen'])},"
            f"{min_front},{row['max_force_proxy']:.2f},"
            f"{row['pose_delta']:.3f},{row['progress_after_contact']:.3f},"
            f"{result}"
        )

    print()
    print("CSV files:")
    for row in summaries:
        print(f"{row['label']} decisions: {row['path']}")


if __name__ == "__main__":
    main()
