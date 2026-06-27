#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Alte Projektcontainer sammeln: sowohl ueber das Compose-Projekt als auch ueber
# das Projektimage, dann deduplizieren. So werden auch verwaiste alte
# `docker compose run`-Container dieses Projekts sicher erfasst.
mapfile -t compose_ids < <(docker compose ps -aq 2>/dev/null | sed '/^$/d')
mapfile -t image_ids < <(docker ps -aq --filter ancestor=robot-vision-jazzy:latest 2>/dev/null | sed '/^$/d')
# Auf 12-stellige Kurz-IDs normalisieren, weil `docker compose ps -aq` lange und
# `docker ps -aq` kurze IDs liefert; sonst werden gleiche Container doppelt gezaehlt.
mapfile -t container_ids < <(printf '%s\n' "${compose_ids[@]}" "${image_ids[@]}" | sed '/^$/d' | cut -c1-12 | sort -u)

# Versucht zuerst ohne sudo, dann automatisch mit sudo (einmalige Passwortabfrage
# moeglich). Auf diesem PC ist `docker rm/stop` ohne sudo gesperrt, deshalb ist
# der sudo-Fallback noetig, damit die GUI-Demo mit einem einzigen Befehl sauber
# startet.
remove_containers() {
  if docker rm -f "$@" >/tmp/robot_vision_cleanup.log 2>&1; then
    echo "Alte Container ohne sudo entfernt."
    return 0
  fi
  echo "Entfernen ohne sudo nicht moeglich; versuche es mit sudo (Passwort kann abgefragt werden)..."
  if sudo docker rm -f "$@" >/tmp/robot_vision_cleanup.log 2>&1; then
    echo "Alte Container mit sudo entfernt."
    return 0
  fi
  cat /tmp/robot_vision_cleanup.log >&2
  echo >&2
  echo "Cleanup konnte mindestens einen alten Projektcontainer nicht entfernen." >&2
  echo "Manueller Befehl:" >&2
  echo "  sudo docker rm -f $*" >&2
  return 1
}

if ((${#container_ids[@]} == 0)); then
  echo "Keine alten robot-vision Container gefunden."
else
  echo "Stoppe/entferne ${#container_ids[@]} alte robot-vision Container..."
  remove_containers "${container_ids[@]}" || exit 1
fi

docker compose down --remove-orphans >/dev/null 2>&1 \
  || sudo docker compose down --remove-orphans >/dev/null 2>&1 \
  || true

mapfile -t still_running < <(docker ps -q --filter ancestor=robot-vision-jazzy:latest 2>/dev/null | sed '/^$/d')
if ((${#still_running[@]} > 0)); then
  echo "Nach Cleanup laufen noch Robot-Vision-Container:" >&2
  docker ps --filter ancestor=robot-vision-jazzy:latest >&2 || true
  echo "Bitte diese Container mit sudo/Admin-Rechten stoppen, sonst kann die GUI-Demo weiter blockiert werden." >&2
  exit 1
fi

echo "Robot-Vision Docker-Cleanup abgeschlossen."
