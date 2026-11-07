---
name: telegram
description: >
  Covers the Telegram Bot API: sendMessage, HTML parse_mode and escaping, link_preview_options,
  the response envelope (ok, description, error_code, retry_after), status codes, BotFather,
  getUpdates and the chat id, bot-token hygiene, and the Worker's notify tick
  (workers/src/notify/). Use when sending or changing a Telegram ping, debugging a failed send, or
  touching TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID. Trigger on: "telegram", "bot api", "BotFather",
  "sendMessage", "parse_mode", "can't parse entities", "getUpdates", "notify tick", "ping my
  phone", "push notification". Pairs with the cloudflare-workers skill.
---

# Telegram Bot API

Verified against **Bot API 10.3** (core.telegram.org/bots/api, 2026-11). The owner-facing setup
steps are in [`docs/telegram.md`](../../../docs/telegram.md); this skill is for changing the code.

## Mental model

- **A bot is an HTTPS endpoint keyed by its token.** Every call is
  `https://api.telegram.org/bot<token>/<method>`, GET or POST, JSON body. There is no SDK in the
  Worker and none is needed: one `fetch` per call.
- **The token is in the URL path, not a header.** So the proxy can't inject it, and anything that
  logs a request URL (or an error message built from one) leaks it. alfred's only Bot API module is
  `workers/src/telegram.ts`; it scrubs the token from every caught message (`redact`).
- **A bot can only message a chat that has started it.** The owner taps **Start** once; until then
  `sendMessage` is a 403. The chat id is learned once from `getUpdates` and stored as a secret.
- **Every response is an envelope:** `{ ok, result?, description?, error_code?, parameters? }`.
  `error_code` "is subject to change" per the docs — **branch on the HTTP status**, read
  `description` for humans and `parameters.retry_after` on a 429.
- **Bot chats are cloud chats:** stored server-side, not end-to-end encrypted, and the bot can't
  read its own sent messages back. Record what you sent at send time if you'll need it
  (`notifications.text`).

## Plain-English → pattern

| Want | Pattern |
| --- | --- |
| Send the owner a formatted ping | `POST …/sendMessage` with `{ chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }` — `sendTelegram(env, html, plain)` |
| Bold / a link | `<b>…</b>`, `<a href="…">…</a>`; only the documented tags are allowed |
| Put user text inside HTML | Escape `&` first, then `<` and `>` (`escapeHtml` in `notify/format.ts`). Named entities are limited to `&lt; &gt; &amp; &quot;` |
| Survive an escaping bug | On 400, resend once as plain text with no `parse_mode` (already in `sendTelegram`) |
| No link card under the ping | `link_preview_options: { is_disabled: true }` (replaces the old `disable_web_page_preview`) |
| Silent ping | `disable_notification: true` — alfred deliberately doesn't set it; the phone decides |
| Add a new kind of ping | A `kind` in the `notifications` check + `claim_notifications`, a builder in `notify/format.ts`, a branch in `notify/tick.ts`'s `textFor` |
| Find a chat id | `curl -s "https://api.telegram.org/bot$TOKEN/getUpdates"` → `result[0].message.chat.id`, after sending the bot a message. Only on the owner's Mac |
| Check a token is live without sending | `getMe` (401 = bad token) |

## Status handling (what `sendTelegram` maps to)

| HTTP | Outcome | Notify tick does |
| --- | --- | --- |
| 2xx with `result.message_id` | `sent` | stamp `sent_at`, `telegram_message_id`, `text` |
| 400 | plain-text resend, then `rejected` if it 400s again | count an attempt |
| 401, 403, 404 | `systemic` (bad token / never started / blocked) | abort the tick, count nothing |
| 429 | `rate_limited` (+ `retry_after`) | stop the tick, count nothing |
| 5xx, network, 10 s timeout | `transient` | count an attempt; retried next tick |

## Common pitfalls

- **Never log the request URL or a raw caught `fetch` error** — some runtimes put the URL (token
  included) in the message. Log `HTTP <status>: <description>` only.
- **Never commit a real-shaped token, even a fake one.** `/.secretlintrc.json` flags
  `\d{8,10}:[A-Za-z0-9_-]{35,}`; build test tokens at runtime (`['123456789', ':', 'AAF', …].join('')`).
- **Never make a live Telegram call from a test or a cloud session.** Suites stub `fetch`
  (`spyOnFetch`). An unauthenticated `getMe` with a fake token (→ 401) is the only safe live call.
- **A 4096-character limit applies after entity parsing.** alfred caps an ask at 300 and a title at
  200 graphemes (`cap`), so it never comes close — don't cap by code units, or an emoji splits.
- **About one message per second per chat.** Bursts are tolerated, then 429. Don't sleep in the
  Worker to pace sends; stop and let the next tick retry.
- **`getUpdates` and a webhook are mutually exclusive**, and updates are kept only 24 hours. If a
  webhook is ever added, `getUpdates` stops working for finding the chat id.
- **Each send costs a Worker subrequest.** The notify tick budgets 50 per invocation: 1 claim RPC,
  then 2 per ping (+1 per plain-text resend). See `SUBREQUEST_CEILING` in `notify/tick.ts`.

## Deliberately left out

- **Inline buttons, replies, commands** — they need an inbound webhook (secret-token header, chat
  authorization, callback handling). Send-only until a ticket asks.
- **MarkdownV2** — about eighteen reserved characters to escape versus three for HTML.
- **Bot SDKs (grammY, Telegraf)** — one `fetch` covers the surface; an SDK adds bundle size for nothing.
- **Groups and channels** — `/setjoingroups` is disabled; the bot writes to one private chat.
