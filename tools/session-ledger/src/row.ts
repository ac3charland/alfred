import type { GitHistory } from './git.ts';
import { laneFor } from './lane.ts';
import type { Lane } from './lane.ts';
import type { PullRequest, SessionLink } from './prs.ts';
import { linkSessions, prState } from './prs.ts';
import type { SessionDir } from './records.ts';
import { sessionFields, touchesRepo } from './records.ts';
import type { BuilderLoader } from './replay.ts';
import { launchTimeSubject, skillPathsIn } from './replay.ts';
import { byString, sortedBy } from './sort.ts';
import type { JsonObject, LedgerInputs, LedgerRow, SkillRef, WarningCode } from './types.ts';

/**
 * Row assembly: one `code_sessions` row per session, joined from the session record, the PR that
 * links it, the ledger inputs (today's stories and epics) and git history. Every value left null
 * names its reason in `warnings` — there are no silent nulls.
 */

export interface BuildInput {
  repo: string;
  inputs: LedgerInputs;
  pulls: readonly PullRequest[];
  sessions: SessionDir;
  history: GitHistory;
  loader: BuilderLoader;
}

/** A builder change this close before a session started may not have been deployed yet. */
const BUILDER_DEPLOY_LAG_SECONDS = 30 * 60;

const TITLE_REF_RE = /\b[A-Z]+-\d+\b/;

type RecordState =
  | { kind: 'ok'; record: JsonObject }
  | { kind: 'unavailable' }
  | { kind: 'invalid' };

const EMPTY_SESSION_FIELDS = {
  title: null,
  session_created_at: null,
  status: null,
  configured_model: null,
  model: null,
  served_model: null,
  effort_level: null,
  cost_usd: null,
  input_tokens: null,
  output_tokens: null,
  cache_read_tokens: null,
  cache_write_tokens: null,
} as const;

/** Every session the ledger covers, with what is known of its record. */
function sessionUniverse(
  repo: string,
  sessions: SessionDir,
  links: Map<string, SessionLink>,
): Map<string, RecordState> {
  const universe = new Map<string, RecordState>();
  for (const record of sessions.records) {
    const id = String(record['id']);
    // A session another repo's work produced, which no alfred PR links, is not ours.
    if (touchesRepo(record, repo) || links.has(id)) universe.set(id, { kind: 'ok', record });
  }
  for (const id of sessions.unavailable) {
    if (!universe.has(id)) universe.set(id, { kind: 'unavailable' });
  }
  for (const line of sessions.invalid) {
    if (line.id !== undefined && !universe.has(line.id)) {
      universe.set(line.id, { kind: 'invalid' });
    }
  }
  // A session a PR links whose record never arrived still gets a row from its PR.
  for (const id of links.keys()) {
    if (!universe.has(id)) universe.set(id, { kind: 'unavailable' });
  }
  return universe;
}

interface PrFields {
  pr_number: number;
  pr_state: 'merged' | 'closed' | 'open';
  pr_opened_at: string;
  pr_merged_at: string | null;
  pr_closed_at: string | null;
}

function prFields(pr: PullRequest): PrFields {
  return {
    pr_number: pr.number,
    pr_state: prState(pr),
    pr_opened_at: pr.created_at,
    pr_merged_at: pr.merged_at,
    pr_closed_at: pr.closed_at,
  };
}

/** Everything a row derives from its PR's block: lane, prompt, spec and skills. */
interface Reconstruction {
  launch_lane: Lane['lane'] | null;
  builder_sha: string | null;
  prompt: string | null;
  spec_path: string | null;
  spec_blob_sha: string | null;
  skills: SkillRef[];
}

const NOTHING_RECONSTRUCTED: Reconstruction = {
  launch_lane: null,
  builder_sha: null,
  prompt: null,
  spec_path: null,
  spec_blob_sha: null,
  skills: [],
};

async function reconstruct(
  input: BuildInput,
  link: SessionLink,
  base: string | null,
  createdAt: Date | null,
  warn: (code: WarningCode) => void,
): Promise<Reconstruction> {
  const { block } = link;
  if (block === undefined) return NOTHING_RECONSTRUCTED;
  const { history, loader, inputs } = input;
  const ref = block.tickets[0];
  const story = inputs.stories.find((candidate) => candidate.ref === ref);

  const builderSha = base === null ? null : history.builderSha(base);
  const bugBuilderExists = await loader.has(builderSha, 'buildBugUrl');
  const lane = laneFor(block, story?.title ?? null, (name) =>
    name === 'buildBugUrl' ? bugBuilderExists : true,
  );
  if (lane === undefined) return NOTHING_RECONSTRUCTED;

  if (base !== null && createdAt !== null) {
    const landedAt = history.builderLandedAt(base);
    const lag = createdAt.getTime() / 1000 - (landedAt ?? Number.NEGATIVE_INFINITY);
    if (lag >= 0 && lag <= BUILDER_DEPLOY_LAG_SECONDS) warn('builder_changed_near_start');
  }

  const isEpicLane = lane.lane === 'epic-refinement' || lane.lane === 'epic-implementation';
  const subject = isEpicLane ? inputs.epics.find((candidate) => candidate.ref === ref) : story;
  const result: Reconstruction = { ...NOTHING_RECONSTRUCTED, launch_lane: lane.lane };
  if (base === null) return result;
  result.builder_sha = builderSha;

  const existsAtBase = (file: string): boolean => history.blobAt(base, file) !== null;
  const launched =
    subject === undefined
      ? undefined
      : launchTimeSubject(lane.lane, subject, block.specPath, existsAtBase);

  if (launched === undefined) {
    warn('story_missing');
  } else {
    const replayed = await loader.replay(builderSha, lane.builder, inputs.project, launched);
    if ('prompt' in replayed) result.prompt = replayed.prompt;
    else warn(replayed.warning);
  }

  if (lane.lane === 'implementation') {
    result.spec_path = block.specPath ?? null;
  } else if (lane.lane === 'epic-implementation') {
    // The path the epic names today, not the launch-time copy (nulled when the file wasn't at
    // base yet): kept, the missing blob below says why the spec couldn't be resolved.
    result.spec_path = subject?.spec_path ?? null;
  }
  if (result.spec_path !== null) {
    result.spec_blob_sha = history.blobAt(base, result.spec_path);
    const recordedSha = subject?.spec_sha ?? null;
    if (result.spec_blob_sha === null) warn('spec_missing_at_base');
    else if (recordedSha !== null && recordedSha !== result.spec_blob_sha) {
      warn('spec_changed_since_refinement');
    }
  }

  result.skills =
    result.prompt === null
      ? []
      : skillPathsIn(result.prompt).map((file) => ({
          path: file,
          blob_sha: history.blobAt(base, file),
        }));
  return result;
}

/** Human rework after the PR opened, or null (with the reason) when it can't be counted. */
function humanCommits(
  history: GitHistory,
  pr: PullRequest,
  base: string | null,
  warn: (code: WarningCode) => void,
): number | null {
  if (base === null) return null;
  if (!history.ensureHead(pr.number, pr.head.sha)) {
    warn('pr_head_unavailable');
    return null;
  }
  // A branch that didn't grow from main-at-start (another branch picked in the session UI):
  // the base..head range would count someone else's history.
  if (!history.isAncestor(base, pr.head.sha)) {
    warn('not_from_main');
    return null;
  }
  return history.humanCommitsAfter(base, pr.head.sha, new Date(pr.created_at));
}

async function buildRow(
  input: BuildInput,
  id: string,
  state: RecordState,
  link: SessionLink | undefined,
): Promise<LedgerRow> {
  const warnings = new Set<WarningCode>();
  const warn = (code: WarningCode): void => {
    warnings.add(code);
  };

  if (state.kind === 'unavailable') warn('session_record_unavailable');
  if (state.kind === 'invalid') warn('session_record_invalid');
  const record = state.kind === 'ok' ? state.record : null;
  const session = record === null ? EMPTY_SESSION_FIELDS : sessionFields(record);
  const createdAt =
    session.session_created_at === null ? null : new Date(session.session_created_at);
  const base = createdAt === null ? null : input.history.baseShaAt(createdAt);

  let ref: string | null = null;
  let pr: PrFields | null = null;
  let human: number | null = null;
  let rebuilt = NOTHING_RECONSTRUCTED;

  if (link === undefined) {
    warn('no_pr');
    const titleRef = TITLE_REF_RE.exec(session.title ?? '')?.[0];
    const known = [
      ...input.inputs.stories.map((s) => s.ref),
      ...input.inputs.epics.map((e) => e.ref),
    ];
    if (titleRef !== undefined && known.includes(titleRef)) {
      ref = titleRef;
      warn('ref_from_title');
    }
  } else {
    pr = prFields(link.pr);
    if (link.extraPrs.length > 0) warn('extra_prs');
    if (link.block === undefined) warn('no_alfred_block');
    ref = link.block?.tickets[0] ?? null;
    human = humanCommits(input.history, link.pr, base, warn);
    rebuilt = await reconstruct(input, link, base, createdAt, warn);
  }

  return {
    session_id: id,
    repo: input.repo,
    ...session,
    ref,
    launch_lane: rebuilt.launch_lane,
    pr_number: pr?.pr_number ?? null,
    pr_state: pr?.pr_state ?? null,
    pr_opened_at: pr?.pr_opened_at ?? null,
    pr_merged_at: pr?.pr_merged_at ?? null,
    pr_closed_at: pr?.pr_closed_at ?? null,
    human_commits_after_open: human,
    base_sha: base,
    builder_sha: rebuilt.builder_sha,
    prompt: rebuilt.prompt,
    prompt_source: rebuilt.prompt === null ? null : 'reconstructed',
    spec_path: rebuilt.spec_path,
    spec_blob_sha: rebuilt.spec_blob_sha,
    skills: rebuilt.skills,
    warnings: sortedBy(warnings, byString),
    session_record: record,
  };
}

/** Every ledger row, ordered by session id. */
export async function buildRows(input: BuildInput): Promise<LedgerRow[]> {
  const links = linkSessions(input.pulls);
  const universe = sessionUniverse(input.repo, input.sessions, links);
  const rows: LedgerRow[] = [];
  for (const id of sortedBy(universe.keys(), byString)) {
    const state = universe.get(id) ?? { kind: 'unavailable' };
    rows.push(await buildRow(input, id, state, links.get(id)));
  }
  return rows;
}
