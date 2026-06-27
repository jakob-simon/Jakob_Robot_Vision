#!/usr/bin/env bash
set -eo pipefail

source /opt/ros/jazzy/setup.bash || true

for attempt in $(seq 1 30); do
  if gz service \
    -s /world/scout_lehrforst/control \
    --reqtype gz.msgs.WorldControl \
    --reptype gz.msgs.Boolean \
    --timeout 3000 \
    --req "pause: false" >/dev/null; then
    echo "Unpaused scout_lehrforst world on attempt ${attempt}."
    exit 0
  fi

  sleep 1
done

echo "Warning: could not unpause scout_lehrforst world automatically." >&2
