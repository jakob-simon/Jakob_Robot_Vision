#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export USER_UID="$(id -u)"
export USER_GID="$(id -g)"
export USER="${USER:-$(id -un)}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"

if [[ -z "${ROS_DOMAIN_ID:-}" ]]; then
  export ROS_DOMAIN_ID="$((120 + RANDOM % 50))"
fi
export GZ_PARTITION="${GZ_PARTITION:-live_reaction_hard_gui_$(date +%s)_$$}"
export LIVE_DEMO_TIMEOUT="${LIVE_DEMO_TIMEOUT:-300}"
export GUI_CLEAR_SPEED="${GUI_CLEAR_SPEED:-5.00}"
export GUI_OBSTACLE_SPEED="${GUI_OBSTACLE_SPEED:-3.50}"
export GUI_SOFT_SPEED="${GUI_SOFT_SPEED:-0.35}"
export GUI_HARD_SPEED="${GUI_HARD_SPEED:-0.0}"
export GUI_CORRIDOR_HALF_WIDTH="${GUI_CORRIDOR_HALF_WIDTH:-0.45}"
export GUI_CORRIDOR_LOOK_AHEAD="${GUI_CORRIDOR_LOOK_AHEAD:-2.0}"

if [[ "${SKIP_ROBOT_VISION_CLEANUP:-0}" != "1" ]]; then
  if ! ./scripts/docker_stop_robot_vision.sh; then
    echo
    echo "WARNUNG: Alte Container konnten nicht vollstaendig entfernt werden."
    echo "Die Demo startet trotzdem isoliert mit ROS_DOMAIN_ID=${ROS_DOMAIN_ID} und GZ_PARTITION=${GZ_PARTITION}."
    echo "Wenn der PC langsam bleibt, bitte spaeter den angezeigten sudo-Cleanup ausfuehren."
    echo
  fi
fi

xhost +SI:localuser:"$(id -un)" >/dev/null

docker compose run --rm -e ROS_DOMAIN_ID -e GZ_PARTITION -e LIVE_DEMO_TIMEOUT -e GUI_CLEAR_SPEED -e GUI_OBSTACLE_SPEED -e GUI_SOFT_SPEED -e GUI_HARD_SPEED -e GUI_CORRIDOR_HALF_WIDTH -e GUI_CORRIDOR_LOOK_AHEAD robot-vision bash -lc '
  set -eo pipefail
  source /opt/ros/jazzy/setup.bash
  source /workspace/install/setup.bash
  set -u

  log_dir=/workspace/logs/live_reaction_benchmarks
  mkdir -p "${log_dir}"
  rm -f "${log_dir}/gui_hard_"*.csv 2>/dev/null || true

  setsid ros2 launch ros_gz_lehrforst_sim scout_bumper_hard_benchmark.launch.xml >/tmp/live_reaction_hard_gui_launch.log 2>&1 &
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

  sleep 12
  timeout 30s bash -lc "until ros2 topic list > /tmp/live_reaction_hard_gui_topics.txt && grep -qx /scan /tmp/live_reaction_hard_gui_topics.txt && grep -qx /pose /tmp/live_reaction_hard_gui_topics.txt && grep -qx /scout/force_bar/segment_0 /tmp/live_reaction_hard_gui_topics.txt; do sleep 1; done"

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/force_event_node.py \
    --ros-args \
    -p "label:=gui_hard" \
    -p "log_dir:=${log_dir}" \
    -p "baseline_duration_s:=3.0" \
    -p "threshold_n:=18.0" \
    -p "duration_gate_s:=0.04" \
    -p "peak_window_s:=1.0" &
  event_pid=$!

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/decision_node.py \
    --ros-args \
    -p "label:=gui_hard" \
    -p "log_dir:=${log_dir}" \
    -p "front_angle_deg:=25.0" \
    -p "obstacle_distance_m:=2.0" \
    -p "corridor_half_width_m:=${GUI_CORRIDOR_HALF_WIDTH}" \
    -p "corridor_look_ahead_m:=${GUI_CORRIDOR_LOOK_AHEAD}" \
    -p "hard_force_threshold_n:=3000.0" \
    -p "blocked_progress_threshold_m:=0.15" \
    -p "contact_test_duration_s:=2.0" &
  decision_pid=$!

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/live_reaction_node.py \
    --ros-args \
    -p "label:=gui_hard" \
    -p "log_dir:=${log_dir}" \
    -p "clear_speed:=${GUI_CLEAR_SPEED}" \
    -p "obstacle_speed:=${GUI_OBSTACLE_SPEED}" \
    -p "soft_speed:=${GUI_SOFT_SPEED}" \
    -p "hard_speed:=${GUI_HARD_SPEED}" \
    -p "decision_timeout_s:=2.0" &
  live_pid=$!

  timeout 20s bash -lc "until ros2 topic type /traversability/live_status >/tmp/live_status_type.txt 2>/dev/null && grep -q std_msgs /tmp/live_status_type.txt; do sleep 0.5; done"

  echo
  echo "=== Live-Reaction HARD GUI Demo laeuft ==="
  echo "Gazebo sollte sichtbar sein. ROS_DOMAIN_ID=${ROS_DOMAIN_ID}, GZ_PARTITION=${GZ_PARTITION}"
  echo "Erwartung: Harte Barriere -> HARD_BLOCKED -> Scout stoppt."
  echo "GUI-Speeds: clear=${GUI_CLEAR_SPEED} m/s, obstacle=${GUI_OBSTACLE_SPEED} m/s, soft=${GUI_SOFT_SPEED} m/s"
  echo "LiDAR corridor: half_width=${GUI_CORRIDOR_HALF_WIDTH} m, look_ahead=${GUI_CORRIDOR_LOOK_AHEAD} m"
  if [ "${LIVE_DEMO_TIMEOUT}" = "0" ]; then
    echo "Demo laeuft bis Ctrl+C."
  else
    echo "Demo stoppt automatisch nach ${LIVE_DEMO_TIMEOUT}s. Fuer endlos: LIVE_DEMO_TIMEOUT=0 ./scripts/docker_run_live_reaction_hard.sh"
  fi
  echo "Live-Diagnose: Decision, cmd_vel, Stop-Reason und Pose-Fortschritt."
  echo

  if [ "${LIVE_DEMO_TIMEOUT}" = "0" ]; then
    python3 /workspace/ros_gz_lehrforst_sim/scripts/gui_live_monitor.py --label gui_hard
  else
    set +e
    timeout "${LIVE_DEMO_TIMEOUT}s" python3 /workspace/ros_gz_lehrforst_sim/scripts/gui_live_monitor.py --label gui_hard
    monitor_rc=$?
    set -e
    if [ "${monitor_rc}" -eq 124 ]; then
      echo
      echo "=== Demo-Zeit abgelaufen: stoppe Gazebo und Controller sauber ==="
    elif [ "${monitor_rc}" -ne 0 ]; then
      echo
      echo "=== GUI-Monitor endete mit Code ${monitor_rc}; Cleanup wird trotzdem ausgefuehrt ==="
    fi
  fi
'
