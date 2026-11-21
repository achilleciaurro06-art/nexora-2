#!/usr/bin/env bash
# Uso: run-app.sh [--no-build]  (--no-build riavvia soltanto, azzerando anche il limitatore di tentativi in memoria)
# Compila e avvia l'app NEXORA contro lo stack di verifica locale, su http://127.0.0.1:3100.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env.verify; set +a
export NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 GEMINI_API_KEY="${GEMINI_API_KEY:-}"
# email: valori di PROVA (non sono segreti reali); nessuna credenziale Google/Microsoft: quei collegamenti risultano "non configurati"
export EMAIL_ENCRYPTION_KEY="${EMAIL_ENCRYPTION_KEY:-$(printf 'nexora-verify-key-0123456789abcd' | base64)}" EMAIL_ALLOW_PRIVATE_HOSTS=true CRON_SECRET="verify-cron-secret-123456"
pkill -f "next start -p 3100" 2>/dev/null || true; pkill -f "next-server" 2>/dev/null || true; sleep 1
if [ "${1:-}" != "--no-build" ]; then npm run build >/tmp/nx-build.log 2>&1 || { tail -30 /tmp/nx-build.log; exit 1; }; fi
nohup npx next start -p 3100 -H 127.0.0.1 > /tmp/nx-app.log 2>&1 & echo $! > /tmp/nx-app.pid
for _ in $(seq 1 40); do curl -fsS http://127.0.0.1:3100/login -o /dev/null 2>&1 && { echo "APP PRONTA su http://127.0.0.1:3100"; exit 0; }; sleep 1; done
tail -20 /tmp/nx-app.log; exit 1
