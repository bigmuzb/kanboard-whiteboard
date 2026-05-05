#!/usr/bin/env bash
set -euo pipefail

echo "=== Kanboard Whiteboard Setup ==="
echo ""

# Check for docker
if ! command -v docker &>/dev/null; then
  echo "Error: docker is not installed." >&2
  exit 1
fi

# Prompt for brand name
read -rp "Brand name [Kanboard Whiteboard]: " BRAND_NAME
BRAND_NAME="${BRAND_NAME:-Kanboard Whiteboard}"

# Prompt for Kanboard API key
read -rp "Kanboard API key: " KANBOARD_KEY
if [ -z "$KANBOARD_KEY" ]; then
  echo "Error: Kanboard API key is required." >&2
  exit 1
fi

# Prompt for port
read -rp "Host port [3000]: " PORT
PORT="${PORT:-3000}"

# Generate .env
cat > .env <<EOF
BRAND_NAME=${BRAND_NAME}
KANBOARD_USER=jsonrpc
KANBOARD_KEY=${KANBOARD_KEY}
PORT=${PORT}
EOF

echo ""
echo "Generated .env:"
cat .env
echo ""

# Build and start
echo "Starting containers..."
docker compose up -d --build

# Wait for ca-board to be healthy
echo "Waiting for ca-board to start..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo "Kanboard Whiteboard is up!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Warning: health check timed out after 30s. Check 'docker compose logs ca-board'."
  fi
  sleep 1
done

# Create initial admin user and magic link using the SQLite DB inside the container
echo ""
echo "Creating initial admin magic link..."
MAGIC_LINK=$(docker compose exec -T ca-board node -e "
  const auth = require('./auth');
  auth.init();
  const users = auth.getUsers();
  const admin = users.find(u => u.role === 'admin') || users[0];
  if (!admin) { console.error('No users found'); process.exit(1); }
  const link = auth.createMagicLink(admin.id, 'setup-link', 0);
  console.log(link.token);
")

if [ -n "$MAGIC_LINK" ]; then
  echo ""
  echo "============================================="
  echo "  Setup complete!"
  echo ""
  echo "  Board:  http://localhost:${PORT}"
  echo "  Admin login link:"
  echo "  http://localhost:${PORT}/auth/login?token=${MAGIC_LINK}"
  echo ""
  echo "  Save this link — it won't be shown again."
  echo "============================================="
else
  echo "Warning: Could not generate magic link. Check 'docker compose logs ca-board'."
  echo "Board should still be available at http://localhost:${PORT}"
fi
