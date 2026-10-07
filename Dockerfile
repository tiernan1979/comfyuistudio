# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Reproducible installs from the lockfile (GitHub Actions builds the same way)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Shared settings file (config.json). It lives OUTSIDE the html root and
# is served at /config.json via nginx `root /configdir` (WebDAV PUT lets
# Settings → Save write it back). docker-compose mounts a named volume at
# /configdir so the saved settings survive rebuilds and image pulls —
# mounting a named volume directly on a file path isn't supported by
# Docker, hence the dedicated directory.
COPY --from=build /app/dist/config.json /configdir/config.json
RUN rm /usr/share/nginx/html/config.json \
 && chmod 777 /configdir

# Nginx config with dynamic /proxy/<host>/<port>/... reverse proxy.
# The ComfyUI backend is taken from the Server URL saved in the web UI.
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
