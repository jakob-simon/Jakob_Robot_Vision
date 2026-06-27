#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export LIVE_DEMO_TIMEOUT="${LIVE_DEMO_TIMEOUT:-600}"
export RUN_BUILD="${RUN_BUILD:-1}"
export RUN_HEADLESS_BENCHMARK="${RUN_HEADLESS_BENCHMARK:-1}"
export RUN_SOFT_GUI="${RUN_SOFT_GUI:-1}"
export RUN_HARD_GUI="${RUN_HARD_GUI:-0}"

echo
echo "=== Robot Vision Komplett-Demo ==="
echo "Ablauf:"
echo "  1. alte Projektcontainer stoppen, falls moeglich"
echo "  2. Workspace bauen"
echo "  3. automatischer Soft/Hard-Benchmark"
echo "  4. sichtbare Soft-GUI-Demo"
echo "  5. optionale Holzklotz-Hard-GUI-Demo nur mit RUN_HARD_GUI=1"
echo
echo "GUI-Demo-Zeit je Fall: ${LIVE_DEMO_TIMEOUT}s"
echo "Endlos-GUI waere moeglich mit: LIVE_DEMO_TIMEOUT=0 ./scripts/docker_run_complete_demo.sh"
echo

if ! ./scripts/docker_stop_robot_vision.sh; then
  echo
  echo "WARNUNG: Alte Container konnten nicht vollstaendig entfernt werden."
  echo "Die Tests laufen trotzdem mit frischen ROS-Domains weiter."
  echo "Wenn Docker oben einen sudo-Befehl angezeigt hat, spaeter einmal ausfuehren."
  echo
fi

if [[ "${RUN_BUILD}" = "1" ]]; then
  echo
  echo "=== Schritt 1/4: Workspace bauen ==="
  ./scripts/docker_build_workspace.sh
else
  echo
  echo "=== Schritt 1/4: Workspace-Build uebersprungen ==="
fi

if [[ "${RUN_HEADLESS_BENCHMARK}" = "1" ]]; then
  headless_domain="$((170 + RANDOM % 50))"
  echo
  echo "=== Schritt 2/4: Automatischer Live-Reaction-Benchmark ==="
  echo "ROS_DOMAIN_ID=${headless_domain}"
  ROS_DOMAIN_ID="${headless_domain}" ./scripts/docker_test_live_reaction.sh
else
  echo
  echo "=== Schritt 2/4: Headless-Benchmark uebersprungen ==="
fi

if [[ "${RUN_SOFT_GUI}" = "1" ]]; then
  echo
  echo "=== Schritt 3/4: Sichtbare Soft-Vegetationsdemo ==="
  echo "Erwartung: Scout faehrt durch weiche Vegetation weiter."
  SKIP_ROBOT_VISION_CLEANUP=1 LIVE_DEMO_TIMEOUT="${LIVE_DEMO_TIMEOUT}" \
    ./scripts/docker_run_live_reaction_vegetation.sh
else
  echo
  echo "=== Schritt 3/4: Soft-GUI uebersprungen ==="
fi

if [[ "${RUN_HARD_GUI}" = "1" ]]; then
  echo
  echo "=== Schritt 4/4: Sichtbare Hard-Barrier-Demo ==="
  echo "Erwartung: Scout faehrt los und stoppt nach HARD_BLOCKED."
  SKIP_ROBOT_VISION_CLEANUP=1 LIVE_DEMO_TIMEOUT="${LIVE_DEMO_TIMEOUT}" \
    ./scripts/docker_run_live_reaction_hard.sh
else
  echo
  echo "=== Schritt 4/4: Holzklotz-Hard-GUI uebersprungen (Standard) ==="
fi

echo
echo "=== Komplett-Demo beendet ==="
