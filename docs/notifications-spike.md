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
2. **Alfred's notifications become first-class in the future Communication Firewall** (SPEC §13.2).
   That module aggregates the owner's communications (email, iMessage, …) into one triage/display
   surface. Because Alfred's notifications live in their **own** Telegram channel, the firewall can
   surface them there **alongside** emails and iMessages — as a distinct, clearly-labeled source
   rather than commingled with personal messages. Direction matters: this is the firewall
   **consuming Alfred's Telegram channel** (Alfred reading Telegram), **not** the bot reading the
   owner's other conversations. See the forward-compatibility note below.
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

The firewall integration is a **display** concern: Alfred's notifications should appear in the
firewall's unified view (SPEC §13.2), alongside email and iMessage, as their own labeled stream.
Structure the notification work so that's possible later without rework:

- **Keep the notification stream identifiable.** Alfred authors these messages, so their content is
  inherently available to it — persist/record each notification (or its Telegram message id) at
  send time so the firewall can render the stream as a discrete source. Whether the firewall reads
  it back from Telegram or from Alfred's own record is a spec-time detail (note the Bot API can't
  fetch a bot's own message history, so recording at send time is the natural path).
- **Mind the direction.** This is **Alfred reading Telegram** — surfacing its own channel in the
  firewall — **not** the Telegram bot tapping the owner's personal conversations. A bot only ever
  sees messages addressed to it; it is not, and this spike does not make it, a reader of the
  owner's other chats.
- Out of scope for this spike; captured only so the notification design keeps notifications
  identifiable as a discrete stream the firewall can later display.

## Sidebars: appealing alternatives we're not taking

> **Why not SMS via SNS / Twilio (land it in iMessage)?** The only way into the native Messages
> app is a real SMS/iMessage — iMessage is a closed Apple system with no server-side send API
> short of running a Mac as a relay. That forces an SMS provider, which brings: a per-message cost
> (pennies at our volume, but nonzero), US A2P (10DLC / toll-free) carrier registration that is
> **identical across SNS and Twilio**, and — critically — Alfred's notifications would land
> **commingled in the personal iMessage stream**. That defeats **per-device isolation** (it's one
> Messages firehose) and, in the firewall's unified view, leaves Alfred's messages indistinguishable
> from personal iMessages rather than their own labeled source. The cost win of SNS over Twilio is
> marginal at single-user volume (Twilio's cost is dominated by number rental, not messages). If
> native-Messages delivery ever becomes a hard requirement, the minimal path is a direct SNS
> `Publish` to a verified number from the Worker (SNS's sandbox, which restricts sends to verified
> numbers, actually *fits* self-notification) — still no CDK, and explicitly not this plan.

> **Why not Pushover?** It is **not** SMS and does **not** land in iMessage — it's push to its own
> app. So it costs a separate app install (the same "another app" price as Telegram) while
> delivering **none** of Telegram's other three benefits: it's a closed push silo the firewall
> can't read to surface Alfred's stream, and it's not the agent-ecosystem transport. On our own
> criteria it's strictly dominated by Telegram.

> **Why a dedicated bot rather than reusing a channel the owner already uses?** Deliberate. A
> bot that exists only for alfred is what makes per-device notification tuning meaningful and
> keeps productivity-system noise quarantined from personal messaging.

## Cost & open questions for the spec

- **Cost:** $0 outbound.
- **Open questions:** which events trigger a notification (and at what tier); message formatting /
  escaping choice; how notifications are persisted so the firewall can later surface them as a
  discrete source (record at send time vs. read back from Telegram);
  Telegram Bot API rate limits (~30 msg/s, ~1 msg/s per chat — irrelevant at our volume but worth
  a line); whether notifications should also cover **operational alerts** (e.g. a failed nightly
  backup — see [`scheduled-cloud-backups.md`](./scheduled-cloud-backups.md); the two features stay
  independent, but this channel is the obvious sink for that alert later).

## Sources

- [Telegram Bot API — sendMessage](https://core.telegram.org/bots/api#sendmessage)
- [OpenClaw — Telegram channel](https://docs.openclaw.ai/channels/telegram)
- [Hermes Agent — Telegram messaging](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram)
