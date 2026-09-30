import { sortedBy } from './sort.ts';
import type { LaunchLane, LedgerRow } from './types.ts';

/**
 * The run report the backfill prints: coverage (how much of each reconstruction landed), cost
 * and outcome by lane, and the warnings that explain what didn't.
 */

export interface PushResult {
  pushed: number;
  upserted: number;
  kept_recorded: number;
}

const LANE_ORDER: LaunchLane[] = [
  'implementation',
  'bypass',
  'bug',
  'refinement',
  'spike',
  'epic-refinement',
  'epic-implementation',
];

/** Lanes whose deliverable is a document: human rework of a spec isn't the rework measured. */
const DOCUMENT_LANES = new Set<LaunchLane | null>(['refinement', 'spike', 'epic-refinement']);

/** p90 needs at least this many sessions to mean anything. */
const P90_MIN_N = 10;

const NAME_WIDTH = 16;
const DASH = '—';

/** The `q`-th quantile by linear interpolation between closest ranks. */
function quantile(sortedValues: readonly number[], q: number): number {
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sortedValues[lower] ?? 0;
  const high = sortedValues[upper] ?? low;
  return low + (high - low) * (position - lower);
}

function percent(count: number, total: number): string {
  return total === 0 ? '0%' : `${String(Math.round((count / total) * 100))}%`;
}

function coverageLine(label: string, count: number, tail: string): string {
  return `  ${label}`.padEnd(NAME_WIDTH) + String(count).padStart(6) + tail;
}

function laneLines(name: string, rows: readonly LedgerRow[], lane: LaunchLane | null): string[] {
  const costs = sortedBy(
    rows.flatMap((row) => (row.cost_usd === null ? [] : [row.cost_usd])),
    (a, b) => a - b,
  );
  const median = costs.length === 0 ? DASH : quantile(costs, 0.5).toFixed(2);
  const p90 = rows.length >= P90_MIN_N && costs.length > 0 ? quantile(costs, 0.9).toFixed(2) : DASH;
  const noPr = lane === null;
  const merged = noPr ? DASH : String(rows.filter((row) => row.pr_state === 'merged').length);
  const reworked =
    noPr || DOCUMENT_LANES.has(lane)
      ? DASH
      : String(rows.filter((row) => (row.human_commits_after_open ?? 0) > 0).length);
  const numbers =
    String(rows.length).padStart(5) +
    median.padStart(10) +
    p90.padStart(8) +
    merged.padStart(9) +
    reworked.padStart(9);
  const label = `  ${name}`;
  const overflow = label.length - NAME_WIDTH;
  if (overflow <= 0) return [label.padEnd(NAME_WIDTH) + numbers];
  // A name a little too long borrows the n column's padding, keeping one space; one longer
  // still gets a line of its own, with the numbers aligned beneath it.
  const padding = numbers.length - numbers.trimStart().length;
  return overflow < padding
    ? [label + numbers.slice(overflow)]
    : [label, ' '.repeat(NAME_WIDTH) + numbers];
}

function dateRange(rows: readonly LedgerRow[]): string {
  const dates = sortedBy(
    rows.flatMap((row) =>
      row.session_created_at === null ? [] : [row.session_created_at.slice(0, 10)],
    ),
    (a, b) => (a < b ? -1 : Number(a > b)),
  );
  const first = dates[0];
  const last = dates.at(-1);
  return first === undefined || last === undefined ? 'no dates' : `${first} → ${last}`;
}

function warningLine(rows: readonly LedgerRow[]): string {
  const counts = new Map<string, number>();
  for (const code of rows.flatMap((row) => row.warnings)) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return 'warnings: 0';
  const top = sortedBy(counts.entries(), ([codeA, a], [codeB, b]) =>
    b === a ? Number(codeA > codeB) - Number(codeA < codeB) : b - a,
  )
    .slice(0, 3)
    .map(([code, count]) => `${code} ${String(count)}`);
  return `warnings: ${String(total)} · top: ${top.join(' · ')}`;
}

export function formatReport(rows: readonly LedgerRow[], push?: PushResult): string {
  const total = rows.length;
  const repo = rows[0]?.repo ?? 'no repo';
  const count = (test: (row: LedgerRow) => boolean): number =>
    rows.filter((row) => test(row)).length;
  const specReading = count((row) => row.spec_path !== null);

  const lines = [
    `code_sessions · ${repo} · ${String(total)} sessions · ${dateRange(rows)}`,
    '',
    'coverage          rows   pct',
    coverageLine(
      'linked to a PR',
      count((row) => row.pr_number !== null),
      percent(
        count((row) => row.pr_number !== null),
        total,
      ).padStart(6),
    ),
    coverageLine(
      'ref known',
      count((row) => row.ref !== null),
      percent(
        count((row) => row.ref !== null),
        total,
      ).padStart(6),
    ),
    coverageLine(
      'prompt rebuilt',
      count((row) => row.prompt !== null),
      percent(
        count((row) => row.prompt !== null),
        total,
      ).padStart(6),
    ),
    coverageLine(
      'spec resolved',
      count((row) => row.spec_blob_sha !== null),
      `   of ${String(specReading)} spec-reading sessions`,
    ),
    coverageLine(
      'cost recorded',
      count((row) => row.cost_usd !== null),
      percent(
        count((row) => row.cost_usd !== null),
        total,
      ).padStart(6),
    ),
    '',
    'lane'.padEnd(NAME_WIDTH) +
      'n'.padStart(5) +
      'median $'.padStart(10) +
      'p90 $'.padStart(8) +
      'merged'.padStart(9) +
      '  human-reworked',
  ];
  for (const lane of LANE_ORDER) {
    const laneRows = rows.filter((row) => row.launch_lane === lane);
    if (laneRows.length > 0) lines.push(...laneLines(lane, laneRows, lane));
  }
  const noLane = rows.filter((row) => row.launch_lane === null);
  if (noLane.length > 0) lines.push(...laneLines('(no PR)', noLane, null));

  lines.push('', warningLine(rows));
  if (push !== undefined) {
    lines.push(
      `pushed ${String(push.pushed)} rows (${String(push.upserted)} upserted, ${String(push.kept_recorded)} kept recorded prompts)`,
    );
  }
  return `${lines.join('\n')}\n`;
}
