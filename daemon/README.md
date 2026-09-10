# daemon

A Mac-resident **dumb pipe**. It polls the owner's own machine for new messages — iMessage/SMS out
of `~/Library/Messages/chat.db`, and an Amazon WorkMail mailbox over IMAP — normalizes them, and
POSTs them HMAC-signed to alfred's ingest endpoint.

It holds **no Anthropic key and no Supabase credential**, and it makes no model call. All triage
happens server-side, so the most this machine can do is write messages into one inbox. That is the
whole point of the split: a laptop that can be lost carries one write-only ingest credential.

Two sources ship: iMessage / SMS read from `chat.db` (`src/sources/imessage/`) and WorkMail over
IMAP (`src/sources/workmail/`), each behind the same `Source` interface; everything around them —
scheduling, batching, signing, retry, health, launchd — is shared.

## Install

**1. Keychain items.** Both secrets live in the login keychain. Never in the config file, never in
the plist, never in this repo.

```bash
# The ingest HMAC secret — the same value the Worker holds.
security add-generic-password -s alfred-comms-hmac-secret -a alfred-daemon -w

# The WorkMail IMAP password. The ACCOUNT is the mailbox user from config.json.
security add-generic-password -s alfred-workmail-imap -a support@realplayapp.com -w
```

Each command prompts for the value rather than taking it on the command line, so it never lands in
shell history.

**2. Config.** Copy `config.example.json` to
`~/Library/Application Support/alfred-daemon/config.json` and edit it:

```json
{
  "ingestUrl": "https://<worker>/comms/ingest",
  "sources": {
    "imessage": { "enabled": true },
    "workmail": {
      "enabled": true,
      "host": "imap.mail.us-east-1.awsapps.com",
      "port": 993,
      "user": "support@realplayapp.com",
      "label": "WorkMail"
    }
  }
}
```

`ALFRED_DAEMON_CONFIG` overrides the path (the cursor cache follows it into the same directory).
A source the file does not mention is simply not run.

**3. Full Disk Access.** `chat.db` is TCC-protected, and the grant must name the **binary that
opens it** — the `node` that runs the daemon, not Terminal. `npm run install:launchd -w daemon`
prints the exact path; add it under System Settings → Privacy & Security → Full Disk Access.

**4. The launchd agent.**

```bash
npm run install:launchd -w daemon     # writes ~/Library/LaunchAgents/com.alfred.comms-daemon.plist
npm run uninstall:launchd -w daemon   # stops it and removes the plist
```

`RunAtLoad` starts it at login, `KeepAlive`/`SuccessfulExit: false` restarts it after a crash, and
`ProcessType: Interactive` keeps macOS from throttling it as an idle background job.

## Running it by hand

```bash
npm run start -w daemon -- --check              # health checks only; exit 0 healthy, 1 not
npm run start -w daemon -- --once --dry-run     # one poll of every source, printed as JSON
npm run start -w daemon -- --source workmail    # loop, but only this source
npm run start -w daemon                         # the loop, as launchd runs it
```

`--dry-run` prints each normalized message as one JSON object on stdout and never POSTs anything.
Logs are structured lines on stdout; warnings and errors go to stderr, so `--dry-run` output stays
machine-readable.

**Logs** (under launchd): `~/Library/Logs/alfred-daemon/daemon.log` and `daemon.error.log`.

## The health check

`--check` runs, in order: the config parses; the ingest HMAC secret is readable from the keychain;
each enabled source's own readiness check. The launchd agent runs the same checks on **every**
start, because the failures that matter here are silent — a Full Disk Access grant that reset
across a macOS update leaves a daemon that runs happily and ingests nothing.

A broken config, a missing HMAC secret, or an empty source list stops the daemon (exit 1); a
failing **source** does not — its error is carried to the server every minute as an erroring
heartbeat, which is how the health surface tells "broken" from "quiet".

## The ingest contract

```
POST {ingestUrl}
Headers: Content-Type: application/json
         X-Alfred-Timestamp: <unix seconds, integer>
         X-Alfred-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>

Body: { "version": 1,
        "account": { "key": "imessage"|"workmail", "kind": "imessage"|"imap", "label": string,
                     "owner_handles": string[], "expected_interval_seconds": number },
        "heartbeat": { "ok": boolean, "cursor": <any JSON or null>, "error": string|null },
        "messages": NormalizedMessage[] }   // may be empty: a pure heartbeat is a first-class payload

NormalizedMessage: {
  source_id: string; rfc822_message_id?: string; thread_key: string;
  direction: 'inbound'|'outbound'; sender_handle: string; sender_name?: string; chat_name?: string;
  participants: string[]; subject?: string; body: string; received_at: string (ISO 8601);
  body_extracted: boolean; has_attachments: boolean; in_reply_to?: string; references_ids: string[]
}

200 → { accepted, duplicates, drained, cursor, last_seen_at }
401 → bad or stale signature   400 → bad body   503 → unconfigured
```

The timestamp is inside the signed string, so a captured request cannot be replayed later; the
signature is over the exact bytes sent, so it cannot be lifted onto a different body. Optional
fields are omitted rather than nulled — the endpoint accepts either.

The daemon retries nothing at the HTTP level: a failed POST keeps its batch in memory (at most 500
messages, oldest dropped past that, loudly) and the next tick sends it again. The endpoint dedupes
on each source's identity key, so a re-send is a no-op.

## How it resumes

Each source resumes from a **cursor** — where the last poll stopped. When there is no usable cursor
(first run, a UIDVALIDITY change, a restored chat.db), it reads from an **anchor** instead: the
account's last successful poll, or a seven-day lookback when it has never polled.

The anchor is `lastSeenAt ?? (now − 7d)` — a fallback, never a maximum. An outage that starts on
day 7 and is fixed on day 17 resumes at **day 7** and ingests the ten missing days. Taking the
later of the two would resume at day 10 and drop days 7–10 silently, which is the exact failure
this rule exists to prevent.

The server's cursor wins on startup; `state.json` next to the config is only a cache that makes a
restart fast, and a missing or corrupt one is never a reason to fail.

## Adding a source

1. A config section in `src/config.ts` (validated by hand, with a message that names the field).
2. A factory under `src/sources/<key>/` returning a `Source` — `check()` and `poll(ctx)`.
3. One branch in `src/sources/index.ts`, the single registry the daemon runs.

`poll` receives `{ cursor, anchor, now, secrets }` and returns `{ messages, cursor, ownerHandles }`.
Secrets are requested **by name** (`workmail-imap-password`), so a source can only reach the item
that name maps to.

## Sources → iMessage

Reads `~/Library/Messages/chat.db` read-only and polls forward on ROWID — cursor `{ rowid }`,
seeded from the anchor on a first run — decoding `attributedBody` whenever `message.text` is empty
(most rows, on current macOS). Tapbacks (`associated_message_type` 2000–3999) and group-membership
events (`item_type != 0`) are skipped because they are not messages; **nothing else is**, so a body
that will not decode still ships with `body_extracted: false` rather than vanishing. Sender names
come best-effort from the AddressBook stores and never fail a poll, and edits and unsends are
invisible to a forward-only poll by design.

## Sources → WorkMail

The WorkMail source reads two mailboxes over IMAP and writes to neither. **INBOX** is what arrives;
the **Sent folder** is what makes the queue drain — when the owner answers in their own mail client,
that reply lands in Sent naming the queued `Message-ID` in its `In-Reply-To` / `References`, and the
server clears the row. alfred never labels, archives, moves or flags anything.

Nothing is marked read: mailboxes are opened with `EXAMINE` (`readOnly: true`) and the raw message
is fetched with `BODY.PEEK[]`, so a poll leaves every flag exactly as it found it.

**Cursor.** `{ inbox: { uidvalidity, uid }, sent: { uidvalidity, uid } }` — one pair per mailbox,
because a UID only means anything inside its own `UIDVALIDITY` generation. When a mailbox's
`UIDVALIDITY` differs from the stored one (or there is no cursor at all), every remembered UID now
names a different message: that half of the cursor is thrown away and the mailbox is re-seeded from
the **anchor** instead. Otherwise it reads forward from `uid + 1`. `UID n:*` is a range rather than a
lower bound — a server with nothing above `n` answers with its newest message regardless — so
anything at or below the cursor is dropped rather than re-delivered. At most **200 messages per
mailbox per poll**, with the cursor left on the last message actually emitted, so a backlog drains
over several polls instead of failing as one oversized tick.

**Identity and threading.** `source_id` is the RFC822 `Message-ID` verbatim, angle brackets and all,
falling back to `uidvalidity:uid` for the rare message that carries none. `thread_key` is the first
id in `References`, else `In-Reply-To`, else the message's own `Message-ID` — a root starts its own
thread, and its replies will name it. That is the best IMAP can do: the THREAD extension is optional
and this mailbox does not offer one, so the conversation is reconstructed from the reply headers
every mail client already writes.

**Bodies.** `text` when there is one, otherwise the HTML stripped to text, truncated to 20 000
characters. A message whose MIME will not parse is still sent — `body_extracted: false`, empty body,
identified by its mailbox coordinates and dated by the server's own `internalDate`. One bad message
never stalls the poll.

**Bulk mail passes through unchanged.** `list_headers` names the bulk-mail headers a message
actually carries (`list-unsubscribe`, `list-id`, and `precedence` when it says bulk). The daemon
reports them and files nothing differently: deciding a newsletter also means checking the sender
against the priority-people roster, which lives server-side, so the filter belongs to the endpoint.

**The health check** logs in, lists the mailboxes, and fails if there is no sent folder to watch —
a WorkMail account without one honours only two of the three ways a queued message can clear. The
folder is found by the `\Sent` special-use flag, falling back to a folder named `Sent`, `Sent Items`
or `Sent Messages`. Note that WorkMail does **not** advertise SPECIAL-USE: imapflow infers the flag
from the folder name, which is why the name fallback is not dead code.

The password comes from the keychain by name (`workmail-imap-password`), is held only for the length
of one connection, and is never logged — `imapflow` runs with `logger: false`, and a failed login is
reported as "the password in the keychain is wrong", never by quoting what the server said back.
