/**
 * Today's lines from the newest weekly plan, and the week's theme.
 *
 * alfred does not own the plan's format: `weekly_plans.html` is the weekly-review skill's
 * generate_plan.py output, stored verbatim. That generator embeds the per-day lines as a script
 * literal — `var DAILY_TASKS = {…};`, JSON keyed by ISO date, each value an array of
 * `{ pill, label, text }` — and the theme as `<div class="theme-title">…</div>`. This reads both
 * out of the text, and treats any surprise as an unreadable plan rather than an error: a change
 * to the generator must cost the digest its plan section, never the digest.
 *
 * The page renders each line with `innerHTML`, so a label or text may carry markup and entities;
 * both are reduced to the text the page would show.
 */

/** One line of today's plan. */
export interface PlanLine {
  label: string;
  text: string;
}

/** A plan that covers today. No lines means a planned rest day. */
export interface PlanToday {
  theme: string | undefined;
  lines: PlanLine[];
}

const START = 'var DAILY_TASKS = ';
const END = ';\n\nfunction initToday';

/** The page's own fallback names for an empty label, by pill. */
const PILL_NAMES: Readonly<Record<string, string>> = {
  r1: 'Rock 1',
  r2: 'Rock 2',
  r3: 'Rock 3',
  rp: 'RealPlay',
  sax: 'RealPlay',
  prac: 'Practice',
  run: 'Run',
  ci: 'Check-in',
  gen: 'Other',
};

/** Tags stripped and the five basic entities decoded — `&amp;` last, so it is never re-read. */
function plainText(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .trim();
}

interface RawLine {
  pill?: unknown;
  label?: unknown;
  text: string;
}

function isRawLine(value: unknown): value is RawLine {
  if (typeof value !== 'object' || value === null) return false;
  const { label, text } = value as Record<string, unknown>;
  return typeof text === 'string' && (label === undefined || typeof label === 'string');
}

/** The DAILY_TASKS map, or undefined when it is missing or not the expected shape. */
function dailyTasks(html: string): Map<string, RawLine[]> | undefined {
  const start = html.indexOf(START);
  if (start === -1) return undefined;
  const end = html.indexOf(END, start);
  if (end === -1) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(html.slice(start + START.length, end)) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const days = new Map<string, RawLine[]>();
  for (const [date, lines] of Object.entries(parsed)) {
    if (!Array.isArray(lines) || !lines.every(isRawLine)) return undefined;
    days.set(date, lines);
  }
  return days;
}

function theme(html: string): string | undefined {
  const match = /<div class="theme-title">([\s\S]*?)<\/div>/.exec(html);
  const text = match?.[1] === undefined ? '' : plainText(match[1]);
  return text === '' ? undefined : text;
}

function lineOf(raw: RawLine): PlanLine {
  const label = typeof raw.label === 'string' ? plainText(raw.label) : '';
  const pill = typeof raw.pill === 'string' ? raw.pill : '';
  return { label: label === '' ? (PILL_NAMES[pill] ?? 'Other') : label, text: plainText(raw.text) };
}

/**
 * Today's plan from a stored document: its lines and theme when it covers `todayIso`, `'none'`
 * when it doesn't, `'unreadable'` when the lines can't be read at all. Never throws.
 */
export function readPlan(html: string, todayIso: string): PlanToday | 'none' | 'unreadable' {
  const days = dailyTasks(html);
  if (days === undefined) return 'unreadable';
  const lines = days.get(todayIso);
  if (lines === undefined) return 'none';
  return { theme: theme(html), lines: lines.map((line) => lineOf(line)) };
}
