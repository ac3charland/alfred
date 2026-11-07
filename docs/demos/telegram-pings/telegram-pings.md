---
branch: claude/beautiful-feynman-i76xug
---

# ALF-333: ASAP comms and due-times ping Telegram

*2026-11-07T02:23:40.570Z*

alfred now messages the owner's phone through a private Telegram bot in two cases: the model has just judged an inbound message ASAP, or a timed task's due minute has arrived. A new every-minute Worker cron (the notify tick) calls one RPC, `claim_notifications`, sends each claim with one `sendMessage`, and records it in the new `notifications` table. Everything below runs the shipped code (`docs/demos/telegram-pings/harness.ts`); nothing is mocked.

## 1. What a ping says

Both kinds, exactly as the Worker builds them in `workers/src/notify/format.ts`: a bold headline, the ask or the task title, a link into alfred. The ping carries the sender, the account and alfred's one-line ask, never the message body. Each one also has a plain-text twin, which the Worker resends once if Telegram rejects the HTML with a 400. The third ping is a hostile one: markup and an emoji are escaped and render literally, and an ask over 300 characters is cut to 300 with an ellipsis.

```bash
node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-pings/harness.ts render 2>/dev/null
```

```output
── comms_asap — HTML sent to Telegram
<b>ASAP · Dana · iMessage</b>
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
<b>ASAP · A&amp;B &lt;Co&gt; · Gmail</b>
Is &lt;b&gt;this&lt;/b&gt; &gt; that? 🎉 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…
<a href="https://alfred-six-gamma.vercel.app/comms">Open comms</a>
── comms_asap with markup, emoji and a 400+ char ask — plain-text fallback
ASAP · A&B <Co> · Gmail
Is <b>this</b> > that? 🎉 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…
https://alfred-six-gamma.vercel.app/comms
```

## 2. What pings, and when

`claim_notifications` against a throwaway PostgreSQL with every migration applied. The seeded world covers each rule: a fresh model ASAP verdict (Dana), a stale one judged an hour ago (Sam), an ASAP the owner set themselves (Lee), a 3:00 PM task, a task already 30 minutes overdue, a date-only task and a completed one. Each tick claims what just became true. Dana pings once. The dentist pings at 3:00 PM Chicago and not again. When it is moved to 3:20 the task re-arms and pings once more. Sam, Lee, the overdue task, the date-only task and the completed task never ping.

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

## 3. A real call to Telegram

One live `sendTelegram` against `api.telegram.org` with an obviously fake token. Telegram answers 401, which the Worker treats as a systemic failure: the tick stops with a banner and counts no attempt, so a token fixed within the hour still delivers everything claimed meanwhile. A real send can't be captured here, because the token travels in the URL path, where the cloud proxy can't inject it, and secrets never go in the sandbox. The owner's first real ping (step 8 of `docs/telegram.md`) is the live confirmation.

```bash
node --import ./workers/scripts/ts-resolve.mjs docs/demos/telegram-pings/harness.ts live 2>/dev/null
```

```output
{"outcome":{"kind":"systemic","error":"HTTP 401: Unauthorized"},"requests":1}
```
