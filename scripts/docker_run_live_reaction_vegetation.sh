#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export USER_UID="$(id -u)"
export USER_GID="$(id -g)"
export USER="${USER:-$(id -un)}"
export XAUTHORITY="${XAUTHORITY:-/run/user/$(id -u)/gdm/Xauthority}"

if [[ -z "${ROS_DOMAIN_ID:-}" ]]; then
  export ROS_DOMAIN_ID="$((70 + RANDOM % 50))"
fi
export GZ_PARTITION="${GZ_PARTITION:-live_reaction_gui_$(date +%s)_$$}"
export LIVE_DEMO_TIMEOUT="${LIVE_DEMO_TIMEOUT:-600}"
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

docker compose run --rm -e ROS_DOMAIN_ID -e GZ_PARTITION -e LIVE_DEMO_TIMEOUT -e GUI_CLEAR_SPEED -e GUI_OBSTACLE_SPEED -e GUI_SOFT_SPEED -e GUI_HARD_SPEED -e GUI_LANE_KEEP_TARGET_Y -e GUI_AVOID_LANE_Y -e GUI_AVOID_REVERSE_SPEED -e GUI_AVOID_REVERSE_DISTANCE -e GUI_AVOID_TURN_SPEED -e GUI_AVOID_TURN_ANGULAR -e GUI_AVOID_TURN_ANGLE -e GUI_AVOID_TURN_MIN_YAW -e GUI_AVOID_FORWARD_SPEED -e GUI_AVOID_FORWARD_CLEAR -e GUI_AVOID_RETURN_SPEED -e GUI_AVOID_RETURN_LATERAL_GAIN -e GUI_AVOID_RETURN_YAW_GAIN -e GUI_AVOID_RETURN_MAX_ANGULAR -e GUI_AVOID_RETURN_HEADING_LIMIT -e GUI_AVOID_RETURN_Y_TOLERANCE -e GUI_AVOID_RETURN_YAW_TOLERANCE -e GUI_AVOID_RETURN_MAX_S -e GUI_CORRIDOR_HALF_WIDTH -e GUI_CORRIDOR_LOOK_AHEAD -e GUI_CONTACT_OBSTACLE_DISTANCE robot-vision bash -lc '
  set -eo pipefail
  source /opt/ros/jazzy/setup.bash
  source /workspace/install/setup.bash
  set -u

  log_dir=/workspace/logs/live_reaction_benchmarks
  mkdir -p "${log_dir}"
  rm -f "${log_dir}/gui_soft_"*.csv 2>/dev/null || true

  setsid ros2 launch ros_gz_lehrforst_sim scout_bumper_vegetation.launch.xml >/tmp/live_reaction_gui_launch.log 2>&1 &
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
  timeout 90s bash -lc "until ros2 topic list > /tmp/live_reaction_gui_topics.txt && grep -qx /scan /tmp/live_reaction_gui_topics.txt && grep -qx /pose /tmp/live_reaction_gui_topics.txt && grep -qx /scout/force_bar/segment_0 /tmp/live_reaction_gui_topics.txt; do sleep 1; done"

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/force_event_node.py \
    --ros-args \
    -p "label:=gui_soft" \
    -p "log_dir:=${log_dir}" \
    -p "baseline_duration_s:=3.0" \
    -p "threshold_n:=18.0" \
    -p "duration_gate_s:=0.04" \
    -p "peak_window_s:=1.0" &
  event_pid=$!

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/decision_node.py \
    --ros-args \
    -p "label:=gui_soft" \
    -p "log_dir:=${log_dir}" \
    -p "front_angle_deg:=25.0" \
    -p "obstacle_distance_m:=0.5" \
    -p "corridor_half_width_m:=${GUI_CORRIDOR_HALF_WIDTH}" \
    -p "corridor_look_ahead_m:=${GUI_CORRIDOR_LOOK_AHEAD}" \
    -p "contact_obstacle_distance_m:=${GUI_CONTACT_OBSTACLE_DISTANCE}" \
    -p "hard_force_threshold_n:=5000.0" \
    -p "blocked_progress_threshold_m:=0.25" \
    -p "contact_test_duration_s:=2.0" \
    -p "new_contact_progress_reset_m:=0.30" &
  decision_pid=$!

  python3 /workspace/install/ros_gz_lehrforst_sim/share/ros_gz_lehrforst_sim/scripts/live_reaction_node.py \
    --ros-args \
    -p "label:=gui_soft" \
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
    -p "finish_stop_enabled:=false" &
  live_pid=$!

  timeout 20s bash -lc "until ros2 topic type /traversability/live_status >/tmp/live_status_type.txt 2>/dev/null && grep -q std_msgs /tmp/live_status_type.txt; do sleep 0.5; done"

  echo
  echo "=== Live-Reaction GUI Demo laeuft ==="
  echo "Gazebo sollte sichtbar sein. ROS_DOMAIN_ID=${ROS_DOMAIN_ID}, GZ_PARTITION=${GZ_PARTITION}"
  echo "Erwartung: freie Strecke schnell, ca. 0.5 m vor Objekt langsam (LiDAR), Buschkontakt langsam weiter (Force)."
  echo "Erwartung danach: Baumkontakt -> HARD_BLOCKED -> zurueck -> Linkskurve -> weiter; naechster Baum wird erneut behandelt."
  echo "GUI-Speeds: clear=${GUI_CLEAR_SPEED} m/s, obstacle=${GUI_OBSTACLE_SPEED} m/s, soft=${GUI_SOFT_SPEED} m/s"
  echo "LiDAR corridor: half_width=${GUI_CORRIDOR_HALF_WIDTH} m, look_ahead=${GUI_CORRIDOR_LOOK_AHEAD} m"
  echo "Lane keeping: target_y=${GUI_LANE_KEEP_TARGET_Y}, avoid_lane_y=${GUI_AVOID_LANE_Y}"
  echo "Return: speed=${GUI_AVOID_RETURN_SPEED} m/s, max_angular=${GUI_AVOID_RETURN_MAX_ANGULAR} rad/s"
  if [ "${LIVE_DEMO_TIMEOUT}" = "0" ]; then
    echo "Demo laeuft bis Ctrl+C."
  else
    echo "Demo stoppt automatisch nach ${LIVE_DEMO_TIMEOUT}s. Fuer endlos: LIVE_DEMO_TIMEOUT=0 ./scripts/docker_run_live_reaction_vegetation.sh"
  fi
  echo "Live-Diagnose: Decision, cmd_vel, Stop-Reason und Pose-Fortschritt."
  echo

  if [ "${LIVE_DEMO_TIMEOUT}" = "0" ]; then
    python3 /workspace/ros_gz_lehrforst_sim/scripts/gui_live_monitor.py --label gui_soft
  else
    set +e
    timeout "${LIVE_DEMO_TIMEOUT}s" python3 /workspace/ros_gz_lehrforst_sim/scripts/gui_live_monitor.py --label gui_soft
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
