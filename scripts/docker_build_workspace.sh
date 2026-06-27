#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export USER_UID="$(id -u)"
export USER_GID="$(id -g)"
export USER="${USER:-$(id -un)}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"

docker compose run --rm robot-vision bash -lc '
  source /opt/ros/jazzy/setup.bash
  rosdep update
  rosdep install --from-paths ros_gz_lehrforst_sim --ignore-src -r -y
  colcon build --symlink-install
'
