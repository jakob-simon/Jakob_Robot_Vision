#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export USER_UID="$(id -u)"
export USER_GID="$(id -g)"
export USER="${USER:-$(id -un)}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-43}"
export GZ_PARTITION="${GZ_PARTITION:-scout_verify_$(date +%s)}"

docker compose run --rm -e ROS_DOMAIN_ID -e GZ_PARTITION robot-vision bash -lc '
  set -eo pipefail
  source /opt/ros/jazzy/setup.bash
  source /workspace/install/setup.bash
  set -u

  ros2 launch ros_gz_lehrforst_sim scout_bumper_headless.launch.xml >/tmp/scout_headless.log 2>&1 &
  launch_pid=$!

  cleanup() {
    kill -TERM "${launch_pid}" >/dev/null 2>&1 || true
    wait "${launch_pid}" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  wait_for_topic_type() {
    local topic="$1"
    local timeout_s="$2"
    local started
    started="$(date +%s)"
    until ros2 topic type "${topic}" >/tmp/topic_type.txt 2>/dev/null && grep -q . /tmp/topic_type.txt; do
      if [ "$(( $(date +%s) - started ))" -ge "${timeout_s}" ]; then
        echo "Timed out waiting for topic type: ${topic}" >&2
        return 1
      fi
      sleep 1
    done
  }

  sleep 15

  echo "=== ROS topics ==="
  ros2 topic list | sort

  echo
  echo "=== Odom before motion ==="
  wait_for_topic_type /odom 30
  timeout 8s ros2 topic echo /odom --once

  echo
  echo "=== Force segment sample ==="
  wait_for_topic_type /scout/force_bar/segment_0 30
  timeout 8s ros2 topic echo /scout/force_bar/segment_0 --once

  echo
  echo "=== LiDAR /scan sample ==="
  wait_for_topic_type /scan 30
  timeout 8s ros2 topic echo /scan --once

  echo
  echo "=== LiDAR /lidar/points info ==="
  wait_for_topic_type /lidar/points 30
  ros2 topic info /lidar/points -v

  echo
  echo "=== LiDAR /lidar/points sample ==="
  timeout 8s ros2 topic echo /lidar/points --once --no-arr

  echo
  echo "=== LiDAR TF sample ==="
  timeout 8s ros2 run tf2_ros tf2_echo scout/chassis scout/lidar_link/lidar_sensor || true

  echo
  echo "=== Publishing forward cmd_vel for 3 seconds ==="
  timeout 3s ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.25}, angular: {z: 0.0}}" || true

  sleep 1

  echo
  echo "=== Odom after motion ==="
  wait_for_topic_type /odom 30
  timeout 8s ros2 topic echo /odom --once

  echo
  echo "=== Relevant launch log tail ==="
  grep -E "Creating .*Bridge|World \\[|DiffDrive|ForceTorque|Passing message" /tmp/scout_headless.log | tail -n 40 || true
'
