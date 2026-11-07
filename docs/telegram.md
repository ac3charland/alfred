# Telegram pings

alfred messages your phone through a private Telegram bot in three cases:

- **ASAP comms** — the model has just judged an inbound message ASAP. The ping names the sender,
  the account and alfred's one-line ask, never the message body or subject.
- **Due times** — a task with a due *time* has reached that minute. Tasks with only a date never ping.
- **The morning digest** — once a day at `DIGEST_TIME` (07:00 Chicago): a short model-written
  opener, then what's due (the Today view's list, at most eight rows), your ASAP and Today comms
  (counts plus up to five asks), and how many reader articles are waiting.

```
ASAP · Dana · iMessage                Due 3:00 PM
Asks whether you can pick up …        Call the dentist about the crown
Open comms                            Open Today
```

The bot only sends: it has no buttons and ignores replies. Bot chats are Telegram "cloud chats",
which are stored on Telegram's servers **without end-to-end encryption**, so every ask sits there.

## How it works

The Worker's `* * * * *` cron runs the notify tick (`workers/src/notify/tick.ts`). Each minute it
calls `claim_notifications` (migration `0054_notifications.sql`), sends each claim with one
`sendMessage` (`workers/src/telegram.ts`), and records the result in the `notifications` table.

- **Never pings:** a tier you set yourself, a verdict over 30 minutes old (so deploy day and outages
  don't replay a backlog), or a due time over 15 minutes past.
- **Time zone:** due times are read in `CLASSIFIER_TIMEZONE` (`America/Chicago`), wherever the phone
  is. If you travel, a 3 PM task still pings at 3 PM Chicago time.
- **Once each:** a message pings at most once. A task pings once per date and time, so a reschedule
  re-arms it.
- **Failures:** a 5xx is retried on the next tick, up to 3 attempts within an hour. A 429 waits
  for the next tick. Delivery is at most once: if Telegram accepted a ping but alfred failed to
  record it (or the Worker died mid-tick), the claim is abandoned five minutes later rather than
  resent, so a database blip can cost a ping but never doubles one. A 401/403, or a 400 "chat not found" (bad token, wrong chat id, chat never
  started, bot blocked) stops the tick with a `notify: aborting the tick` line in `wrangler tail`.
- **Digest:** claimed by the first tick in the hour after `DIGEST_TIME`, once per local date, so a
  deploy after 8 AM starts tomorrow. Only the opener comes from the model (`DIGEST_MODEL`, with
  today's week-plan lines and theme as context); if the call fails or the key is missing, the
  digest still goes out on time with today's plan lines listed instead. `DIGEST_TIME = ""` turns
  it off; `GET /` says which.
- **Off switch:** until `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `ALFRED_APP_URL` are all set,
  the tick logs `notify: telegram unconfigured` and claims nothing.

## One-time setup

1. **Install Telegram** on the iPhone from the App Store and sign up or log in with your phone number.
2. **Create the bot.** Search for `@BotFather` (it has the blue verified check) and send `/newbot`.
   Name it `alfred`. The username must be unique and end in `bot`, e.g. `ac3_alfred_bot`. BotFather
   replies with the token. Treat it like a password: never paste it into a Claude chat, a commit or
   a demo doc. (The secret scan flags anything shaped like one.)
3. **Lock it down.** In BotFather, send `/setjoingroups`, pick the bot and choose **Disable**, so
   nobody can add it to a group.
4. **Start the chat.** Open the `t.me/<username>` link from BotFather's reply and tap **Start**. A bot
   can't message you until you've started it. Skip this and every send fails with 403.
5. **Find your chat id on the Mac**, not in a cloud session:

   ```sh
   read -rs TOKEN        # paste the token, then Enter (it stays out of shell history)
   curl -s "https://api.telegram.org/bot$TOKEN/getUpdates"
   ```

   The number at `result[0].message.chat.id` is your chat id. If `result` is empty, send the bot
   "hi" and run it again.
6. **Set the secrets** from `workers/`, pasting each value when prompted:

   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   ```

   No redeploy is needed.
7. **Check it's configured.** `curl -s https://alfred-workers.alfred-six-gamma.workers.dev/`
   should include `telegram configured`.
8. **Live check.** Give a task a time two minutes from now. The ping should arrive within about a
   minute of that time. If it doesn't, run `npx wrangler tail` and look for the `notify:` line and
   any `HTTP <status>: <description>`.

## Tune the alerts on the phone

alfred sends every ping with sound. How loud or quiet it is gets decided on the phone:

- In the alfred chat, tap the bot's name, then **Notifications**, to give it its own sound and make
  sure it isn't muted.
- In iOS **Settings → Notifications → Telegram**, allow notifications and the lock screen.
- To keep the ask off your lock screen, turn off **Telegram → Settings → Notifications and Sounds →
  Show Previews**.
- To let ASAP pings break through a Focus, add Telegram under **Focus → Allowed Apps**. iOS allows
  apps, not chats, so mute your other Telegram chats.
- If you install Telegram on the Mac too, mute the alfred chat there to avoid double alerts.
- Sent pings stay in the chat until you delete them. alfred's own copy is deleted with its message
  or task. If the app offers it, turn on the chat's auto-delete timer.

## If the token leaks

Send `/revoke` in BotFather, pick the bot, then run `npx wrangler secret put TELEGRAM_BOT_TOKEN`
with the new token.

## Before the first deploy

This uses the Cloudflare account's **fifth and last** free cron trigger. Check in the Cloudflare
dashboard that no other Worker on the account uses a trigger. If one does, `wrangler deploy` fails
on the trigger count. The fix is moving to the Workers Paid plan or dropping a schedule.
