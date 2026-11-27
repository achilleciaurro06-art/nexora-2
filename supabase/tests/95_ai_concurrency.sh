#!/usr/bin/env bash
# Test di concorrenza sui crediti AI, con sessioni psql REALMENTE parallele (usare solo su un database usa-e-getta).
# Uso: 95_ai_concurrency.sh <nome_database>   (PGHOST/PGPORT/PGUSER dall'ambiente, come run-local.sh)
set -uo pipefail
db=${1:?database}
Q="psql -At -d $db"
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1 (atteso '$3', ottenuto '$2')"; fail=1; fi; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

org=$($Q -c "insert into public.organizations (name, slug) values ('Concorrenza','conc-$$') returning id" | head -1)
$Q -c "insert into public.ai_quotas (organization_id) values ('$org')" >/dev/null
check "limite predefinito 200000" "$($Q -c "select monthly_token_limit from public.ai_quotas where organization_id='$org'")" "200000"

# 1) 14 richieste simultanee da 30.000 token (stima di un PDF grande): ne possono entrare solo 6
for i in $(seq 1 14); do ( $Q -c "select public.rpc_ai_reserve('$org', null, 'document_analysis', 'conc-key-$i-aaaa', 30000) ->> 'ok'" > "$tmp/r$i" 2>&1 ) & done; wait
check "14 prenotazioni simultanee da 30.000: ne riescono esattamente 6" "$(cat "$tmp"/r* | grep -c '^true$')" "6"
check "token trattenuti = 180000, mai oltre il limite" "$($Q -c "select tokens_used from public.ai_quotas where organization_id='$org'")" "180000"

# 2) stessa chiave inviata 5 volte in parallelo: una sola prenotazione, le altre segnalate come duplicate
for i in 1 2 3 4 5; do ( $Q -c "select public.rpc_ai_reserve('$org', null, 'x', 'same-key-aaaa', 100) ->> 'duplicate'" > "$tmp/d$i" 2>&1 ) & done; wait
check "stessa chiave x5: una sola prenotazione creata" "$($Q -c "select count(*) from public.ai_reservations where request_key='same-key-aaaa'")" "1"
check "stessa chiave x5: 4 segnalate duplicate" "$(cat "$tmp"/d* | grep -c '^true$')" "4"

# 3) conteggio concorrente sulla stessa prenotazione: addebito una sola volta
rid=$($Q -c "select id from public.ai_reservations where organization_id='$org' and feature='document_analysis' and status='reserved' order by created_at limit 1")
used_before=$($Q -c "select tokens_used from public.ai_quotas where organization_id='$org'")
for i in 1 2 3 4 5; do ( $Q -c "select public.rpc_ai_settle('$rid', 20000, 5000, 'gemini', 'm', false)" > "$tmp/s$i" 2>&1 ) & done; wait
check "5 conteggi simultanei sulla stessa prenotazione: uno solo riesce" "$(cat "$tmp"/s* | grep -c '^t$')" "1"
check "il consumo reale (25000) sostituisce la stima (30000) una volta sola" "$($Q -c "select tokens_used from public.ai_quotas where organization_id='$org'")" "$((used_before - 30000 + 25000))"
check "un rilascio dopo il conteggio non rimborsa di nuovo" "$($Q -c "select public.rpc_ai_release('$rid', 'x')")" "f"

# 4) consumo reale superiore alla prenotazione: il consumo vero viene registrato (nessun consumo nascosto) e le richieste successive sono bloccate
org2=$($Q -c "insert into public.organizations (name, slug) values ('Sforo','sforo-$$') returning id" | head -1)
$Q -c "insert into public.ai_quotas (organization_id) values ('$org2')" >/dev/null
$Q -c "select public.rpc_ai_reserve('$org2', null, 'x', 'fill-key-aaaa', 190000)" >/dev/null
r=$($Q -c "select public.rpc_ai_reserve('$org2', null, 'document_analysis', 'over-key-aaaa', 5000) ->> 'id'")
$Q -c "select public.rpc_ai_settle('$r', 40000, 5000, 'gemini', 'm', false)" >/dev/null
check "sforo: il consumo reale è registrato per intero" "$($Q -c "select tokens_used from public.ai_quotas where organization_id='$org2'")" "235000"
check "sforo: la richiesta successiva è rifiutata (limite)" "$($Q -c "select public.rpc_ai_reserve('$org2', null, 'x', 'next-key-aaaa', 1) ->> 'reason'")" "limit"

if [ "$fail" = 0 ]; then echo "AI CONCURRENCY TESTS PASSED"; else exit 1; fi
