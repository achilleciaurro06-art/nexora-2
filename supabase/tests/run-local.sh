#!/usr/bin/env bash
# Esegue migrazioni + test RLS su un Postgres locale usa-e-getta (richiede psql e initdb nel PATH o PGBIN).
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST=${PGHOST:-/tmp/pgtest} PGPORT=${PGPORT:-54399} PGUSER=${PGUSER:-postgres}
db=nexora_test_$$
psql -q -c "create database $db"; trap 'psql -q -c "drop database $db" >/dev/null' EXIT
P="psql -q -v ON_ERROR_STOP=1 -d $db"
$P -f tests/00_local_stub.sql
for f in migrations/*.sql; do $P -f "$f" >/dev/null; done
$P -f tests/10_tenant_isolation.sql 2>&1 | grep -E "ok   -|FAIL|ERROR|PASSED" | sed "s/^psql:[^ ]* //"
$P -f tests/20_save_quote.sql 2>&1 | grep -E "ok   -|FAIL|ERROR|PASSED" | sed "s/^psql:[^ ]* //"
$P -f tests/30_commercial.sql 2>&1 | grep -E "ok   -|FAIL|ERROR|PASSED|DETAIL|CONTEXT" | sed "s/^psql:[^ ]* //"
$P -f tests/40_quotes_complete.sql 2>&1 | grep -E "ok   -|FAIL|ERROR|PASSED|DETAIL|CONTEXT" | sed "s/^psql:[^ ]* //"
$P -f tests/50_sector.sql 2>&1 | grep -E "ok   -|FAIL|ERROR|PASSED|DETAIL|CONTEXT" | sed "s/^psql:[^ ]* //"
$P -f tests/60_crm.sql 2>&1 | grep -E "ok   -|FAIL|ERROR|PASSED|DETAIL|CONTEXT" | sed "s/^psql:[^ ]* //"
$P -f tests/70_agenda.sql 2>&1 | grep -E "ok   -|FAIL|ERROR|PASSED|DETAIL|CONTEXT" | sed "s/^psql:[^ ]* //"
$P -f tests/80_email.sql 2>&1 | grep -E "ok   -|FAIL|ERROR|PASSED|DETAIL|CONTEXT" | sed "s/^psql:[^ ]* //"
