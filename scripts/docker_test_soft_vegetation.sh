#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export USER_UID="$(id -u)"
export USER_GID="$(id -g)"
export USER="${USER:-$(id -un)}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-45}"
export GZ_PARTITION="${GZ_PARTITION:-soft_vegetation_contact_$(date +%s)}"

docker compose run --rm -e ROS_DOMAIN_ID -e GZ_PARTITION robot-vision bash -lc '
  set -eo pipefail
  source /opt/ros/jazzy/setup.bash
  source /workspace/install/setup.bash
  set -u

  ros2 launch ros_gz_lehrforst_sim scout_bumper_vegetation_headless.launch.xml >/tmp/soft_vegetation_contact.log 2>&1 &
  launch_pid=$!

  cleanup() {
    kill -TERM "${launch_pid}" >/dev/null 2>&1 || true
    wait "${launch_pid}" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  sleep 10
  timeout 20s bash -lc "until ros2 topic list > /tmp/soft_vegetation_topics.txt && grep -qx /scout/force_bar/segment_2 /tmp/soft_vegetation_topics.txt; do sleep 1; done"
  timeout 20s bash -lc "until ros2 topic list > /tmp/soft_vegetation_topics.txt && grep -qx /odom /tmp/soft_vegetation_topics.txt; do sleep 1; done"

  echo "=== Gazebo models ==="
  gz model --list

  echo
  echo "=== Contact field link count ==="
  gz model -m soft_vegetation_contact_field -l | grep -c "contact_bush_" || true

  echo
  echo "=== First contact bush pose before contact ==="
  gz model -m soft_vegetation_contact_field -l contact_bush_000 | grep -E "Name:|Pose|\\[" | head -14

  echo
  echo "=== Center force segment before contact ==="
  timeout 8s ros2 topic echo /scout/force_bar/segment_2 --once || echo "No force message before contact."

  echo
  echo "=== Driving into soft vegetation for 18 seconds ==="
  timeout 18s ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.40}, angular: {z: 0.0}}" >/tmp/soft_vegetation_cmd.log 2>&1 || true

  sleep 1

  echo
  echo "=== Odom after soft vegetation drive ==="
  timeout 8s ros2 topic echo /odom --once --no-arr || echo "No odom message received after drive."

  echo
  echo "=== Center force segment after/contact ==="
  timeout 8s ros2 topic echo /scout/force_bar/segment_2 --once || echo "No force message received after drive."

  echo
  echo "=== First contact bush pose after contact ==="
  gz model -m soft_vegetation_contact_field -l contact_bush_000 | grep -E "Name:|Pose|\\[" | head -14

  echo
  echo "=== Relevant launch warnings ==="
  grep -Ei "soft_vegetation|bush_|error|warn" /tmp/soft_vegetation_contact.log | tail -80 || true
'
