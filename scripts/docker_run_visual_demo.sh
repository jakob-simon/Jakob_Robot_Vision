#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export LIVE_DEMO_TIMEOUT="${LIVE_DEMO_TIMEOUT:-600}"
export RUN_HARD_GUI="${RUN_HARD_GUI:-0}"

echo
echo "=== Robot Vision VISUELLE Demo ==="
echo "Dieser Befehl startet direkt Gazebo-GUI, ohne vorherigen Headless-Benchmark."
echo "Standard: nur eine Simulation, naemlich Lehrforst/Vegetation."
echo "Der harte Gegenstand ist dabei der Baumstamm im Wald, nicht ein separater Holzklotz."
echo "GUI-Demo-Zeit: ${LIVE_DEMO_TIMEOUT}s"
echo "Standard ist absichtlich lang, weil Gazebo auf diesem PC langsam laedt/laeuft."
echo

if [[ -z "${DISPLAY:-}" ]]; then
  echo "WARNUNG: DISPLAY ist leer. Dann kann kein Gazebo-Fenster angezeigt werden."
  echo "Bitte in einem normalen Desktop-Terminal starten, nicht in einer SSH/Remote-Shell ohne X11."
  echo
else
  echo "DISPLAY=${DISPLAY}"
fi

echo "Erlaube Docker kurz Zugriff auf dein lokales X11-Fenster..."
xhost +SI:localuser:"$(id -un)" >/dev/null

if ! ./scripts/docker_stop_robot_vision.sh; then
  echo
  echo "WARNUNG: Alte Container konnten nicht vollstaendig entfernt werden."
  echo "Die visuelle Demo startet trotzdem isoliert mit frischen ROS-Domains."
  echo
fi

echo
echo "=== Lehrforst-GUI-Demo startet jetzt ==="
echo "Jetzt sollte ein Gazebo-Fenster sichtbar werden."
echo
SKIP_ROBOT_VISION_CLEANUP=1 LIVE_DEMO_TIMEOUT="${LIVE_DEMO_TIMEOUT}" \
  ./scripts/docker_run_live_reaction_vegetation.sh

if [[ "${RUN_HARD_GUI}" = "1" ]]; then
  echo
  echo "=== Optionale Holzklotz-Hard-GUI-Demo startet jetzt ==="
  echo "Nur fuer technischen Vergleich; fuer die Praesentation normalerweise nicht noetig."
  echo
  SKIP_ROBOT_VISION_CLEANUP=1 LIVE_DEMO_TIMEOUT="${LIVE_DEMO_TIMEOUT}" \
    ./scripts/docker_run_live_reaction_hard.sh
fi

echo
echo "=== Visuelle Demo beendet ==="
