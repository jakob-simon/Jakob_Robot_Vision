#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export USER_UID="$(id -u)"
export USER_GID="$(id -g)"
export USER="${USER:-$(id -un)}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-51}"
export GZ_PARTITION="${GZ_PARTITION:-force_benchmark_$(date +%s)}"

docker compose run --rm -e ROS_DOMAIN_ID -e GZ_PARTITION robot-vision bash -lc '
  set -eo pipefail
  source /opt/ros/jazzy/setup.bash
  source /workspace/install/setup.bash
  set -u

  log_dir=/workspace/logs/force_benchmarks
  mkdir -p "${log_dir}"

  run_case() {
    local label="$1"
    local launch_file="$2"
    local drive_seconds="$3"
    local drive_speed="$4"

    echo
    echo "=== ${label}: starting ${launch_file} ==="
    rm -f "${log_dir}/${label}_"*.csv
    export GZ_PARTITION="force_benchmark_${label}_$(date +%s)"

    setsid ros2 launch ros_gz_lehrforst_sim "${launch_file}" >"/tmp/${label}_launch.log" 2>&1 &
    local launch_pid=$!

    cleanup_case() {
      timeout 2s ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.0}, angular: {z: 0.0}}" >/dev/null 2>&1 || true
      kill -TERM "${event_pid:-}" >/dev/null 2>&1 || true
      wait "${event_pid:-}" >/dev/null 2>&1 || true
      kill -TERM "-${launch_pid}" >/dev/null 2>&1 || true
      kill -TERM "${launch_pid}" >/dev/null 2>&1 || true
      wait "${launch_pid}" >/dev/null 2>&1 || true
    }
    trap cleanup_case RETURN

    sleep 12
    timeout 25s bash -lc "until ros2 topic list > /tmp/${label}_topics.txt && grep -qx /scout/force_bar/segment_0 /tmp/${label}_topics.txt && grep -qx /odom /tmp/${label}_topics.txt; do sleep 1; done"

    python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/force_event_node.py \
      --ros-args \
      -p "label:=${label}" \
      -p "log_dir:=${log_dir}" \
      -p "baseline_duration_s:=3.0" \
      -p "threshold_n:=18.0" \
      -p "duration_gate_s:=0.04" \
      -p "peak_window_s:=1.0" \
      >"/tmp/${label}_force_event.log" 2>&1 &
    event_pid=$!

    echo "=== ${label}: baseline ==="
    timeout 2s ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.0}, angular: {z: 0.0}}" >/dev/null 2>&1 || true
    sleep 4

    echo "=== ${label}: driving ${drive_speed} m/s for ${drive_seconds}s ==="
    timeout "${drive_seconds}s" ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: ${drive_speed}}, angular: {z: 0.0}}" >/tmp/${label}_cmd.log 2>&1 || true
    timeout 2s ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.0}, angular: {z: 0.0}}" >/dev/null 2>&1 || true
    sleep 2

    cleanup_case
    trap - RETURN

    echo "=== ${label}: node log tail ==="
    tail -20 "/tmp/${label}_force_event.log" || true
  }

  run_case soft scout_bumper_vegetation_headless.launch.xml 24 0.40
  run_case hard scout_bumper_hard_benchmark_headless.launch.xml 18 0.40

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/summarize_force_benchmark.py \
    --log-dir "${log_dir}" \
    --threshold 80.0 \
    soft hard
'
