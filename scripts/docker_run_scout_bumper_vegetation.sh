#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export USER_UID="$(id -u)"
export USER_GID="$(id -g)"
export USER="${USER:-$(id -un)}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"

xhost +SI:localuser:"$(id -un)" >/dev/null

docker compose run --rm robot-vision bash -lc '
  source /opt/ros/jazzy/setup.bash
  source /workspace/install/setup.bash
  ros2 launch ros_gz_lehrforst_sim scout_bumper_vegetation.launch.xml
'
