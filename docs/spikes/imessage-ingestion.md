# Spike: building a local iMessage triage firewall on macOS

**Decision.** iMessage has no cloud API. The only viable read path is a **Mac-resident daemon**
polling `~/Library/Messages/chat.db` read-only, decoding `attributedBody`, and shipping normalized
messages onward. This document is the technical justification and shape for a future
implementation spec — not the spec itself. It is the ingestion input to the
[ALF-7 Communication Firewall epic](../specs/epics/ALF-7.html).

## The core idea, restated

A Mac-resident daemon that watches incoming iMessages/SMS, runs each one through an LLM for
importance scoring, and only surfaces the ones that clear some urgency bar — everything else gets
logged but not pushed at you. This is entirely buildable with off-the-shelf, well-trodden
techniques. The hard parts aren't permissions or APIs; they're the reliability gremlins that only
show up after your server has been running unattended for days.

## 1. Where the data actually lives

Messages.app stores everything in a SQLite database at `~/Library/Messages/chat.db`. There's no
public Apple API for reading iMessages — every tool in this space, from hobbyist scripts to
commercial products like Texts.com and BlueBubbles, works by reverse-engineering this schema
directly.

The tables that matter:

- `message` — one row per message, with `text`, `date`, `is_from_me`, `handle_id`
- `handle` — maps sender IDs to phone numbers/emails
- `chat` — conversation metadata, including group chat display names
- `chat_message_join` and `chat_handle_join` — the linking tables that tell you which message
  belongs to which conversation and who's in it

**The attributedBody gotcha.** Since roughly iOS 16 / a 2022-era Messages update, a growing share
of messages — anything with rich formatting, dictation, or certain reactions — store their text not
in the plain `text` column but inside `attributedBody`, a binary `NSKeyedArchiver`/typedstream
blob. If you only read `text`, you'll silently lose a chunk of real message content. You need a
decoder for this. Options, roughly in order of robustness:

- Use PyObjC's `NSKeyedUnarchiver` directly (clean, but ties you to running on macOS with the
  Foundation framework available)
- Use a typedstream parser library (e.g. `pytypedstream`) for a pure-Python decode
- Fall back to brittle byte-pattern matching (splitting on the literal `NSString` marker and
  reading a length-prefixed byte string) — this is what most of the early open-source scripts do,
  and it works but breaks on edge cases

Several existing open-source projects have already solved this and are worth forking from rather
than re-deriving: `imessage_tools`, `macos-messages` (Python library + CLI), and the `imsg` CLI
(Node-based, actively maintained, built specifically for agent/automation use cases — closest thing
to "done for you" for this exact project).

## 2. Permissions: Full Disk Access, not an API key

`chat.db` is TCC-protected. Whatever process reads it — your Python script, a Terminal session, a
compiled binary — needs to be added to **System Settings → Privacy & Security → Full Disk Access**.
Without it you get a flat "Operation not permitted" with no further detail. A few practical notes:

- Grant FDA to the actual binary that opens the file, not just "Terminal" if you're launching your
  server via a different parent process (a launchd agent, a Python venv, an Electron shell) — each
  distinct parent may need its own entry.
- FDA grants have been reported to silently reset after major macOS updates, so build a startup
  health check that fails loudly if the read fails, rather than assuming permissions persist
  forever.
- Contact resolution (turning a phone number into "Mom") requires a separate read of the
  AddressBook SQLite stores under `~/Library/Application Support/AddressBook/Sources/*` — same FDA
  requirement covers it.

## 3. Detecting new messages in near-real-time

This is the part that actually bites people running these as long-lived servers rather than one-off
scripts.

**Naive approach: FSEvents/kqueue file-watching.** Watch `chat.db` (and its `-wal`/`-shm` sidecar
files, since SQLite in WAL mode writes there first) for changes, and re-query when they fire. This
works fine when you're actively using the Mac.

**Where it breaks:** macOS's power management coalesces and batches filesystem event notifications
for background processes that the kernel considers idle — this is a documented, recurring pain
point across several projects (the `imsg` CLI's own issue tracker has a specific bug report on it).
The result is that new messages land in the database instantly, but your watcher's notification
gets delayed by minutes, and on a quiet machine can stop firing until something else touches the
file. `caffeinate` and `ProcessType=Interactive` launchd settings only partially help.

**What people actually ship:** a hybrid — keep the FSEvents watcher as the fast path, but back it
with a plain polling loop (every 2–15 seconds depending on how latency-sensitive you want to be)
that tracks the last-seen `ROWID` and queries for anything newer. Some implementations even have
the poller "touch" the file to force a fresh FSEvent and re-arm a stalled watcher. Given this is a
*triage* system rather than a live chat client, a 2–5 second poll interval is almost certainly fine
and meaningfully simpler to get right than pure event-driven watching — start there and only add
FSEvents later if latency actually matters.

**Open the database read-only.** SQLite allows concurrent readers, but Messages.app itself holds
the write lock; opening the connection read-only (`file:...?mode=ro` in the URI, or the language's
read-only flag) avoids any risk of contention or, worse, corruption.

## 4. Sending things back out

If the firewall should also let approved messages reply or auto-acknowledge: there's no private
send API either — the sanctioned path is driving Messages.app via **AppleScript**
(`tell application "Messages" to send "..." to buddy "..."`). It's a 1993-vintage scripting
language and it is fussy about escaping quotes and special characters in the message body, so
budget time for that specifically. Group chat sends work by targeting the chat GUID rather than a
buddy.

Some tools additionally offer "advanced" features (read receipts, typing indicators, reactions,
edit/unsend) via dylib injection into Messages.app's process — this requires disabling SIP and is a
meaningfully bigger trust/security surface than read-only monitoring plus AppleScript sending. For
a triage tool, avoid this tier entirely; it isn't needed.

## 5. A reasonable architecture

1. **Reader/poller service** — small daemon (Python or Node), polls `chat.db` read-only every few
   seconds for new rows above the last-seen ROWID, decodes `attributedBody` where `text` is null,
   resolves sender via `handle`/AddressBook, resolves group chat name via `chat`.
2. **Normalizer** — turns each raw row into a clean record: sender, display name, chat context
   (1:1 vs. group + name), body text, timestamp, any attachment metadata.
3. **Triage step** — the LLM call. Feed it the message plus whatever context should be weighed
   (sender identity/relationship, recent conversation history, time of day, stated priorities) and
   get back a structured urgency judgment — a small JSON schema (`urgent: bool`, `reason: string`,
   maybe a category) is easier to act on than free text.
4. **Delivery layer** — urgent items get pushed (macOS notification, a Pushover/ntfy call to the
   phone, whatever is already in use); everything else gets appended to a log/digest reviewable on
   your own schedule (a daily rollup is a natural fit).
5. **launchd agent** wrapping the whole thing so it survives reboots, with the health-check-on-
   startup mentioned above so a silent FDA revocation or schema change doesn't fail invisibly.

## 6. Fragility to design around from day one

- **Schema drift.** Apple has changed `chat.db`'s internals across macOS versions before (the
  `attributedBody` shift being the big recent one) with zero documentation. Isolate the DB-reading
  code behind a thin interface so a schema change is a contained fix, not a rewrite.
- **iCloud Messages sync churn.** With Messages-in-iCloud enabled, `IMDPersistenceAgent` writes to
  `chat.db` frequently even when you're not actively texting, which is part of what triggers the
  WAL-rotation/FSEvents-coalescing issue above.
- **Not portable.** Everything here is macOS-only and depends on Messages.app's private on-disk
  format; there's no path to running this ingestion step on Linux against a live account (some
  tools offer a "read a copied database" preview mode on Linux, but that's static, not live
  monitoring).
- **This is your own data on your own machine** — reading your own `chat.db` to build a personal
  tool is a different thing than monitoring someone else's device, which would raise real legal and
  ethical problems. Worth keeping in mind if this ever evolves into something packaged for other
  people to run.

## Further reading / prior art to fork from

- [`imsg` CLI (openclaw)](https://github.com/openclaw/imsg) — actively maintained, agent-oriented,
  handles the FSEvents/WAL edge cases already
- [`macos-messages`](https://github.com/tpritc/macos-messages) — Python library/CLI
- [`imessage_tools`](https://github.com/my-other-github-account/imessage_tools) — the reference
  implementation for the attributedBody decode logic that most other projects borrowed
- Fatbobman, "Deep Dive into iMessage" ([fatbobman.com](https://fatbobman.com)) — why polling beat
  pure filesystem watching for a real-time agent use case
