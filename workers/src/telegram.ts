/**
 * The only module that knows the Telegram Bot API — one call, `sendMessage`, to one private chat.
 *
 * The bot token travels in the URL PATH (`/bot<token>/sendMessage`), so nothing here ever logs
 * the request URL, and an error message that might have been built from it is scrubbed of the
 * token before it leaves this module. What a failure says is the HTTP status and Telegram's own
 * `description` — enough to read in `wrangler tail`, never enough to send as the bot.
 *
 * Outcomes branch on the HTTP status, not the body's `error_code`, which the Bot API documents as
 * "subject to change".
 */

/** The bindings a send needs: the token BotFather issued and the owner's chat with the bot. */
export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

/** What one send came to, for the notify tick's retry table. */
export type TelegramOutcome =
  | { kind: 'sent'; messageId: number }
  | { kind: 'rate_limited'; retryAfter?: number }
  /**
   * 5xx, a network failure, a timeout, or a 2xx without a message id: the request may have reached
   * Telegram and been shown, so a resend could duplicate it. Telegram offers no idempotency key.
   */
  | { kind: 'uncertain'; error: string }
  /** 400 even as plain text, or another 4xx this chat cannot fix by waiting. */
  | { kind: 'rejected'; error: string }
  /** 401/403/404, or a 400 "chat not found": a bad token or chat id, or a chat the bot can't write to. */
  | { kind: 'systemic'; error: string };

/** A send's outcome plus how many requests it took (two when the plain-text retry ran). */
export interface TelegramSend {
  outcome: TelegramOutcome;
  requests: 1 | 2;
}

const API = 'https://api.telegram.org';

/** A bad token (401; 404 when it names no bot) or a chat the bot may not write to (403). */
const SYSTEMIC_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/**
 * Generous on purpose. A send that times out may still have been shown (ALF-345), and then it can
 * be neither recorded nor resent, so waiting longer turns more slow sends into known ones. A tick
 * stops at the first timeout, so one hung send costs it at most this long.
 */
const SEND_TIMEOUT_MS = 30_000;

/** The response fields read — every one optional, because an error body need not carry them. */
interface BotApiResponse {
  ok?: boolean;
  result?: { message_id?: number };
  description?: string;
  parameters?: { retry_after?: number };
}

/** Replace every occurrence of the token, so no caught message can carry it out. */
export function redact(text: string, token: string): string {
  return token === '' ? text : text.split(token).join('<redacted>');
}

/**
 * Send `html` as Telegram HTML with link previews off. On a 400 — almost always "can't parse
 * entities", an escaping bug — resend once as `plain` with no parse mode, so the ping degrades
 * instead of being dropped.
 */
export async function sendTelegram(
  env: TelegramEnv,
  html: string,
  plain: string,
): Promise<TelegramSend> {
  const first = await post(env, {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
  // Only a 400 that could be the HTML's fault earns the plain-text resend.
  if (first.status !== 400 || isWrongChat(first)) {
    return { outcome: toOutcome(first), requests: 1 };
  }

  const second = await post(env, { chat_id: env.TELEGRAM_CHAT_ID, text: plain });
  return { outcome: toOutcome(second), requests: 2 };
}

/** One request's result: an HTTP status and body, or the (redacted) reason it never got one. */
type Reply = { status: number; body: BotApiResponse } | { status: 'network'; error: string };

async function post(env: TelegramEnv, payload: Record<string, unknown>): Promise<Reply> {
  try {
    const response = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = await response.json<BotApiResponse>().catch((): BotApiResponse => ({}));
    return { status: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { status: 'network', error: redact(message, env.TELEGRAM_BOT_TOKEN) };
  }
}

/**
 * A wrong `TELEGRAM_CHAT_ID` comes back as a 400, not a 403 — but like a bad token it fails every
 * send alike, so it must stop the tick rather than burn each claim's attempts and lose them.
 */
function isWrongChat(reply: Reply): boolean {
  return (
    reply.status === 400 && (reply.body.description ?? '').toLowerCase().includes('chat not found')
  );
}

function toOutcome(reply: Reply): TelegramOutcome {
  if (reply.status === 'network') return { kind: 'uncertain', error: reply.error };

  const { status, body } = reply;
  const error = `HTTP ${String(status)}${body.description === undefined ? '' : `: ${body.description}`}`;
  if (status >= 200 && status < 300 && body.ok === true && body.result?.message_id !== undefined) {
    return { kind: 'sent', messageId: body.result.message_id };
  }
  if (status === 429) {
    const retryAfter = body.parameters?.retry_after;
    return retryAfter === undefined
      ? { kind: 'rate_limited' }
      : { kind: 'rate_limited', retryAfter };
  }
  if (SYSTEMIC_STATUSES.has(status) || isWrongChat(reply)) return { kind: 'systemic', error };
  // A 2xx without a message id was most likely shown; like a 5xx, Telegram may have shown it.
  if (status >= 500 || (status >= 200 && status < 300)) return { kind: 'uncertain', error };
  return { kind: 'rejected', error };
}
