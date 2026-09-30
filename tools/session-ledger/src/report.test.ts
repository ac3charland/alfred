import { formatReport } from './report.ts';
import type { LaunchLane, LedgerRow } from './types.ts';

function row(overrides: Partial<LedgerRow>): LedgerRow {
  return {
    session_id: 'session_x',
    repo: 'ac3charland/alfred',
    title: null,
    session_created_at: '2026-07-01T00:00:00Z',
    status: null,
    configured_model: null,
    model: null,
    served_model: null,
    effort_level: null,
    cost_usd: 10,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    ref: 'ALF-1',
    launch_lane: 'implementation',
    pr_number: 1,
    pr_state: 'merged',
    pr_opened_at: null,
    pr_merged_at: null,
    pr_closed_at: null,
    human_commits_after_open: 0,
    base_sha: null,
    builder_sha: null,
    prompt: 'p',
    prompt_source: 'reconstructed',
    spec_path: null,
    spec_blob_sha: null,
    skills: [],
    warnings: [],
    session_record: null,
    ...overrides,
  };
}

/** `n` rows in one lane with costs 1..n. */
function lane(
  launchLane: LaunchLane | null,
  n: number,
  extra: Partial<LedgerRow> = {},
): LedgerRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({ launch_lane: launchLane, cost_usd: i + 1, ...extra }),
  );
}

describe('formatReport', () => {
  it('shows p90 only for a lane of at least 10 sessions', () => {
    const report = formatReport([...lane('implementation', 10), ...lane('bypass', 9)]);

    expect(report).toContain('  implementation   10      5.50    9.10       10        0');
    expect(report).toContain('  bypass            9      5.00       —        9        0');
  });

  it('shows — for rework in document lanes and for merged/rework in (no PR)', () => {
    const report = formatReport([
      ...lane('refinement', 2),
      ...lane(null, 3, { pr_number: null, pr_state: null, human_commits_after_open: null }),
    ]);

    expect(report).toContain('  refinement        2      1.50       —        2        —');
    expect(report).toContain('  (no PR)           3      2.00       —        —        —');
  });

  it('counts a lane’s human-reworked sessions', () => {
    const report = formatReport([
      row({ human_commits_after_open: 2 }),
      row({ human_commits_after_open: 0 }),
      row({ human_commits_after_open: null }),
    ]);

    expect(report).toMatch(/ {2}implementation {4}3 .* 1\n/);
  });

  it('wraps a name too long for its column onto its own line', () => {
    const report = formatReport(lane('epic-implementation', 1));

    expect(report).toContain(
      '  epic-implementation\n                    1      1.00       —        1        0\n',
    );
  });

  it('prints the header, coverage, and the top three warnings by count', () => {
    const report = formatReport([
      row({ session_created_at: '2026-06-15T09:00:00Z', warnings: ['no_pr', 'ref_from_title'] }),
      row({
        session_created_at: '2026-10-02T09:00:00Z',
        warnings: ['no_pr'],
        spec_path: 'x',
        spec_blob_sha: 'y',
      }),
      row({ warnings: ['no_pr', 'builder_missing'], spec_path: 'z', cost_usd: null, prompt: null }),
      row({ warnings: ['builder_missing', 'extra_prs'] }),
    ]);

    expect(report.split('\n').slice(0, 9)).toEqual([
      'code_sessions · ac3charland/alfred · 4 sessions · 2026-06-15 → 2026-10-02',
      '',
      'coverage          rows   pct',
      '  linked to a PR     4  100%',
      '  ref known          4  100%',
      '  prompt rebuilt     3   75%',
      '  spec resolved      1   of 2 spec-reading sessions',
      '  cost recorded      3   75%',
      '',
    ]);
    expect(report).toContain('warnings: 7 · top: no_pr 3 · builder_missing 2 · extra_prs 1\n');
  });

  it('ends with the push line when given a push result', () => {
    const report = formatReport([row({})], { pushed: 1, upserted: 1, kept_recorded: 0 });

    expect(report.trimEnd().split('\n').at(-1)).toBe(
      'pushed 1 rows (1 upserted, 0 kept recorded prompts)',
    );
  });
});
