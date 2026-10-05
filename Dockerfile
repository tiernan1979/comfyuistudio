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

# WebDAV PUT of /config.json writes a temp file in this directory as the
# unprivileged nginx worker — keep the directory writable
RUN chmod 777 /usr/share/nginx/html

# Nginx config with dynamic /proxy/<host>/<port>/... reverse proxy.
# The ComfyUI backend is taken from the Server URL saved in the web UI.
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
