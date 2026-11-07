/**
 * The text of a ping, built twice: once as Telegram HTML (a bold first line and a link), and once
 * as the plain-text twin the sender falls back to when Telegram rejects the HTML.
 *
 * HTML rather than MarkdownV2 because Telegram's HTML mode needs only `<`, `>` and `&` escaped
 * outside tags; MarkdownV2 reserves about eighteen characters. Every interpolated value is
 * escaped, so an ask or a title containing markup renders literally.
 *
 * A ping never carries a message's body, subject or handle (a handle only when the sender has no
 * name): bot chats are stored on Telegram's servers without end-to-end encryption, and the ask —
 * alfred's own one-line paraphrase — is enough to decide whether to look.
 */

/** The longest ask a ping carries, ellipsis included. */
export const ASK_CAP = 300;

/** The longest task title a ping carries, ellipsis included. */
export const TITLE_CAP = 200;

/** One ping in both forms. */
export interface PingText {
  html: string;
  plain: string;
}

/** Escape text for Telegram HTML. `&` goes first, or it would re-escape the other two. */
export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Cap `text` at `max` characters, ending in "…" when it was cut. Counted in graphemes — what a
 * reader sees as one character — so the cut never splits an emoji, a flag or an accented letter.
 */
export function cap(text: string, max: number): string {
  const segments = Array.from(graphemes.segment(text), (part) => part.segment);
  if (segments.length <= max) return text;
  return `${segments.slice(0, max - 1).join('')}…`;
}

/** `15:00` or `15:00:00` → `3:00 PM`; `00:05` → `12:05 AM`. No leading zero on the hour. */
export function formatTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour12)}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** Join the app's origin and a path, whatever trailing slash the origin was configured with. */
function appLink(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * The three-line shape every ping shares: a headline that opens in bold (`bold`, then the
 * unbolded `rest`), a body line, a link into alfred.
 */
function ping(
  headline: { bold: string; rest?: string },
  body: string,
  url: string,
  label: string,
): PingText {
  const rest = headline.rest ?? '';
  return {
    html:
      `<b>${escapeHtml(headline.bold)}</b>${escapeHtml(rest)}\n${escapeHtml(body)}\n` +
      `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`,
    plain: `${headline.bold}${rest}\n${body}\n${url}`,
  };
}

/** A message the model just judged ASAP: who, on which account, and what they want. */
export function buildCommsAsap(
  fields: { sender: string; account: string; ask: string },
  appUrl: string,
): PingText {
  return ping(
    { bold: 'ASAP', rest: ` · ${fields.sender} · ${fields.account}` },
    cap(fields.ask, ASK_CAP),
    appLink(appUrl, '/comms'),
    'Open comms',
  );
}

/** A timed task whose due minute just arrived. `dueTime` is the column as PostgREST spells it. */
export function buildTaskDue(fields: { title: string; dueTime: string }, appUrl: string): PingText {
  return ping(
    { bold: `Due ${formatTime(fields.dueTime)}` },
    cap(fields.title, TITLE_CAP),
    appLink(appUrl, '/today'),
    'Open Today',
  );
}
