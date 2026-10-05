#!/usr/bin/env bash
# Build + restart WITHOUT losing your saved settings.
#
# config.json is baked into the image, so a plain `docker compose up -d --build`
# resets it (and every browser's Settings) back to defaults. This script grabs
# the live config out of the container first and puts it back afterwards.
set -euo pipefail
cd "$(dirname "$0")"

CONTAINER=imagegen-comfyui-studio-1
CFG=/tmp/comfyui-studio-config.bak.json

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  if docker exec "$CONTAINER" cat /usr/share/nginx/html/config.json > "$CFG" 2>/dev/null && [ -s "$CFG" ]; then
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
  docker cp "$CFG" "$CONTAINER":/usr/share/nginx/html/config.json
  docker exec "$CONTAINER" chown nginx:nginx /usr/share/nginx/html/config.json
  docker exec "$CONTAINER" chmod 600 /usr/share/nginx/html/config.json
  echo "restored saved config (Settings survive the rebuild)"
fi

docker exec "$CONTAINER" nginx -t
JS=$(curl -s http://localhost:5555/ | grep -oP 'assets/index-[^.]+\.js')
echo "deployed: $JS"
