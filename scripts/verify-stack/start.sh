#!/usr/bin/env bash
# Avvia lo stack Supabase LOCALE di verifica (GoTrue + Storage + PostgREST + gateway) su un Postgres locale.
# Solo per sviluppo e test: nessun collegamento con produzione. Richiede Docker e un Postgres su 127.0.0.1:54399.
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/verify-stack/keys.mjs >/dev/null
set -a; source .env.verify; set +a
PSQL="psql -q -v ON_ERROR_STOP=1 -h $DB_HOST -p $DB_PORT -U postgres"
wait_for() { for _ in $(seq 1 60); do if eval "$2" >/dev/null 2>&1; then return 0; fi; sleep 1; done; echo "TIMEOUT: $1" >&2; docker logs --tail 15 "${3:-nx-gotrue}" >&2 || true; exit 1; }

docker rm -f nx-gotrue nx-storage nx-rest >/dev/null 2>&1 || true
[ -f /tmp/nx-gateway.pid ] && kill "$(cat /tmp/nx-gateway.pid)" 2>/dev/null || true
$PSQL -d postgres -c "drop database if exists $DB_NAME with (force)" -c "create database $DB_NAME"
$PSQL -d "$DB_NAME" -f scripts/verify-stack/bootstrap.sql

docker run -d --name nx-gotrue --network host \
  -e GOTRUE_API_HOST=127.0.0.1 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL="$API_URL" \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME" \
  -e GOTRUE_SITE_URL=http://127.0.0.1:3100 -e GOTRUE_URI_ALLOW_LIST='*' -e GOTRUE_DISABLE_SIGNUP=true \
  -e GOTRUE_JWT_SECRET="$JWT_SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_SMTP_HOST=127.0.0.1 -e GOTRUE_SMTP_PORT=2500 -e GOTRUE_SMTP_ADMIN_EMAIL=noreply@nexora.local \
  supabase/gotrue:v2.198.0 >/dev/null
wait_for "GoTrue migrations" "$PSQL -d $DB_NAME -At -c \"select 1 from information_schema.tables where table_schema='auth' and table_name='users'\" | grep -q 1" nx-gotrue
sleep 3

mkdir -p /tmp/nx-storage
docker run -d --name nx-storage --network host -v /tmp/nx-storage:/var/lib/storage \
  -e SERVER_PORT=5000 -e ANON_KEY="$ANON_KEY" -e SERVICE_KEY="$SERVICE_ROLE_KEY" -e AUTH_JWT_SECRET="$JWT_SECRET" -e PGRST_JWT_SECRET="$JWT_SECRET" \
  -e DATABASE_URL="postgres://supabase_storage_admin:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME" -e POSTGREST_URL=http://127.0.0.1:3000 \
  -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e FILE_SIZE_LIMIT=52428800 \
  -e TENANT_ID=local -e REGION=local -e GLOBAL_S3_BUCKET=local -e ENABLE_IMAGE_TRANSFORMATION=false -e IMAGE_TRANSFORMATION_ENABLED=false \
  supabase/storage-api:v1.98.1 >/dev/null
wait_for "Storage migrations" "$PSQL -d $DB_NAME -At -c \"select 1 from information_schema.tables where table_schema='storage' and table_name='objects'\" | grep -q 1" nx-storage
sleep 3

echo "applico le migrazioni dell'app..."
for f in supabase/migrations/*.sql; do $PSQL -d "$DB_NAME" -f "$f" >/dev/null; done

docker run -d --name nx-rest --network host \
  -e PGRST_DB_URI="postgres://authenticator:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$JWT_SECRET" -e PGRST_SERVER_HOST=127.0.0.1 -e PGRST_SERVER_PORT=3000 \
  postgrest/postgrest:v12.2.12 >/dev/null
wait_for "PostgREST" "curl -fsS -H 'apikey: $ANON_KEY' http://127.0.0.1:3000/ -o /dev/null" nx-rest

nohup node scripts/verify-stack/gateway.mjs > /tmp/nx-gateway.log 2>&1 & echo $! > /tmp/nx-gateway.pid
wait_for "gateway/auth" "curl -fsS $API_URL/auth/v1/health -o /dev/null" nx-gotrue
wait_for "gateway/rest" "curl -fsS -H 'apikey: $ANON_KEY' $API_URL/rest/v1/ -o /dev/null" nx-rest
echo "STACK PRONTO su $API_URL"
