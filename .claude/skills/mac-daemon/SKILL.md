---
name: mac-daemon
description: >
  Covers the Mac-resident comms daemon in daemon/ and the macOS facilities it leans on:
  node:sqlite over Messages.app's chat.db, attributedBody typedstream decoding, AddressBook
  lookups, Full Disk Access, imapflow + mailparser over IMAP, keychain secrets via the security
  CLI, launchd agents, and the HMAC-signed ingest contract. Use when editing or running anything
  under daemon/, or on any mention of chat.db, attributedBody, iMessage or SMS ingestion, Full
  Disk Access, imapflow, mailparser, IMAP, UIDVALIDITY, launchd / launchctl / plist,
  find-generic-password, or the daemon's cursor and heartbeat. The endpoint it POSTs to is a
  Worker — use the cloudflare-workers skill for that side.
---

# mac-daemon — the Mac-resident comms daemon

## Contents

- [The map](#the-map)
- [Running it](#running-it)
- [Workspace tooling](#workspace-tooling)
- [chat.db and iMessage](#chatdb-and-imessage)
- [WorkMail over IMAP](#workmail-over-imap)
- [Keychain secrets](#keychain-secrets)
- [Cursor, anchor, identity](#cursor-anchor-identity)
- [The ingest contract](#the-ingest-contract)
- [Adding a source](#adding-a-source)

## The map

`daemon/` is a long-lived Node process on the owner's own Mac. It polls iMessage/SMS out of
`~/Library/Messages/chat.db` and a WorkMail mailbox over IMAP, normalizes both, and POSTs them
HMAC-signed to the Worker's `/comms/ingest`. It holds no Anthropic key and no Supabase
credential and makes no model call — triage is server-side, so a lost laptop carries one
write-only ingest credential and nothing else.

- `src/main.ts` — the entry point and the **only** composition root. Every module below it takes
  its collaborators as parameters, which is why the whole suite runs with no Mac, no keychain, no
  network and no chat.db. Inject; don't reach for a real dependency at the point of use.
- Shared machinery: `cli.ts` (flags) · `config.ts` (the JSON file, hand-validated) ·
  `health.ts` (startup checks) · `daemon.ts` (poll loop, 5 s) · `runner.ts` (one source's
  poll → batch → send tick) · `ingest-client.ts` (sign + POST, retries nothing) ·
  `pending.ts` (the bounded re-send buffer) · `heartbeat.ts` (liveness coalescing) ·
  `cursor.ts` (resume) · `state.ts` (local cursor cache) · `keychain.ts` · `log.ts` ·
  `contract.ts` (the wire types).
- `src/sources/` — `types.ts` is the `Source` interface (`check()` + `poll(ctx)`), `index.ts` the
  registry the daemon runs; `imessage/` and `workmail/` are the two implementations.
- `launchd/` holds the plist template, `scripts/` the install/uninstall agents.

Background on why the read path looks like this at all: `docs/spikes/imessage-ingestion.md`.

## Running it

```bash
npm run start -w daemon -- --check                            # health checks only; exit 0 / 1
npm run start -w daemon -- --once --dry-run                   # one poll, JSON on stdout, no POST
npm run start -w daemon -- --once --dry-run --source imessage # …one source (repeatable flag)
npm run start -w daemon                                       # the loop, as launchd runs it
npm run install:launchd -w daemon                             # write + bootstrap the LaunchAgent
npm run uninstall:launchd -w daemon                           # bootout + remove the plist
```

- **Config** lives at `~/Library/Application Support/alfred-daemon/config.json` (template:
  `daemon/config.example.json`). `ALFRED_DAEMON_CONFIG` overrides the path, and `state.json` — the
  cursor cache — follows it into the same directory, so one override moves both. No secret ever
  goes in it.
- **Logs under launchd**: `~/Library/Logs/alfred-daemon/daemon.log` and `daemon.error.log`. The
  logger puts warnings and errors on stderr precisely so `--dry-run`'s normalized-message JSON on
  stdout stays machine-readable.
- **`--check` is the first move when "nothing is arriving"**: config parses → HMAC secret is
  readable → each enabled source's own readiness check, each printed by name. The launchd agent
  runs the same checks on every start, because every failure here is silent.

## Workspace tooling

- **Node runs `src/main.ts` directly** by stripping types, so the source must be **erasable
  syntax only** — no `enum`, no parameter properties, no `namespace`. `erasableSyntaxOnly` in the
  tsconfig turns that into a type error instead of a runtime surprise.
- **Local imports carry an explicit `.ts` extension.** Node's TypeScript loader resolves only
  explicit specifiers; an extensionless one throws `ERR_MODULE_NOT_FOUND`. ESLint's
  `import/extensions` is set to `{ ts: 'always' }` to match, and `jest.config.ts` maps
  `^(\.{1,2}/.*)\.ts$` → `$1` so Jest's resolver finds the same module the runtime does.
- **tsconfig is ESNext + Bundler resolution, like `tools/*` — not NodeNext.** Under NodeNext,
  named *type* imports from CJS declarations (mailparser's `ParsedMail`, `AddressObject`) fail to
  resolve. `allowImportingTsExtensions` is what lets the `.ts` specifiers type-check.
- **`npm run lint -w daemon` is `eslint --fix .`** across the whole package, so it rewrites files
  as it checks. Type-aware `strictTypeChecked` + `unicorn` are on. The package gate is
  `npm run check:fast -w daemon`; Jest runs as ESM
  (`NODE_OPTIONS=--experimental-vm-modules`, `ts-jest/presets/default-esm`).

## chat.db and iMessage

- **Read integers as bigints.** `message.date` is nanoseconds since 2001 — about 8·10^17 today,
  past `Number.MAX_SAFE_INTEGER` — and `node:sqlite` refuses to narrow it, throwing
  `RangeError: Value is too large to be represented as a JavaScript number`. Call
  `statement.setReadBigInts(true)` and convert late, narrowing only the values that really are
  small (`ROWID`, flags).
- **Read both date units defensively.** Current macOS writes nanoseconds; a database restored
  from an older Mac still holds whole seconds. `< 1e12` ⇒ seconds. The anchor query passes the
  probe *and* a bound in each unit, because comparing the wrong unit silently matches every row
  or none.
- **Open `readOnly: true`, always.** Messages.app holds the write lock and writes constantly
  under Messages-in-iCloud; a writable handle buys nothing and risks contention.
- **Full Disk Access is granted to the binary that opens the file** — `process.execPath`, the
  node binary baked into the plist, *not* Terminal. `install-launchd.ts` prints the exact path for
  that reason. A TCC-blocked path reports as **missing** rather than unreadable, so a "no such
  file" error has to name FDA as a cause or the real problem is missed. The grant silently resets
  across macOS updates — hence the loud check on every start, and hence a failing *source* raises
  an erroring heartbeat rather than exiting (a dead daemon looks merely stale).
- **The `coalesce`s in the row filter are load-bearing.** Tapbacks are
  `coalesce(associated_message_type, 0) between 2000 and 3999`, group events
  `coalesce(item_type, 0) != 0`. Without the `coalesce`, `NULL not between …` is NULL — neither
  true nor false — and every ordinary row (which carries no associated type) is filtered away.
- **`attributedBody` holds the body whenever `text` is empty**, which is most rows on current
  macOS. `typedstream.ts` locates the `NSString` / `NSMutableString` class marker, then the `+`
  type-encoding byte, then a length-prefixed UTF-8 run: one byte under 129, `0x81` + uint16 LE,
  `0x82` + uint32 LE. Validated against thousands of real blobs — no dependency needed. Decode
  with `TextDecoder('utf-8', { fatal: true })` so a wrong offset fails loudly instead of storing
  mojibake as if it were the message, and model the failure as a **value**
  (`body_extracted: false`) — a skipped message is a false negative nobody can audit.
- **Poll, don't watch.** macOS coalesces filesystem events for a process it considers idle, so an
  FSEvents watcher stalls for minutes on exactly the quiet machine this has to keep working on.
  Forward-only polling on ROWID also means edits and unsends are invisible by design.
- **Sender names are best-effort.** They come from the AddressBook Core Data stores under
  `~/Library/Application Support/AddressBook` (same FDA grant), and every failure there is
  silent: a missing name costs a nicety, a failed poll costs a message.

## WorkMail over IMAP

- **mailparser folds `List-Unsubscribe` / `List-ID` into a single `list` key** in `headers`, so
  `headers.get('list-unsubscribe')` is always `undefined`. Read header *presence* off
  `headerLines` instead.
- **mailparser fills `text` from HTML automatically**, so the hand-rolled `htmlToText` is only
  the last resort for a message that has neither. `messageId` / `references` keep their angle
  brackets — leave them; ids are compared verbatim everywhere in the system.
- **imapflow v2 types bite in three places.** `mailbox.uidValidity` is a `bigint` (`Number()` it
  at the boundary); `search(q, { uid: true })` returns `number[] | false | undefined`; and the
  `fetch` generator keeps streaming after an early `break`. So cap a poll by SEARCH-then-FETCH
  over an explicit UID list, never by breaking out of a fetch.
- **`UID n:*` is a range, not a lower bound.** A server with nothing above `n` answers with its
  newest message regardless, so drop everything at or below the cursor after the search.
- **Nothing is ever marked read.** `mailboxOpen(path, { readOnly: true })` issues `EXAMINE` and
  `source: true` fetches `BODY.PEEK[]`. The `ImapSession` interface deliberately exposes no flag,
  move, copy or delete: the queue drains by *noticing* a reply in Sent, never by writing to the
  server.
- **WorkMail does not advertise SPECIAL-USE** — imapflow infers `\Sent` from the folder name
  (`Sent Items`), so the name fallback (`sent` / `sent items` / `sent messages`) is not dead
  code. `check()` fails when there is no sent folder at all, because that folder is how a reply
  clears a queued row.
- **`logger: false` on the ImapFlow client, and never quote the server on the auth path** — a
  rejected LOGIN response can echo the command that carried the password. Say "the password in
  the keychain is wrong" instead.

## Keychain secrets

- Both secrets live in the login keychain and are read with
  `security find-generic-password -s <service> -a <account> -w`:
  `alfred-comms-hmac-secret` / `alfred-daemon` (the ingest HMAC) and `alfred-workmail-imap` /
  *the configured mailbox user* (the IMAP password). Never a plist, a dotfile, an env var, or
  this repo.
- **Nothing from the child process's output reaches an error message**, so a failed read can
  never leak the value it was trying to read. Log the *name* of an item, never its value.
- **A source asks for a secret by name** through the injected `SourceContext.secrets` resolver
  (`workmail-imap-password`). It never sees the `Keychain` interface and therefore cannot reach
  the HMAC secret — that unreachability is the point, so keep a new source on the resolver.

## Cursor, anchor, identity

- **The cursor is never the dedupe key.** The cursor says where to resume — chat.db's `ROWID`,
  IMAP's `{ uidvalidity, uid }` — while identity is the source's own stable id (`guid`,
  `Message-ID`), which is what the endpoint dedupes on. That split is why a failed POST can
  simply keep its batch and re-send it next tick: a re-send is a no-op, not a duplicate.
- **A lost cursor re-seeds from the anchor — `lastSeenAt ?? (now − 7d)`, a fallback and never a
  maximum.** The worked example, because this is easy to write backwards: an outage starts on day
  7 and is noticed on day 17. The anchor is day 7, so the ten missing days are ingested.
  `max(lastSeenAt, now − 7d)` would resume at day 10 and drop days 7–10 silently — it fails in
  exactly the case that matters. The seven days are the first-run seed and nothing more.
- **The server's cursor wins on startup.** `state.json` is only a cache that makes a restart
  fast; missing or corrupt, it is never a reason to fail.

## The ingest contract

- The wire shape is written out once, in `daemon/README.md` (§ "The ingest contract"), and
  implemented by the Worker at `workers/src/comms/ingest.ts`. `daemon/src/contract.ts` and
  `workers/src/comms/types.ts` are deliberate copies — the daemon ships onto a machine that may
  be running an older build, so the payload is versioned (`version: 1`) rather than shared across
  a package boundary. They are kept in step **by review**: change one, change the other in the
  same PR, and read those two files rather than trusting a remembered field list.
- Signing is `X-Alfred-Timestamp: <unix seconds>` plus
  `X-Alfred-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>` over the exact
  bytes sent — the timestamp inside the signed string is what stops a replay, and signing the
  body is what stops the signature being lifted onto another one.
- **A zero-message payload is a first-class request.** The heartbeat is the only thing separating
  a quiet Mac from a dead one, so liveness is sent even with nothing to carry — coalesced to at
  most one POST per source per minute.

## Adding a source

1. A config section in `src/config.ts`, validated by hand with a message that names the field.
2. A factory under `src/sources/<key>/` returning a `Source` — `check()` and `poll(ctx)`.
3. One branch in `src/sources/index.ts`, the single registry the daemon runs.

Everything network-, keychain- and filesystem-facing arrives as an **injected collaborator**
(`connect`, `secrets`, `parse`, `databasePath`, `contacts`), which is what lets the tests drive a
whole source against an in-memory mailbox or a fixture chat.db. Keep that seam: a source that
imports its transport directly is a source that can only be tested on the owner's Mac.
