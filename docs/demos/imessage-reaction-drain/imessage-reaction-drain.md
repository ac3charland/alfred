---
branch: claude/alf-287-imessage-reactions-drain
---

# An iMessage reaction drains the message it answers

*2026-09-30T02:45:34.110Z*

**ALF-287.** Loving, liking or laughing at an iMessage is how the owner answers it — but the comms queue kept the message waiting for a reply, because the daemon's chat.db query dropped *every* tapback row (`associated_message_type` 2000–3999), the owner's own included. The server drains a queued row only when an **outbound** message lands on the same thread after it (`comm_record_reply`), so a reaction never reached the one thing that could clear it.

The fix keeps a tapback the owner **added** (`is_from_me = 1`, 2000–2999) and ships it as an outbound row on the chat's thread; the server's existing drain does the rest. Someone else's tapback, and the owner *removing* a reaction, still stay out.

The probe below builds a throwaway chat.db with three conversations — the owner loves, likes and laughs at one message each, then removes the laugh, and the contact loves the laugh — runs the daemon's real iMessage source over it once, and prints the payload that poll would POST. Before the fix the same probe printed only the three inbound rows, so nothing outbound reached the drain.

```bash
node docs/demos/imessage-reaction-drain/poll-probe.mts
```

```output
chat.db rows: 8   messages the poll sends: 6

ROW-10  12:00  inbound   iMessage;-;+13125550100   can you send the lease tonight?
ROW-11  12:03  outbound  iMessage;-;+13125550100   Loved “can you send the lease tonight?”
ROW-12  12:10  inbound   iMessage;-;+13125550199   dinner at 7 still good?
ROW-13  12:11  outbound  iMessage;-;+13125550199   Liked “dinner at 7 still good?”
ROW-14  12:20  inbound   iMessage;-;+13125550142   you will not believe this
ROW-15  12:21  outbound  iMessage;-;+13125550142   Laughed at “you will not believe this”
```

Each reaction arrives as an `outbound` row on the reacted-to message's `thread_key`, timestamped after it — exactly the shape `comm_record_reply` clears a queued inbound row with. The owner's removed laugh (ROW-16) and the contact's love (ROW-17) stay off the wire.
