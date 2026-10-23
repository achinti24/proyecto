#!/usr/bin/env bash
# Recrea el contenedor de n8n de EventPass. Los datos viven en el volumen n8n_data.
# Uso: PUBLIC_URL=https://mi-dominio.ngrok-free.app ./scripts/n8n-up.sh
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-http://localhost:5678}"

docker rm -f n8n >/dev/null 2>&1 || true
docker run -d --name n8n --restart unless-stopped \
  -p 5678:5678 \
  -v n8n_data:/home/node/.n8n:Z \
  -e GENERIC_TIMEZONE=America/Bogota \
  -e TZ=America/Bogota \
  -e NODE_FUNCTION_ALLOW_BUILTIN=crypto \
  -e N8N_PROXY_HOPS=1 \
  -e N8N_EDITOR_BASE_URL=http://localhost:5678 \
  -e WEBHOOK_URL="${PUBLIC_URL%/}/" \
  docker.n8n.io/n8nio/n8n

echo "n8n arrancando: editor http://localhost:5678 | webhooks ${PUBLIC_URL%/}/"
