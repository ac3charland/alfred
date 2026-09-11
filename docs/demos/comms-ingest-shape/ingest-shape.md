---
branch: fix/comms-ingest-shape-and-deploy-retry
---

# Comms ingest accepts a real iMessage batch

*2026-09-11T17:46:30.439Z*

The Mac daemon couldn't start: every `POST /comms/ingest` came back `503`, so its 214-message
iMessage batch was never accepted and it retried the same batch forever.

`503` from that endpoint means one of two things, and the health string ruled the first one out —
`GET /` said `comms ingest configured`, and a deliberately bad signature answered `401`, not `503`.
So the HMAC secret was fine and the failure was the other branch: an exception in the storage path,
deliberately logged rather than returned. `wrangler tail` had it:

    comms ingest failed: Error: Supabase POST comm_messages failed: 400
      {"code":"PGRST102","details":null,"hint":null,"message":"All object keys must match"}

**PGRST102** is PostgREST's rule for a bulk insert: every object in the array must carry an
identical key set, and a mixed batch is rejected *whole*. `ingestMessages` builds each row with all
17 keys spelled out, so the source looks uniform — but five of them are optional
(`rfc822_message_id`, `sender_name`, `chat_name`, `subject`, `in_reply_to`), and `JSON.stringify`
**drops a key whose value is `undefined`** rather than writing a null. A group chat carries
`chat_name`; a 1:1 doesn't. Mix them — which 214 real iMessages always do — and the rows reach
PostgREST with different shapes.

That also explains why this looked intermittent rather than broken: the daemon's **workmail** source
went through fine at the same moment. Its two IMAP messages happened to have identical shapes, so
that batch was uniform and legal. Only the heterogeneous batch died.

The fix sends absent optionals as explicit JSON nulls, so every row in a batch has the same shape.

Both batches below go to the **real** `comm_messages` endpoint and mix a group chat with a 1:1 — the everyday iMessage shape. Neither writes anything: both name an `account_id` that cannot exist, so the only thing that differs is how far each gets before PostgREST refuses it.

```bash
bash docs/demos/comms-ingest-shape/shape-probe.sh
```

```output
BEFORE — absent optionals omitted, which is what JSON.stringify(undefined) leaves behind:
{"code":"PGRST102","details":null,"hint":null,"message":"All object keys must match"}
HTTP 400

AFTER — absent optionals sent as explicit nulls:
{"code":"23503","details":"Key (account_id)=(00000000-0000-0000-0000-000000000000) is not present in table \"comm_accounts\".","hint":null,"message":"insert or update on table \"comm_messages\" violates foreign key constraint \"comm_messages_account_id_fkey\""}
HTTP 409
```

The two failures are the whole point:

- **Before** — `400 PGRST102 All object keys must match`. Refused while *parsing*, before the
  database is touched at all. This is byte-for-byte the error behind the daemon's `503`.
- **After** — `409 23503 ... violates foreign key constraint`. The batch parsed, was accepted as
  well-formed, and got all the way to the insert, where it tripped only on the fake `account_id`
  this probe deliberately uses. The shape problem is gone; reaching a foreign-key check is proof it
  got past the shape check.

A real batch, with a real `account_id`, now lands.
