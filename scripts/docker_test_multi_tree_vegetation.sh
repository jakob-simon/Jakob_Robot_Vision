#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export USER_UID="$(id -u)"
export USER_GID="$(id -g)"
export USER="${USER:-$(id -un)}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"

if [[ -z "${ROS_DOMAIN_ID:-}" ]]; then
  export ROS_DOMAIN_ID="$((80 + RANDOM % 40))"
fi
export GZ_PARTITION="${GZ_PARTITION:-multi_tree_vegetation_$(date +%s)_$$}"
export MULTI_TREE_RUN_SECONDS="${MULTI_TREE_RUN_SECONDS:-110}"
export GUI_CLEAR_SPEED="${GUI_CLEAR_SPEED:-1.4}"
export GUI_OBSTACLE_SPEED="${GUI_OBSTACLE_SPEED:-0.45}"
export GUI_SOFT_SPEED="${GUI_SOFT_SPEED:-0.45}"
export GUI_HARD_SPEED="${GUI_HARD_SPEED:-0.0}"
export GUI_LANE_KEEP_TARGET_Y="${GUI_LANE_KEEP_TARGET_Y:-2.118}"
export GUI_AVOID_LANE_Y="${GUI_AVOID_LANE_Y:-4.5}"
export GUI_AVOID_REVERSE_SPEED="${GUI_AVOID_REVERSE_SPEED:--0.4}"
export GUI_AVOID_REVERSE_DISTANCE="${GUI_AVOID_REVERSE_DISTANCE:-1.2}"
export GUI_AVOID_TURN_SPEED="${GUI_AVOID_TURN_SPEED:-0.5}"
export GUI_AVOID_TURN_ANGULAR="${GUI_AVOID_TURN_ANGULAR:-1.2}"
export GUI_AVOID_TURN_ANGLE="${GUI_AVOID_TURN_ANGLE:-0.9}"
export GUI_AVOID_TURN_MIN_YAW="${GUI_AVOID_TURN_MIN_YAW:-0.75}"
export GUI_AVOID_FORWARD_SPEED="${GUI_AVOID_FORWARD_SPEED:-1.0}"
export GUI_AVOID_FORWARD_CLEAR="${GUI_AVOID_FORWARD_CLEAR:-1.8}"
export GUI_AVOID_RETURN_SPEED="${GUI_AVOID_RETURN_SPEED:-0.75}"
export GUI_AVOID_RETURN_LATERAL_GAIN="${GUI_AVOID_RETURN_LATERAL_GAIN:-0.20}"
export GUI_AVOID_RETURN_YAW_GAIN="${GUI_AVOID_RETURN_YAW_GAIN:-0.80}"
export GUI_AVOID_RETURN_MAX_ANGULAR="${GUI_AVOID_RETURN_MAX_ANGULAR:-0.40}"
export GUI_AVOID_RETURN_HEADING_LIMIT="${GUI_AVOID_RETURN_HEADING_LIMIT:-0.45}"
export GUI_AVOID_RETURN_Y_TOLERANCE="${GUI_AVOID_RETURN_Y_TOLERANCE:-0.30}"
export GUI_AVOID_RETURN_YAW_TOLERANCE="${GUI_AVOID_RETURN_YAW_TOLERANCE:-0.25}"
export GUI_AVOID_RETURN_MAX_S="${GUI_AVOID_RETURN_MAX_S:-18.0}"
export GUI_CORRIDOR_HALF_WIDTH="${GUI_CORRIDOR_HALF_WIDTH:-0.45}"
export GUI_CORRIDOR_LOOK_AHEAD="${GUI_CORRIDOR_LOOK_AHEAD:-1.0}"
export GUI_CONTACT_OBSTACLE_DISTANCE="${GUI_CONTACT_OBSTACLE_DISTANCE:-0.35}"

docker compose run --rm \
  -e ROS_DOMAIN_ID \
  -e GZ_PARTITION \
  -e MULTI_TREE_RUN_SECONDS \
  -e GUI_CLEAR_SPEED \
  -e GUI_OBSTACLE_SPEED \
  -e GUI_SOFT_SPEED \
  -e GUI_HARD_SPEED \
  -e GUI_LANE_KEEP_TARGET_Y \
  -e GUI_AVOID_LANE_Y \
  -e GUI_AVOID_REVERSE_SPEED \
  -e GUI_AVOID_REVERSE_DISTANCE \
  -e GUI_AVOID_TURN_SPEED \
  -e GUI_AVOID_TURN_ANGULAR \
  -e GUI_AVOID_TURN_ANGLE \
  -e GUI_AVOID_TURN_MIN_YAW \
  -e GUI_AVOID_FORWARD_SPEED \
  -e GUI_AVOID_FORWARD_CLEAR \
  -e GUI_AVOID_RETURN_SPEED \
  -e GUI_AVOID_RETURN_LATERAL_GAIN \
  -e GUI_AVOID_RETURN_YAW_GAIN \
  -e GUI_AVOID_RETURN_MAX_ANGULAR \
  -e GUI_AVOID_RETURN_HEADING_LIMIT \
  -e GUI_AVOID_RETURN_Y_TOLERANCE \
  -e GUI_AVOID_RETURN_YAW_TOLERANCE \
  -e GUI_AVOID_RETURN_MAX_S \
  -e GUI_CORRIDOR_HALF_WIDTH \
  -e GUI_CORRIDOR_LOOK_AHEAD \
  -e GUI_CONTACT_OBSTACLE_DISTANCE \
  robot-vision bash -lc '
  set -eo pipefail
  source /opt/ros/jazzy/setup.bash
  source /workspace/install/setup.bash
  set -u

  label=multi_tree
  log_dir=/workspace/logs/live_reaction_benchmarks
  mkdir -p "${log_dir}"
  rm -f "${log_dir}/${label}_"*.csv 2>/dev/null || true

  setsid ros2 launch ros_gz_lehrforst_sim scout_bumper_vegetation_headless.launch.xml \
    >/tmp/multi_tree_launch.log 2>&1 &
  launch_pid=$!

  cleanup() {
    timeout 2s ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.0}, angular: {z: 0.0}}" >/dev/null 2>&1 || true
    kill -TERM "${live_pid:-}" >/dev/null 2>&1 || true
    wait "${live_pid:-}" >/dev/null 2>&1 || true
    kill -TERM "${decision_pid:-}" >/dev/null 2>&1 || true
    wait "${decision_pid:-}" >/dev/null 2>&1 || true
    kill -TERM "${event_pid:-}" >/dev/null 2>&1 || true
    wait "${event_pid:-}" >/dev/null 2>&1 || true
    kill -TERM "-${launch_pid}" >/dev/null 2>&1 || true
    kill -TERM "${launch_pid}" >/dev/null 2>&1 || true
    wait "${launch_pid}" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  sleep 8
  timeout 90s bash -lc "until ros2 topic list > /tmp/multi_tree_topics.txt && grep -qx /scan /tmp/multi_tree_topics.txt && grep -qx /pose /tmp/multi_tree_topics.txt && grep -qx /odom /tmp/multi_tree_topics.txt && grep -qx /scout/force_bar/segment_0 /tmp/multi_tree_topics.txt; do sleep 1; done"

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/force_event_node.py \
    --ros-args \
    -p "label:=${label}" \
    -p "log_dir:=${log_dir}" \
    -p "baseline_duration_s:=3.0" \
    -p "threshold_n:=18.0" \
    -p "duration_gate_s:=0.04" \
    -p "peak_window_s:=1.0" \
    >/tmp/multi_tree_force_event.log 2>&1 &
  event_pid=$!

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/decision_node.py \
    --ros-args \
    -p "label:=${label}" \
    -p "log_dir:=${log_dir}" \
    -p "front_angle_deg:=25.0" \
    -p "obstacle_distance_m:=0.5" \
    -p "corridor_half_width_m:=${GUI_CORRIDOR_HALF_WIDTH}" \
    -p "corridor_look_ahead_m:=${GUI_CORRIDOR_LOOK_AHEAD}" \
    -p "contact_obstacle_distance_m:=${GUI_CONTACT_OBSTACLE_DISTANCE}" \
    -p "hard_force_threshold_n:=5000.0" \
    -p "blocked_progress_threshold_m:=0.25" \
    -p "contact_test_duration_s:=2.0" \
    -p "new_contact_progress_reset_m:=0.30" \
    >/tmp/multi_tree_decision.log 2>&1 &
  decision_pid=$!

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/live_reaction_node.py \
    --ros-args \
    -p "label:=${label}" \
    -p "log_dir:=${log_dir}" \
    -p "clear_speed:=${GUI_CLEAR_SPEED}" \
    -p "obstacle_speed:=${GUI_OBSTACLE_SPEED}" \
    -p "soft_speed:=${GUI_SOFT_SPEED}" \
    -p "hard_speed:=${GUI_HARD_SPEED}" \
    -p "soft_contact_hold_s:=0.6" \
    -p "decision_timeout_s:=2.0" \
    -p "lane_keep_enabled:=true" \
    -p "lane_keep_target_y:=${GUI_LANE_KEEP_TARGET_Y}" \
    -p "lane_keep_lateral_gain:=0.7" \
    -p "lane_keep_yaw_gain:=1.0" \
    -p "lane_keep_max_angular:=0.8" \
    -p "tree_avoidance_enabled:=true" \
    -p "avoid_lane_y:=${GUI_AVOID_LANE_Y}" \
    -p "avoid_reverse_speed:=${GUI_AVOID_REVERSE_SPEED}" \
    -p "avoid_reverse_distance_m:=${GUI_AVOID_REVERSE_DISTANCE}" \
    -p "avoid_reverse_s:=6.0" \
    -p "avoid_turn_speed:=${GUI_AVOID_TURN_SPEED}" \
    -p "avoid_turn_angular:=${GUI_AVOID_TURN_ANGULAR}" \
    -p "avoid_turn_angle_rad:=${GUI_AVOID_TURN_ANGLE}" \
    -p "avoid_turn_min_yaw_rad:=${GUI_AVOID_TURN_MIN_YAW}" \
    -p "avoid_turn_max_s:=8.0" \
    -p "avoid_forward_speed:=${GUI_AVOID_FORWARD_SPEED}" \
    -p "avoid_forward_clear_m:=${GUI_AVOID_FORWARD_CLEAR}" \
    -p "avoid_return_speed:=${GUI_AVOID_RETURN_SPEED}" \
    -p "avoid_return_lateral_gain:=${GUI_AVOID_RETURN_LATERAL_GAIN}" \
    -p "avoid_return_yaw_gain:=${GUI_AVOID_RETURN_YAW_GAIN}" \
    -p "avoid_return_max_angular:=${GUI_AVOID_RETURN_MAX_ANGULAR}" \
    -p "avoid_return_heading_limit_rad:=${GUI_AVOID_RETURN_HEADING_LIMIT}" \
    -p "avoid_return_y_tolerance_m:=${GUI_AVOID_RETURN_Y_TOLERANCE}" \
    -p "avoid_return_yaw_tolerance_rad:=${GUI_AVOID_RETURN_YAW_TOLERANCE}" \
    -p "avoid_return_max_s:=${GUI_AVOID_RETURN_MAX_S}" \
    -p "finish_stop_enabled:=false" \
    >/tmp/multi_tree_live_reaction.log 2>&1 &
  live_pid=$!

  echo "=== multi_tree: autonomous headless vegetation run for ${MULTI_TREE_RUN_SECONDS}s ==="
  sleep "${MULTI_TREE_RUN_SECONDS}"

  echo "=== multi_tree: latest live status ==="
  timeout 5s ros2 topic echo /traversability/live_status --once || true

  cleanup
  trap - EXIT

  echo "=== multi_tree: force-event node log tail ==="
  tail -20 /tmp/multi_tree_force_event.log || true
  echo "=== multi_tree: decision node log tail ==="
  tail -20 /tmp/multi_tree_decision.log || true
  echo "=== multi_tree: live reaction node log tail ==="
  tail -20 /tmp/multi_tree_live_reaction.log || true

  python3 - <<'"'"'PY'"'"'
import csv
import glob
import os
from collections import Counter

log_dir = "/workspace/logs/live_reaction_benchmarks"
label = "multi_tree"

def latest(pattern):
    matches = sorted(glob.glob(os.path.join(log_dir, pattern)))
    return matches[-1] if matches else None

live_path = latest(f"{label}_live_reaction_*.csv")
decision_path = latest(f"{label}_decisions_*.csv")
event_path = latest(f"{label}_events_*.csv")

print()
print("=== Multi-tree vegetation summary ===")
print("live_csv=" + (live_path or ""))
print("decision_csv=" + (decision_path or ""))
print("event_csv=" + (event_path or ""))

if not live_path:
    print("result=FAIL reason=no_live_csv")
    raise SystemExit(0)

with open(live_path, newline="") as live_file:
    rows = list(csv.DictReader(live_file))

if not rows:
    print("result=FAIL reason=empty_live_csv")
    raise SystemExit(0)

mode_counts = Counter(row["mode"] for row in rows)
decision_counts = Counter(row["decision"] for row in rows)
stop_counts = Counter(row["stop_reason"] for row in rows if row["stop_reason"])

decision_rows = []
if decision_path:
    with open(decision_path, newline="") as decision_file:
        decision_rows = list(csv.DictReader(decision_file))

reverse_starts = 0
turn_starts = 0
forward_starts = 0
return_starts = 0
completed_bypasses = 0
transitions = []
prev_mode = rows[0]["mode"]
for row in rows[1:]:
    mode = row["mode"]
    if mode != prev_mode:
        transitions.append(row)
        if mode == "avoid_tree_reverse":
            reverse_starts += 1
            if prev_mode == "avoid_tree_return":
                completed_bypasses += 1
        elif mode == "avoid_tree_turn":
            turn_starts += 1
        elif mode == "avoid_tree_forward":
            forward_starts += 1
        elif mode == "avoid_tree_return":
            return_starts += 1
        elif mode == "drive_line" and prev_mode == "avoid_tree_return":
            completed_bypasses += 1
    prev_mode = mode

final = rows[-1]
max_pose_delta = max(float(row["pose_delta_x"]) for row in rows)
max_abs_y = max(abs(float(row["pose_y"])) for row in rows)
finish_stop_count = stop_counts.get("finish_stop", 0)
hard_stop_count = stop_counts.get("hard_blocked", 0)
timeout_count = stop_counts.get("decision_timeout", 0)
return_rows = [row for row in rows if row["mode"] == "avoid_tree_return"]
return_max_abs_angular = (
    max(abs(float(row["cmd_angular_z"])) for row in return_rows)
    if return_rows
    else 0.0
)
return_max_abs_yaw = (
    max(abs(float(row["pose_yaw"])) for row in return_rows)
    if return_rows
    else 0.0
)

bush_windows = {
    "bush_1": (1.0, 2.4),
    "bush_2": (5.2, 7.4),
}
bush_results = {}
for name, (x_min, x_max) in bush_windows.items():
    live_window = [
        row for row in rows
        if x_min <= float(row["pose_x"]) <= x_max
    ]
    decision_window = [
        row for row in decision_rows
        if x_min <= float(row.get("pose_x") or 0.0) <= x_max
    ]
    obstacle_rows = [
        row for row in decision_window
        if row.get("obstacle_ahead") == "1"
    ]
    slow_rows = [
        row for row in live_window
        if abs(float(row["cmd_linear_x"])) <= 0.55
        and row["decision"] in ("OBSTACLE_AHEAD", "SOFT_TRAVERSABLE")
    ]
    corridor_hits = [
        row for row in decision_window
        if int(float(row.get("corridor_hit_count") or 0)) > 0
    ]
    bush_results[name] = {
        "live_rows": len(live_window),
        "decision_rows": len(decision_window),
        "obstacle_rows": len(obstacle_rows),
        "slow_rows": len(slow_rows),
        "corridor_hit_rows": len(corridor_hits),
    }

print(
    "cycles="
    f"reverse:{reverse_starts},turn:{turn_starts},forward:{forward_starts},"
    f"return:{return_starts},"
    f"completed:{completed_bypasses}"
)
print(f"mode_counts={dict(mode_counts)}")
print(f"decision_counts={dict(decision_counts)}")
print(f"stop_counts={dict(stop_counts)}")
print(
    "final="
    "mode:{mode},decision:{decision},"
    "cmd_linear_x:{cmd_linear_x},cmd_angular_z:{cmd_angular_z},"
    "stop_reason:{stop_reason},pose_delta_x:{pose_delta_x},"
    "pose_y:{pose_y},pose_yaw:{pose_yaw}".format(**final)
)
print(f"max_pose_delta_x={max_pose_delta:.3f}")
print(f"max_abs_pose_y={max_abs_y:.3f}")
print(f"return_rows={len(return_rows)}")
print(f"return_max_abs_angular={return_max_abs_angular:.3f}")
print(f"return_max_abs_yaw={return_max_abs_yaw:.3f}")
print(f"repeatability_exercised={int(reverse_starts >= 2)}")
for name, result in bush_results.items():
    print(f"{name}_detection={result}")

print("transitions=wall_time_s,mode,decision,cmd_linear_x,pose_delta_x,pose_y,pose_yaw,stop_reason")
for row in transitions[:20]:
    print(
        ",".join(
            [
                row["wall_time_s"],
                row["mode"],
                row["decision"],
                row["cmd_linear_x"],
                row["pose_delta_x"],
                row["pose_y"],
                row["pose_yaw"],
                row["stop_reason"],
            ]
        )
    )

passed = (
    reverse_starts >= 1
    and turn_starts >= reverse_starts
    and forward_starts >= reverse_starts
    and return_starts >= reverse_starts
    and completed_bypasses >= reverse_starts
    and return_max_abs_angular <= 0.45
    and return_max_abs_yaw <= 0.70
    and all(
        result["obstacle_rows"] > 0
        and result["slow_rows"] > 0
        and result["corridor_hit_rows"] > 0
        for result in bush_results.values()
    )
    and finish_stop_count == 0
    and hard_stop_count == 0
    and timeout_count == 0
)
if passed:
    print("result=PASS")
else:
    print("result=CHECK")
PY
'
