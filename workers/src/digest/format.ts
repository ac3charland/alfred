/**
 * The morning digest's text: a headline, the model's opener (or, without one, today's plan lines),
 * then Due, Comms and Reader, then three links into the app. Built twice by the same code — as
 * Telegram HTML and as the plain-text twin the sender falls back to — with every interpolated
 * value escaped.
 *
 * Every count and row comes from `digest_facts`; the model only ever writes the opener. The
 * opener sees the same values the lists render, after capping (`openerInput`), and nothing else.
 *
 * Length: by the caps below the worst case is about 3,300 characters, under Telegram's 4,096.
 */
import { type PingText, cap, escapeHtml } from '../notify/format';
import { type DueRow, rankDue } from './due';
import type { DigestFacts } from './facts';
import type { OpenerInput } from './opener';
import { type PlanLine, type PlanToday, readPlan } from './plan';

/** The most due rows listed; the rest are "+N more on Today". */
export const DUE_ROWS = 8;
/** The longest due title, ellipsis included. */
export const TITLE_CAP = 100;
/** The longest ask and sender. */
export const ASK_CAP = 160;
export const SENDER_CAP = 60;
/** The most plan lines listed when there is no opener, and their caps. */
export const PLAN_LINES = 8;
export const PLAN_LABEL_CAP = 24;
export const PLAN_TEXT_CAP = 100;
export const THEME_CAP = 200;

/** A JSON null for the opener's input — parsed, since the package bans the literal. */
const JSON_NULL = JSON.parse('null') as null;

/** One queued ask, capped. */
interface Ask {
  tier: 'asap' | 'today';
  sender: string;
  ask?: string;
}

/** Everything the digest renders, decided and capped — the input to both the text and the model. */
export interface PreparedDigest {
  /** `Saturday, Nov 7`, in the zone. */
  date: string;
  /** Today's plan when the newest plan covers today; no lines is a planned rest day. */
  plan?: PlanToday;
  /** The rows shown, at most {@link DUE_ROWS}. */
  due: DueRow[];
  /** Every due root, shown or not. */
  dueTotal: number;
  counts: { asap: number; today: number; whenever: number };
  asks: Ask[];
  readerWaiting: number;
}

/** The local `YYYY-MM-DD` of `now` in `zone`. */
export function localDate(now: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function headlineDate(now: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(now);
}

function capLine(line: PlanLine): PlanLine {
  return { label: cap(line.label, PLAN_LABEL_CAP), text: cap(line.text, PLAN_TEXT_CAP) };
}

/**
 * Decide what the digest says at `now` in `zone`. `planUnreadable` names a stored plan that
 * couldn't be read (the day then reads as having none), so the caller can log it.
 */
export function prepareDigest(
  facts: DigestFacts,
  now: Date,
  zone: string,
): { digest: PreparedDigest; planUnreadable?: string } {
  const today = localDate(now, zone);
  const ranked = rankDue(facts.tasks, today);
  const read = facts.plan === null ? 'none' : readPlan(facts.plan.html, today);

  const digest: PreparedDigest = {
    date: headlineDate(now, zone),
    due: ranked.slice(0, DUE_ROWS).map((row) => ({ ...row, title: cap(row.title, TITLE_CAP) })),
    dueTotal: ranked.length,
    counts: facts.comms.counts,
    asks: facts.comms.asks.map((row) => {
      const sender = cap(row.sender ?? 'Someone', SENDER_CAP);
      const text = row.ask?.trim() ?? '';
      return text === ''
        ? { tier: row.tier, sender }
        : { tier: row.tier, sender, ask: cap(text, ASK_CAP) };
    }),
    readerWaiting: facts.reader_waiting,
  };
  if (typeof read === 'object') {
    const theme = read.theme === undefined ? undefined : cap(read.theme, THEME_CAP);
    digest.plan = {
      theme,
      lines: read.lines.slice(0, PLAN_LINES).map((line) => capLine(line)),
    };
  }
  return read === 'unreadable' && facts.plan !== null
    ? { digest, planUnreadable: facts.plan.id }
    : { digest };
}

/** The model's input: the digest's own values, plus the plan it doesn't list. */
export function openerInput(digest: PreparedDigest): OpenerInput {
  return {
    date: digest.date,
    plan:
      digest.plan === undefined
        ? JSON_NULL
        : { theme: digest.plan.theme ?? JSON_NULL, lines: digest.plan.lines },
    due: digest.due.map((row) => ({ title: row.title, label: row.label?.text ?? JSON_NULL })),
    due_overflow: digest.dueTotal - digest.due.length,
    comms: {
      counts: digest.counts,
      asks: digest.asks.map((row) => ({ tier: row.tier, sender: row.sender, ask: row.ask ?? '' })),
    },
    reader_waiting: digest.readerWaiting,
  };
}

/** One piece of text in both forms. `html` is already escaped. */
interface Fragment {
  html: string;
  plain: string;
}

const text = (value: string): Fragment => ({ html: escapeHtml(value), plain: value });
const bold = (value: string): Fragment => ({ html: `<b>${escapeHtml(value)}</b>`, plain: value });
const italic = (value: string): Fragment => ({ html: `<i>${escapeHtml(value)}</i>`, plain: value });

function join(parts: Fragment[], separator: string): Fragment {
  return {
    html: parts.map((part) => part.html).join(separator),
    plain: parts.map((part) => part.plain).join(separator),
  };
}

/** A bullet row: `• ` then the parts run together. */
function bullet(...parts: Fragment[]): Fragment {
  return join([text('• '), ...parts], '');
}

function dueSection(digest: PreparedDigest): Fragment {
  if (digest.dueTotal === 0) return bold('Due · nothing today');
  const rows = digest.due.map((row) => {
    if (row.label === undefined) return bullet(text(row.title));
    const label = row.label.late ? italic(row.label.text) : text(row.label.text);
    return bullet(text(`${row.title} — `), label);
  });
  const more = digest.dueTotal - digest.due.length;
  if (more > 0) rows.push(text(`+${String(more)} more on Today`));
  return join([bold(`Due · ${String(digest.dueTotal)}`), ...rows], '\n');
}

function commsSection(digest: PreparedDigest): Fragment {
  const { asap, today, whenever } = digest.counts;
  if (asap + today + whenever === 0) return bold('Comms · nothing waiting on you');
  const header = bold(
    `Comms · ${String(asap)} ASAP · ${String(today)} today · ${String(whenever)} whenever`,
  );
  const rows = digest.asks.map((row) => {
    const who = `${row.tier === 'asap' ? 'ASAP' : 'Today'} · ${row.sender}`;
    return bullet(text(row.ask === undefined ? who : `${who} — ${row.ask}`));
  });
  return join([header, ...rows], '\n');
}

function planSection(plan: PlanToday): Fragment {
  if (plan.lines.length === 0) return bold('Plan for today · rest day');
  const rows = plan.lines.map((line) => bullet(text(`${line.label} · ${line.text}`)));
  return join([bold('Plan for today'), ...rows], '\n');
}

/** Join the app's origin and a path, whatever trailing slash the origin was configured with. */
function appLink(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

function links(appUrl: string): Fragment {
  const targets = [
    ['Today', '/today'],
    ['Comms', '/comms'],
    ['Reader', '/reader'],
  ] as const;
  const urls = targets.map(([label, path]) => ({ label, url: appLink(appUrl, path) }));
  return {
    html: urls
      .map(({ label, url }) => `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`)
      .join(' · '),
    plain: urls.map(({ url }) => url).join('\n'),
  };
}

/**
 * The digest's text. With an `opener`, it sits under the headline in italics and the plan stays
 * unlisted (the model was handed it); without one, today's plan lines take its place so the plan
 * never silently disappears.
 */
export function buildDigest(
  digest: PreparedDigest,
  opener: string | undefined,
  appUrl: string,
): PingText {
  const headline = bold(`Good morning · ${digest.date}`);
  const sections: Fragment[] = [];
  if (opener === undefined) {
    sections.push(headline);
    if (digest.plan !== undefined) sections.push(planSection(digest.plan));
  } else {
    sections.push(join([headline, italic(opener)], '\n'));
  }
  sections.push(
    dueSection(digest),
    commsSection(digest),
    bold(`Reader · ${String(digest.readerWaiting)} waiting`),
    links(appUrl),
  );
  return join(sections, '\n\n');
}
