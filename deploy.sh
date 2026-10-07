#!/usr/bin/env bash
# Build + restart WITHOUT losing your saved settings.
#
# config.json now lives in the `studio-config` docker volume
# (/configdir/config.json), so rebuilds keep it automatically. This
# script still backs it up first — it covers the one-time migration from
# the old in-image location and any stack running without the volume.
set -euo pipefail
cd "$(dirname "$0")"

CONTAINER=imagegen-comfyui-studio-1
CFG=/tmp/comfyui-studio-config.bak.json

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  # New layout first (/configdir, volume-backed), old layout as fallback
  # (config baked under the html root, pre-volume images).
  if docker exec "$CONTAINER" sh -c 'cat /configdir/config.json 2>/dev/null || cat /usr/share/nginx/html/config.json 2>/dev/null' > "$CFG" && [ -s "$CFG" ]; then
    echo "backed up live config -> $CFG"
  else
    echo "no live config to back up"
    CFG=""
  fi
else
  echo "container not running yet — nothing to back up"
  CFG=""
fi

docker compose build
docker compose up -d

if [ -n "$CFG" ] && [ -s "$CFG" ]; then
  # Write to both locations: /configdir is what the new nginx serves
  # (and lands in the volume), the html copy keeps older images working.
  docker cp "$CFG" "$CONTAINER":/configdir/config.json
  docker cp "$CFG" "$CONTAINER":/usr/share/nginx/html/config.json 2>/dev/null || true
  docker exec "$CONTAINER" sh -c 'chmod 777 /configdir && chown nginx:nginx /configdir/config.json /usr/share/nginx/html/config.json 2>/dev/null || true'
  echo "restored saved config (Settings survive the rebuild)"
fi

docker exec "$CONTAINER" nginx -t
JS=$(curl -s http://localhost:5555/ | grep -oP 'assets/index-[^.]+\.js')
echo "deployed: $JS"
