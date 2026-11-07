---
branch: claude/beautiful-feynman-i76xug
---

# ALF-333: ASAP comms and due-times ping Telegram

*2026-11-07T02:46:00.099Z*

alfred now messages the owner's phone through a private Telegram bot in two cases: the model has just judged an inbound message ASAP, or a timed task's due minute has arrived. A new every-minute Worker cron (the notify tick) calls one RPC, `claim_notifications`, sends each claim with one `sendMessage`, and records it in the new `notifications` table.

Every section runs the shipped code through `docs/demos/telegram-pings/harness.ts`, on a throwaway PostgreSQL carrying every migration. Two things are stood up locally, and the harness header says so. Section 2 marks each claim sent by hand, where the Worker would. Section 3 swaps the global `fetch`: Supabase REST calls become the same SQL against that database, and each Telegram send is answered from a script, because no real chat is reachable from here. Section 4 is a real call to Telegram.

## 1. What a ping says

Both kinds, exactly as the Worker builds them in `workers/src/notify/format.ts`. The first line opens with a bold word, the second is the ask or the task title, and the third is a link into alfred. A ping carries the sender, the account and alfred's one-line ask, never the message body. Each ping also has a plain-text twin, which the Worker resends once if Telegram rejects the HTML with a 400. The third example is a hostile one: markup and an emoji are escaped and render literally, and an ask over 300 characters is cut to 300 with an ellipsis.

```bash
node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-pings/harness.ts render 2>/dev/null
```

```output
── comms_asap — HTML sent to Telegram
<b>ASAP</b> · Dana · iMessage
Asks whether you can pick up the kids at 4 today.
<a href="https://alfred-six-gamma.vercel.app/comms">Open comms</a>
── comms_asap — plain-text fallback
ASAP · Dana · iMessage
Asks whether you can pick up the kids at 4 today.
https://alfred-six-gamma.vercel.app/comms

── task_due — HTML sent to Telegram
<b>Due 3:00 PM</b>
Call the dentist about the crown
<a href="https://alfred-six-gamma.vercel.app/today">Open Today</a>
── task_due — plain-text fallback
Due 3:00 PM
Call the dentist about the crown
https://alfred-six-gamma.vercel.app/today

── comms_asap with markup, emoji and a 400+ char ask — HTML sent to Telegram
<b>ASAP</b> · A&amp;B &lt;Co&gt; · Gmail
Is &lt;b&gt;this&lt;/b&gt; &gt; that? 🎉 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…
<a href="https://alfred-six-gamma.vercel.app/comms">Open comms</a>
── comms_asap with markup, emoji and a 400+ char ask — plain-text fallback
ASAP · A&B <Co> · Gmail
Is <b>this</b> > that? 🎉 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…
https://alfred-six-gamma.vercel.app/comms
```

## 2. What pings, and when

`claim_notifications` at a series of instants. The seeded world covers each rule:

- Dana: a fresh model ASAP verdict.
- Sam: an ASAP verdict judged an hour ago.
- Lee: an ASAP the owner set themselves.
- Four tasks: one due at 3:00 PM, one already 30 minutes overdue, one with only a date, and one completed.

Dana pings once. The dentist pings at 3:00 PM Chicago and not again. When it moves to 3:20 PM it re-arms and pings once more. Sam, Lee, and the overdue, date-only and completed tasks never ping.

```bash
node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-pings/harness.ts windows 2>/dev/null
```

```output
Seeded (Chicago time, 2031-01-15):
  tasks     Call the dentist 3:00 PM · Pick up dry cleaning 2:30 PM ·
            Renew passport (date only) · Pay rent 3:00 PM (completed)
  messages  Dana ASAP, model, judged 2:58 PM · Sam ASAP, model, judged 2:00 PM ·
            Lee ASAP, set by the owner

tick 14:59 → comms_asap: Dana — Asks whether you can pick up the kids at 4 today.
tick 15:00 → task_due: Call the dentist about the crown @ 15:00
tick 15:01 → nothing

The dentist moves to 3:20 PM:
tick 15:19 → nothing
tick 15:20 → task_due: Call the dentist about the crown @ 15:20
tick 15:21 → nothing

notifications rows (one per ping):
  comms_asap <id>
  task_due   <id>|2031-01-15|15:00
  task_due   <id>|2031-01-15|15:20
```

## 3. The tick end to end: claim, send, record

The shipped `runNotifyTick` over five tasks due a minute apart, with Telegram's replies scripted so every outcome is exercised. Each delivered ping leaves its row stamped with the text Telegram actually received: HTML, or the plain twin after a 400.

- A **502** counts an attempt and is retried.
- A **429** stops the tick without counting one.
- A claim just handed to a tick is leased for five minutes, so the next minute's tick can't race it into a duplicate ping. At 3:05 PM the leftovers are retried and delivered.
- A **401** aborts the tick and counts nothing.
- With the bot token unset, the tick makes no request at all.

```bash
node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-pings/harness.ts tick 2>/dev/null
```

```output
Five tasks due 2:56 to 3:00 PM Chicago, one a minute.

tick 3:00 PM: 200; 400 then the plain resend 200; 502; 429 stops the tick
  telegram <- HTML  -> 200
  telegram <- HTML  -> 400
  telegram <- plain -> 200
  telegram <- HTML  -> 502
  telegram <- HTML  -> 429
  summary {"claimed":5,"sent":2,"failed":1,"abandoned":0,"aborted":false}
  failure task_due <id>: HTTP 502: scripted
  failure rate limited (retry after 3s) — the rest wait for the next tick
  row  Call the dentist  sent=true  attempts=0 error=- text=<b>Due 2:56 PM</b>
  row  Book flights      sent=true  attempts=0 error=- text=Due 2:57 PM
  row  Water the plants  sent=false attempts=1 error=HTTP 502: scripted text=-
  row  Pay the sitter    sent=false attempts=0 error=- text=-
  row  Email Sam         sent=false attempts=0 error=- text=-

tick 3:01 PM: the leftovers are leased to the last tick for five minutes
  summary {"claimed":0,"sent":0,"failed":0,"abandoned":0,"aborted":false}
  row  Call the dentist  sent=true  attempts=0 error=- text=<b>Due 2:56 PM</b>
  row  Book flights      sent=true  attempts=0 error=- text=Due 2:57 PM
  row  Water the plants  sent=false attempts=1 error=HTTP 502: scripted text=-
  row  Pay the sitter    sent=false attempts=0 error=- text=-
  row  Email Sam         sent=false attempts=0 error=- text=-

tick 3:05 PM: the 502, the 429 and the never-tried claim are retried
  telegram <- HTML  -> 200
  telegram <- HTML  -> 200
  telegram <- HTML  -> 200
  summary {"claimed":3,"sent":3,"failed":0,"abandoned":0,"aborted":false}
  row  Call the dentist  sent=true  attempts=0 error=- text=<b>Due 2:56 PM</b>
  row  Book flights      sent=true  attempts=0 error=- text=Due 2:57 PM
  row  Water the plants  sent=true  attempts=1 error=HTTP 502: scripted text=<b>Due 2:58 PM</b>
  row  Pay the sitter    sent=true  attempts=0 error=- text=<b>Due 2:59 PM</b>
  row  Email Sam         sent=true  attempts=0 error=- text=<b>Due 3:00 PM</b>

tick 3:06 PM: a 401 aborts the tick and counts nothing
  telegram <- HTML  -> 401
  summary {"claimed":1,"sent":0,"failed":0,"abandoned":0,"aborted":true}
  failure systemic: HTTP 401: scripted
  row  Call the dentist  sent=true  attempts=0 error=- text=<b>Due 2:56 PM</b>
  row  Book flights      sent=true  attempts=0 error=- text=Due 2:57 PM
  row  Water the plants  sent=true  attempts=1 error=HTTP 502: scripted text=<b>Due 2:58 PM</b>
  row  Pay the sitter    sent=true  attempts=0 error=- text=<b>Due 2:59 PM</b>
  row  Email Sam         sent=true  attempts=0 error=- text=<b>Due 3:00 PM</b>
  row  Feed the cat      sent=false attempts=0 error=- text=-

tick with TELEGRAM_BOT_TOKEN unset:
notify: telegram unconfigured
  summary {"claimed":0,"sent":0,"failed":0,"abandoned":0,"aborted":false,"failures":[]} · requests made: 0
```

## 4. A real call to Telegram

One live `sendTelegram` against `api.telegram.org` with an obviously fake token. Telegram answers 401, which the Worker treats as systemic, as section 3 showed. A real send can't be captured here: the token travels in the URL path, where the cloud proxy can't inject it, and secrets never go in the sandbox. The owner's first real ping (step 8 of `docs/telegram.md`) is the live confirmation. `GET /` reporting `telegram configured|unconfigured` is pinned in `workers/src/index.test.ts`.

```bash
node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-pings/harness.ts live 2>/dev/null
```

```output
{"outcome":{"kind":"systemic","error":"HTTP 401: Unauthorized"},"requests":1}
```
