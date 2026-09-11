#!/bin/bash
# Sends the two row shapes to the REAL comm_messages endpoint and prints what PostgREST says.
# Nothing is ever written: both batches name an account_id that cannot exist, so the only
# difference between them is how far each one gets before it is refused.
set -u
cd "$(git rev-parse --show-toplevel)"
set -a; . ./frontend/.env.local; set +a   # never echoed; only the responses are printed

FAKE="00000000-0000-0000-0000-000000000000"
post () {
  curl -s -w "\nHTTP %{http_code}\n" --max-time 25 \
    -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/comm_messages" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=ignore-duplicates" \
    -d "$1"
}
# Row 1 is a group chat (has chat_name + subject); row 2 is a 1:1 (has neither) — the everyday
# iMessage mix. $1 is how row 2 spells those two absent fields.
batch () {
  cat <<EOF
[{"account_id":"$FAKE","source_id":"probe-a","thread_key":"t","direction":"inbound","sender_handle":"x","participants":[],"body":"b","received_at":"2026-09-11T00:00:00Z","body_extracted":true,"has_attachments":false,"has_list_header":false,"references_ids":[],"chat_name":"Invoices","subject":"Q3"},
 {"account_id":"$FAKE","source_id":"probe-b","thread_key":"t","direction":"inbound","sender_handle":"x","participants":[],"body":"b","received_at":"2026-09-11T00:00:00Z","body_extracted":true,"has_attachments":false,"has_list_header":false,"references_ids":[]$1}]
EOF
}

echo "BEFORE — absent optionals omitted, which is what JSON.stringify(undefined) leaves behind:"
post "$(batch '')"
echo
echo "AFTER — absent optionals sent as explicit nulls:"
post "$(batch ',"chat_name":null,"subject":null')"
