#!/usr/bin/env bash
docker rm -f nx-gotrue nx-storage nx-rest >/dev/null 2>&1 || true
[ -f /tmp/nx-gateway.pid ] && kill "$(cat /tmp/nx-gateway.pid)" 2>/dev/null || true
echo "stack fermato"
