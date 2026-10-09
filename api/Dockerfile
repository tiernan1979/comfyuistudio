# ComfyUI Studio — REST API service (port 5557).
# Reuses the app's workflow builders + ComfyUI client from src/lib/.
FROM node:20-alpine

WORKDIR /app

COPY api/package.json ./api/package.json
RUN cd api && npm install --omit=dev --no-audit --no-fund

COPY src/lib/workflows.js ./src/lib/workflows.js
COPY src/lib/comfyui.js ./src/lib/comfyui.js
COPY src/lib/threed.js ./src/lib/threed.js
COPY src/lib/hybridSkin.js ./src/lib/hybridSkin.js
COPY api/src ./api/src

ENV NODE_ENV=production \
    PORT=5557 \
    COMFYUI_URL=http://10.1.1.102:8188 \
    DATA_DIR=/app/data

EXPOSE 5557

CMD ["node", "api/src/server.js"]
