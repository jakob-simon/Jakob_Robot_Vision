#!/usr/bin/env python3

import argparse
import csv
import glob
import os


def load_latest(log_dir, pattern):
    matches = sorted(glob.glob(os.path.join(log_dir, pattern)))
    return matches[-1] if matches else None


def summarize_case(log_dir, label, threshold):
    sample_path = load_latest(log_dir, f"{label}_samples_*.csv")
    event_path = load_latest(log_dir, f"{label}_events_*.csv")
    summary = {
        "label": label,
        "max_force": 0.0,
        "force_proxy": 0.0,
        "contact_duration": 0.0,
        "odom_delta": 0.0,
        "pose_delta": 0.0,
        "progress_after_contact": 0.0,
        "first_segment": "none",
        "first_event_progress_x": None,
        "outcome": "unknown",
        "sample_path": sample_path or "",
        "event_path": event_path or "",
    }

    if sample_path:
        contact_start = None
        contact_end = None
        with open(sample_path, newline="") as sample_file:
            for row in csv.DictReader(sample_file):
                sample_time = float(row["wall_time_s"])
                force = float(row["max_corrected_force"])
                summary["max_force"] = max(summary["max_force"], force)
                summary["odom_delta"] = float(row["odom_delta_x"])
                summary["pose_delta"] = float(
                    row.get("pose_delta_x") or row["odom_delta_x"]
                )
                if force >= threshold:
                    if contact_start is None:
                        contact_start = sample_time
                    contact_end = sample_time
        if contact_start is not None and contact_end is not None:
            summary["contact_duration"] = max(0.0, contact_end - contact_start)

    if event_path:
        with open(event_path, newline="") as event_file:
            events = list(csv.DictReader(event_file))
        if events:
            first = events[0]
            summary["first_segment"] = first["segment"]
            summary["force_proxy"] = float(first["force_proxy"])
            summary["first_event_progress_x"] = float(
                first.get("pose_delta_x") or first["odom_x"]
            )

    if summary["first_event_progress_x"] is not None:
        summary["progress_after_contact"] = max(
            0.0, summary["pose_delta"] - summary["first_event_progress_x"]
        )
        summary["outcome"] = (
            "push-through"
            if summary["progress_after_contact"] >= 0.35
            else "blocked/slow"
        )
    else:
        summary["progress_after_contact"] = summary["pose_delta"]
        summary["outcome"] = "no-contact"
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log-dir", default="/workspace/logs/force_benchmarks")
    parser.add_argument("--threshold", type=float, default=80.0)
    parser.add_argument("labels", nargs="*", default=["soft", "hard"])
    args = parser.parse_args()

    summaries = [
        summarize_case(args.log_dir, label, args.threshold) for label in args.labels
    ]

    print()
    print("=== Force benchmark summary ===")
    print(
        "case,max_force_N,force_proxy_N,contact_duration_s,"
        "odom_delta_x,pose_delta_x,progress_after_contact_x,first_segment,outcome"
    )
    for row in summaries:
        print(
            f"{row['label']},{row['max_force']:.2f},{row['force_proxy']:.2f},"
            f"{row['contact_duration']:.2f},{row['odom_delta']:.3f},"
            f"{row['pose_delta']:.3f},"
            f"{row['progress_after_contact']:.3f},"
            f"{row['first_segment']},{row['outcome']}"
        )

    by_label = {row["label"]: row for row in summaries}
    soft = by_label.get("soft")
    hard = by_label.get("hard")
    if soft and hard and soft["max_force"] > 0 and hard["max_force"] > 0:
        print()
        if hard["max_force"] > soft["max_force"]:
            split = (soft["max_force"] + hard["max_force"]) / 2.0
            print(f"Suggested first hard/soft max-force split: {split:.2f} N")
        else:
            print(
                "Max force alone is not a reliable soft/hard split in this run; "
                "use odometry progress and contact duration as additional features."
            )

    print()
    print("CSV files:")
    for row in summaries:
        print(f"{row['label']} samples: {row['sample_path']}")
        print(f"{row['label']} events:  {row['event_path']}")


if __name__ == "__main__":
    main()
