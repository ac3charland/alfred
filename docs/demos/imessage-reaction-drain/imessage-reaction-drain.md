---
branch: claude/alf-287-imessage-reactions-drain
---

# An iMessage reaction drains the message it answers

*2026-09-30T02:56:42.192Z*

**ALF-287.** Loving, liking or laughing at an iMessage is how the owner answers it — but the comms queue kept the message waiting for a reply, because the daemon's chat.db query dropped *every* tapback row (`associated_message_type` 2000–3999), the owner's own included. The server drains a queued row only when an **outbound** message lands on the same thread after it (`comm_record_reply`), so a reaction never reached the one thing that could clear it.

The fix keeps a tapback the owner **added** (`is_from_me = 1`, 2000–2999) and ships it as an outbound row on the chat's thread; the server's existing drain does the rest. Someone else's tapback, and the owner *removing* a reaction, still stay out.

The probe below builds a throwaway chat.db with three conversations — the owner loves, likes and laughs at one message each, then removes the laugh, types a reply, and the contact loves that reply — runs the daemon's real iMessage source over it once, and prints the payload that poll would POST. Before the fix the same probe sent no reaction rows at all: only the inbound messages and the owner's typed reply.

```bash
node docs/demos/imessage-reaction-drain/poll-probe.mts
```

```output
chat.db rows: 9   messages the poll sends: 7

ROW-10  12:00  inbound   iMessage;-;+13125550100   can you send the lease tonight?
ROW-11  12:03  outbound  iMessage;-;+13125550100   Loved “can you send the lease tonight?”
ROW-12  12:10  inbound   iMessage;-;+13125550199   dinner at 7 still good?
ROW-13  12:11  outbound  iMessage;-;+13125550199   Liked “dinner at 7 still good?”
ROW-14  12:20  inbound   iMessage;-;+13125550142   you will not believe this
ROW-15  12:21  outbound  iMessage;-;+13125550142   Laughed at “you will not believe this”
ROW-17  12:23  outbound  iMessage;-;+13125550142   calling you now
```

Each reaction arrives as an `outbound` row on the reacted-to message's `thread_key`, timestamped after it — exactly the shape `comm_record_reply` clears a queued inbound row with. The owner's removed laugh (ROW-16) and the contact's love of the owner's reply (ROW-18) stay off the wire.
