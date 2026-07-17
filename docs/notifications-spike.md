# Spike: outbound notifications via Telegram

**Decision.** alfred sends itself notifications through a **dedicated Telegram bot**, delivered
from the **existing Cloudflare Worker** (`workers/`) as a plain `fetch` to the Telegram Bot
API. No SDK, no new cloud provider, no per-message cost. This document is the technical
justification and shape for a future implementation spec — not the spec itself.

## Where we landed

- **Channel:** a private Telegram bot, created via [@BotFather](https://t.me/BotFather),
  messaging a single chat (the owner). alfred gets its **own** communication channel, distinct
  from the owner's personal messaging.
- **Transport:** one HTTPS call from the Worker —
  `POST https://api.telegram.org/bot<TOKEN>/sendMessage` with `{ chat_id, text }`. That's the
  entire outbound integration. It fits the Worker's existing "route matched in code, secrets in
  a typed `Env`" model (see [`workers/src/index.ts`](../workers/src/index.ts)).
- **Secrets:** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, set with `wrangler secret put` and
  added to the Worker's `Env` interface — never committed, exactly like the existing
  `GITHUB_*` / `SUPABASE_*` secrets.
- **Cost:** free. Telegram's Bot API has no per-message charge.

## Why Telegram — four benefits, not one

The cost saving alone would be marginal at single-user volume; Telegram earns its place because
the same integration buys four things the walled-garden alternatives buy none of:

1. **Cheap/zero-cost, zero-infra outbound.** A single `fetch` from a Worker we already run.
2. **A clean inbound tap for the future Communication Firewall** (SPEC §13.2). That module is an
   *inbound* problem — something must read incoming messages programmatically. Telegram's Bot API
   is one of the very few consumer channels that permits that cleanly and free (webhook or
   long-poll, structured JSON, no vendor review). See the sidebar on inbound scope below.
3. **Per-device notification isolation.** Telegram supports per-chat notification settings (mute,
   custom sound, DND exceptions) on each device independently. A dedicated alfred bot gets its own
   alerting profile — silent on the laptop, custom tone on the phone — without touching how any
   other messages behave. A shared SMS/iMessage inbox can't isolate like that.
4. **A first-class transport shared with the agent ecosystem.** Telegram is a documented,
   first-class channel for the agent frameworks alfred's **Software Factory** (SPEC §13.3) would
   plausibly lean on — [OpenClaw](https://docs.openclaw.ai/channels/telegram) (native message
   actions + cron/subagent notification routing) and
   [Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram)
   (BotFather → webhook in ~5 min, voice-memo auto-transcription, per-user auth). Adopting
   Telegram now means those modules plug into the same pipe later, with no second integration.

## Technical shape (for the implementation spec to expand)

- **New Worker outbound helper.** A small `sendTelegram(env, text)` module alongside the existing
  `supabase.ts` / `github.ts`, wrapping the `sendMessage` call. Unit-tested against a mocked
  `fetch`, mirroring how the Worker's other outbound calls are tested.
- **Trigger surface — deferred, but two candidates.** (a) A **Cron-triggered** send (Cloudflare
  Cron Triggers via `[triggers] crons` in `wrangler.toml` + a `scheduled` handler) for
  time-based nudges; (b) an **event-driven** send from existing flows (e.g. a factory transition
  in `index.ts` that's worth surfacing). The spec picks which events warrant a notification.
- **Message formatting.** Telegram supports `parse_mode: MarkdownV2` / `HTML`. Decide escaping
  strategy in the spec (MarkdownV2 has strict escaping rules).
- **Security / authorization.** The bot token is a full credential — anyone holding it controls
  the bot. Store it only as a Worker secret; rotate via BotFather `/revoke` if leaked. For any
  future *inbound* handler, authorize on `chat_id` (only act on the owner's chat) — the same
  single-user trust posture as the `INGEST_API_KEY` path in
  [`docs/siri-capture.md`](./siri-capture.md).

### Forward-compatibility with the Communication Firewall

Structure the outbound work so the **inbound** side slots in without rework:

- Register a `/telegram/webhook` route in the Worker (a sibling to `/github/webhook`), pointed at
  by Telegram's `setWebhook`. HMAC/secret-token verify it the way `/github/webhook` verifies its
  signature.
- Inbound messages (and Hermes-style **voice memos → transcription**) map naturally onto alfred's
  single ingest seam, `POST /api/items` (SPEC §4.2, [`docs/siri-capture.md`](./siri-capture.md)):
  a Telegram message becomes an Inbox item. This is the concrete bridge from "notifications" to
  the firewall's triage queue — but it is **out of scope for this spike**; captured here only so
  the outbound design doesn't foreclose it.

> **Sidebar — inbound scope, so we're not misled.** A Telegram *bot* can only read messages
> **addressed to it** (DMs to the bot, or groups it's in with privacy mode off). It **cannot**
> read the owner's existing personal DMs with other people. Tapping the real account stream would
> need a *userbot* (MTProto), which is heavier and carries account-flagging risk. The firewall's
> realistic model is therefore "things get routed *to* the bot / in via email," not "the bot
> silently reads everything." Telegram is the best *available* consumer tap, not a skeleton key.

## Sidebars: appealing alternatives we're not taking

> **Why not SMS via SNS / Twilio (land it in iMessage)?** The only way into the native Messages
> app is a real SMS/iMessage — iMessage is a closed Apple system with no server-side send API
> short of running a Mac as a relay. That forces an SMS provider, which brings: a per-message cost
> (pennies at our volume, but nonzero), US A2P (10DLC / toll-free) carrier registration that is
> **identical across SNS and Twilio**, and — critically — **no inbound tap** for the firewall and
> **no per-device isolation** (it's one Messages firehose). The cost win of SNS over Twilio is
> marginal at single-user volume (Twilio's cost is dominated by number rental, not messages). If
> native-Messages delivery ever becomes a hard requirement, the minimal path is a direct SNS
> `Publish` to a verified number from the Worker (SNS's sandbox, which restricts sends to verified
> numbers, actually *fits* self-notification) — still no CDK, and explicitly not this plan.

> **Why not Pushover?** It is **not** SMS and does **not** land in iMessage — it's push to its own
> app. So it costs a separate app install (the same "another app" price as Telegram) while
> delivering **none** of Telegram's other three benefits: no firewall inbound API, and it's not
> the agent-ecosystem transport. On our own criteria it's strictly dominated by Telegram.

> **Why a dedicated bot rather than reusing a channel the owner already uses?** Deliberate. A
> bot that exists only for alfred is what makes per-device notification tuning meaningful and
> keeps productivity-system noise quarantined from personal messaging.

## Cost & open questions for the spec

- **Cost:** $0 outbound.
- **Open questions:** which events trigger a notification (and at what tier); message formatting /
  escaping choice; whether to build the inbound webhook now or defer to the firewall module;
  Telegram Bot API rate limits (~30 msg/s, ~1 msg/s per chat — irrelevant at our volume but worth
  a line); whether notifications should also cover **operational alerts** (e.g. a failed nightly
  backup — see [`scheduled-cloud-backups.md`](./scheduled-cloud-backups.md); the two features stay
  independent, but this channel is the obvious sink for that alert later).

## Sources

- [Telegram Bot API — sendMessage](https://core.telegram.org/bots/api#sendmessage)
- [OpenClaw — Telegram channel](https://docs.openclaw.ai/channels/telegram)
- [Hermes Agent — Telegram messaging](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram)
