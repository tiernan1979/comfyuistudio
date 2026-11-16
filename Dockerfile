# Stage 1: Build
FROM node:26-alpine AS build

WORKDIR /app

# Reproducible installs from the lockfile (GitHub Actions builds the same way)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

# htpasswd powers the optional STUDIO_AUTH_USER / STUDIO_AUTH_PASSWORD
# basic-auth gate. The include files must exist even when auth is unused.
RUN apk add --no-cache apache2-utils \
 && mkdir -p /etc/nginx/studio \
 && touch /etc/nginx/studio/studio-auth.conf /etc/nginx/studio/studio-api-key.conf \
 && printf 'proxy_ssl_verify on;\nproxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;\nproxy_ssl_verify_depth 3;\n' > /etc/nginx/studio/studio-proxy-tls.conf

# Optional runtime hardening: writes the auth/API-key includes before nginx
# starts. The nginx image runs every /docker-entrypoint.d/*.sh script.
COPY docker/studio-auth.sh /docker-entrypoint.d/40-studio-auth.sh
RUN chmod +x /docker-entrypoint.d/40-studio-auth.sh

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
