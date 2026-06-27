#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export USER_UID="$(id -u)"
export USER_GID="$(id -g)"
export USER="${USER:-$(id -un)}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-52}"
export GZ_PARTITION="${GZ_PARTITION:-decision_benchmark_$(date +%s)}"

docker compose run --rm -e ROS_DOMAIN_ID -e GZ_PARTITION robot-vision bash -lc '
  set -eo pipefail
  source /opt/ros/jazzy/setup.bash
  source /workspace/install/setup.bash
  set -u

  log_dir=/workspace/logs/decision_benchmarks
  mkdir -p "${log_dir}"

  run_case() {
    local label="$1"
    local launch_file="$2"
    local drive_seconds="$3"
    local drive_speed="$4"

    echo
    echo "=== ${label}: starting ${launch_file} ==="
    rm -f "${log_dir}/${label}_"*.csv
    export GZ_PARTITION="decision_benchmark_${label}_$(date +%s)"

    setsid ros2 launch ros_gz_lehrforst_sim "${launch_file}" >"/tmp/${label}_decision_launch.log" 2>&1 &
    local launch_pid=$!

    cleanup_case() {
      timeout 2s ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.0}, angular: {z: 0.0}}" >/dev/null 2>&1 || true
      kill -TERM "${decision_pid:-}" >/dev/null 2>&1 || true
      wait "${decision_pid:-}" >/dev/null 2>&1 || true
      kill -TERM "${event_pid:-}" >/dev/null 2>&1 || true
      wait "${event_pid:-}" >/dev/null 2>&1 || true
      kill -TERM "-${launch_pid}" >/dev/null 2>&1 || true
      kill -TERM "${launch_pid}" >/dev/null 2>&1 || true
      wait "${launch_pid}" >/dev/null 2>&1 || true
    }
    trap cleanup_case RETURN

    sleep 12
    timeout 25s bash -lc "until ros2 topic list > /tmp/${label}_decision_topics.txt && grep -qx /scan /tmp/${label}_decision_topics.txt && grep -qx /pose /tmp/${label}_decision_topics.txt && grep -qx /scout/force_bar/segment_0 /tmp/${label}_decision_topics.txt; do sleep 1; done"

    python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/force_event_node.py \
      --ros-args \
      -p "label:=${label}" \
      -p "log_dir:=${log_dir}" \
      -p "baseline_duration_s:=3.0" \
      -p "threshold_n:=18.0" \
      -p "duration_gate_s:=0.04" \
      -p "peak_window_s:=1.0" \
      >"/tmp/${label}_decision_force_event.log" 2>&1 &
    event_pid=$!

    python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/decision_node.py \
      --ros-args \
      -p "label:=${label}" \
      -p "log_dir:=${log_dir}" \
      -p "corridor_half_width_m:=0.45" \
      -p "corridor_look_ahead_m:=2.0" \
      -p "hard_force_threshold_n:=5000.0" \
      -p "blocked_progress_threshold_m:=0.15" \
      -p "contact_test_duration_s:=2.0" \
      >"/tmp/${label}_decision_node.log" 2>&1 &
    decision_pid=$!

    echo "=== ${label}: baseline ==="
    timeout 2s ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.0}, angular: {z: 0.0}}" >/dev/null 2>&1 || true
    sleep 4

    echo "=== ${label}: driving ${drive_speed} m/s for ${drive_seconds}s ==="
    timeout "${drive_seconds}s" ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: ${drive_speed}}, angular: {z: 0.0}}" >/tmp/${label}_decision_cmd.log 2>&1 || true
    timeout 2s ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.0}, angular: {z: 0.0}}" >/dev/null 2>&1 || true
    sleep 2

    echo "=== ${label}: latest decision ==="
    timeout 5s ros2 topic echo /traversability/decision --once || true

    cleanup_case
    trap - RETURN

    echo "=== ${label}: force-event node log tail ==="
    tail -10 "/tmp/${label}_decision_force_event.log" || true
    echo "=== ${label}: decision node log tail ==="
    tail -10 "/tmp/${label}_decision_node.log" || true
  }

  run_case soft scout_bumper_vegetation_headless.launch.xml 24 0.40
  run_case hard scout_bumper_hard_benchmark_headless.launch.xml 18 0.40

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/summarize_decision_benchmark.py \
    --log-dir "${log_dir}" \
    soft hard
'
