# ComfyUI Studio — REST API service (port 5557).
# Reuses the app's workflow builders + ComfyUI client from src/lib/.
FROM node:20-alpine

WORKDIR /app

COPY api/package.json api/package-lock.json ./api/
RUN cd api && npm ci --omit=dev --no-audit --no-fund

COPY src/lib/workflows ./src/lib/workflows
COPY src/lib/comfyui ./src/lib/comfyui
COPY src/lib/threed ./src/lib/threed
COPY src/lib/hybridSkin ./src/lib/hybridSkin
COPY src/lib/llm ./src/lib/llm
COPY src/lib/parts.js ./src/lib/parts.js
COPY src/lib/expressions.js ./src/lib/expressions.js
COPY src/lib/modelFamily.js ./src/lib/modelFamily.js
COPY src/lib/workflows.js ./src/lib/workflows.js
COPY src/lib/comfyui.js ./src/lib/comfyui.js
COPY src/lib/threed.js ./src/lib/threed.js
COPY src/lib/hybridSkin.js ./src/lib/hybridSkin.js
COPY src/lib/llm.js ./src/lib/llm.js
COPY api/src ./api/src

ENV NODE_ENV=production \
    PORT=5557 \
    HOST=0.0.0.0 \
    COMFYUI_URL=http://10.1.1.102:8188 \
    DATA_DIR=/app/data

EXPOSE 5557

CMD ["node", "api/src/server.js"]
