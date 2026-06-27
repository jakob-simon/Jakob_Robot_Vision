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
    path = load_latest(log_dir, f"{label}_live_reaction_*.csv")
    expected = EXPECTED_DECISIONS.get(label, "")
    summary = {
        "label": label,
        "expected": expected,
        "path": path or "",
        "expected_seen": False,
        "hard_stop_seen": False,
        "final_decision": "missing",
        "final_cmd": 0.0,
        "final_stop_reason": "",
        "pose_delta": 0.0,
        "pose_delta_after_hard_stop": 0.0,
        "max_speed_after_hard_stop": 0.0,
    }

    if not path:
        return summary

    hard_stop_pose = None
    with open(path, newline="") as live_file:
        for row in csv.DictReader(live_file):
            decision = row["decision"]
            pose_delta = float(row["pose_delta_x"])
            cmd = float(row["cmd_linear_x"])
            stop_reason = row["stop_reason"]

            summary["final_decision"] = decision
            summary["final_cmd"] = cmd
            summary["final_stop_reason"] = stop_reason
            summary["pose_delta"] = pose_delta

            if decision == expected:
                summary["expected_seen"] = True

            if stop_reason == "hard_blocked":
                summary["hard_stop_seen"] = True
                if hard_stop_pose is None:
                    hard_stop_pose = pose_delta
                else:
                    summary["max_speed_after_hard_stop"] = max(
                        summary["max_speed_after_hard_stop"], abs(cmd)
                    )

    if hard_stop_pose is not None:
        summary["pose_delta_after_hard_stop"] = max(
            0.0, summary["pose_delta"] - hard_stop_pose
        )

    return summary


def result_for(row):
    if row["label"] == "soft":
        return (
            row["expected_seen"]
            and not row["hard_stop_seen"]
            and row["pose_delta"] >= 0.20
        )
    if row["label"] == "hard":
        return (
            row["expected_seen"]
            and row["hard_stop_seen"]
            and abs(row["final_cmd"]) <= 0.001
            and row["final_stop_reason"] == "hard_blocked"
            and row["pose_delta_after_hard_stop"] <= 0.08
            and row["max_speed_after_hard_stop"] <= 0.001
        )
    return row["expected_seen"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log-dir", default="/workspace/logs/live_reaction_benchmarks")
    parser.add_argument("labels", nargs="*", default=["soft", "hard"])
    args = parser.parse_args()

    summaries = [summarize_case(args.log_dir, label) for label in args.labels]

    print()
    print("=== Live reaction benchmark summary ===")
    print(
        "case,expected,final_decision,expected_seen,hard_stop_seen,"
        "final_cmd,final_stop_reason,pose_delta_x,"
        "pose_delta_after_hard_stop_x,max_speed_after_hard_stop,result"
    )
    for row in summaries:
        passed = result_for(row)
        print(
            f"{row['label']},{row['expected']},{row['final_decision']},"
            f"{int(row['expected_seen'])},{int(row['hard_stop_seen'])},"
            f"{row['final_cmd']:.3f},{row['final_stop_reason']},"
            f"{row['pose_delta']:.3f},{row['pose_delta_after_hard_stop']:.3f},"
            f"{row['max_speed_after_hard_stop']:.3f},"
            f"{'PASS' if passed else 'FAIL'}"
        )

    print()
    print("CSV files:")
    for row in summaries:
        print(f"{row['label']} live: {row['path']}")

    if not all(result_for(row) for row in summaries):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
