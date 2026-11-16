#!/bin/sh
# Optional hardening for the Studio container. Runs before nginx starts
# (the nginx image executes /docker-entrypoint.d/*.sh in order).
#
# Both features are opt-in:
#   STUDIO_AUTH_USER + STUDIO_AUTH_PASSWORD -> HTTP basic auth on the app
#   STUDIO_API_KEY                          -> key forwarded to studio-api
#
# The include files must exist even when the features are off, otherwise
# nginx refuses to start on a missing include.
set -eu

AUTH_DIR=/etc/nginx/studio
mkdir -p "$AUTH_DIR"
: > "$AUTH_DIR/studio-auth.conf"
: > "$AUTH_DIR/studio-api-key.conf"

if [ -n "${STUDIO_AUTH_USER:-}" ] && [ -n "${STUDIO_AUTH_PASSWORD:-}" ]; then
  htpasswd -nbm "$STUDIO_AUTH_USER" "$STUDIO_AUTH_PASSWORD" > /etc/nginx/.htpasswd
  cat > "$AUTH_DIR/studio-auth.conf" <<'EOF'
auth_basic "ComfyUI Studio";
auth_basic_user_file /etc/nginx/.htpasswd;
EOF
  echo "[studio-auth] basic auth enabled for user: $STUDIO_AUTH_USER"
fi

if [ -n "${STUDIO_API_KEY:-}" ]; then
  # Escape backslashes/quotes and drop newlines so the value cannot break
  # the generated nginx directive.
  key=$(printf '%s' "$STUDIO_API_KEY" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf 'proxy_set_header X-Api-Key "%s";\n' "$key" > "$AUTH_DIR/studio-api-key.conf"
  echo "[studio-auth] API key forwarded to studio-api"
fi

# The /proxy/https/ location verifies upstream certificates by default.
# Internal services with self-signed certs can opt out explicitly:
#   STUDIO_PROXY_INSECURE=1
if [ "${STUDIO_PROXY_INSECURE:-}" = "1" ]; then
  printf 'proxy_ssl_verify off;\n' > "$AUTH_DIR/studio-proxy-tls.conf"
  echo "[studio-auth] WARNING: upstream HTTPS certificate verification disabled"
else
  cat > "$AUTH_DIR/studio-proxy-tls.conf" <<'EOF'
proxy_ssl_verify on;
proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
proxy_ssl_verify_depth 3;
EOF
fi
