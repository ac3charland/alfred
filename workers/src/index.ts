/**
 * alfred's one Worker, serving two unrelated jobs from a single entrypoint.
 *
 * `fetch` is the GitHub PR webhook: signature-verified, no LLM, it turns `pull_request` webhooks
 * into deterministic `code_items` state transitions. Because both lifecycle phases end in a PR,
 * this single endpoint tracks the whole factory. Flow per delivery:
 *   verify HMAC → it's a pull_request → parse the `alfred` block → plan the transition →
 *   PATCH the ticket(s) → (on refinement- or spike-merge) snapshot the document in the background.
 *
 * The same webhook endpoint takes the knowledge wiki repo's `push` deliveries: a push to
 * `WIKI_REPO`'s main answers 202 and reconciles the wiki page snapshot in the background
 * (`syncWiki`); every other push is ignored.
 *
 * `fetch` also serves the Mac daemon's comms ingest endpoint — a second, unrelated POST route,
 * signed with its own secret and its own scheme, delegating to `handleIngest`.
 *
 * `scheduled` is fired by the cron triggers in wrangler.toml, and dispatches on WHICH schedule
 * fired: the frequent one runs the Inbox classifier and then the comms judge pass, the poll one
 * reads Gmail, the reader one runs the newsletter tick, and the daily one runs the comms
 * retention sweep, the reader's own text sweep, and then the wiki sync as the snapshot's safety
 * net. Every handler stays thin and delegates.
 */
import { handleIngest } from './comms/ingest';
import {
  type CommsRetentionSummary,
  type CommsTickSummary,
  runCommsJudge,
  runCommsPoll,
  runCommsRetention,
} from './comms/scheduled';
import { parseFrontmatter } from './frontmatter';
import { fetchSpec } from './github';
import { verifySignature } from './hmac';
import { READER_DEFAULT_DAILY_CAP } from './reader/config';
import {
  type ReaderRetentionSummary,
  type ReaderTickSummary,
  runReaderRetention,
  runReaderTick,
} from './reader/scheduled';
import { patchCodeItem, patchEpic } from './supabase';
import { runSweep } from './sweep';
import { type TransitionTarget, planTransition } from './transitions';
import { type WikiSyncSummary, syncWiki } from './wiki/sync';

/**
 * The Worker's bindings. Hand-written because most of these are SECRETS, not `wrangler.toml`
 * bindings — `wrangler types` only generates bindings, so secret typing must be declared here.
 * Secret values are set with `wrangler secret put`, never committed; the two classifier vars
 * below are plaintext and DO live in `wrangler.toml`, so they are declared alongside.
 */
export interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /**
   * The Anthropic Console key the Inbox classifier calls with — a secret, and the only place in
   * the whole system that holds one. Optional because it is set by hand, once, outside any
   * merge: until someone runs `wrangler secret put`, the binding is genuinely absent, and the
   * sweep is written to notice that loudly rather than mistake it for an outage.
   */
  ANTHROPIC_API_KEY?: string;
  /** Which model judges an Inbox item. A `[vars]` entry, so changing it is a deploy flag. */
  CLASSIFIER_MODEL: string;
  /** The IANA zone "friday" resolves against, e.g. `America/Chicago`. Also a `[vars]` entry. */
  CLASSIFIER_TIMEZONE: string;
  /**
   * Which model summarises a Reader post. A `[vars]` entry like `CLASSIFIER_MODEL`, and typed
   * `string` for the same reason — but the reader tick re-checks it at runtime and fails closed,
   * because a CLI `--var` can shadow a `[vars]` entry and the tick must not spend a request on
   * an `undefined` model.
   */
  READER_MODEL: string;
  /**
   * The Reader's daily model-call ceiling, as the string every var arrives as. Optional: absent
   * it defaults to 30 inside the tick; present but not a positive integer it is a systemic
   * failure the tick records rather than a ceiling it silently ignores.
   */
  READER_DAILY_CAP?: string;
  /**
   * The secret the Mac daemon signs its ingest requests with, shared with nothing else. Optional
   * for the same reason as the key above: it is set by hand, once, and until it is the endpoint
   * has nothing to verify against and says so rather than accepting anything.
   */
  COMMS_INGEST_HMAC_SECRET?: string;
  /** The Google OAuth client the two Gmail polls authenticate through. */
  GMAIL_OAUTH_CLIENT_ID?: string;
  GMAIL_OAUTH_CLIENT_SECRET?: string;
  /** One refresh token per Gmail account. A client left in Testing issues 7-day tokens. */
  GMAIL_PERSONAL_REFRESH_TOKEN?: string;
  GMAIL_REALPLAY_REFRESH_TOKEN?: string;
  /**
   * The knowledge wiki's repo as `owner/name` — a `[vars]` entry. The push webhook syncs the
   * page snapshot only for a push to this repo's main, and the sync reads its tree with the
   * same `GITHUB_TOKEN` the spec snapshot uses (its repository list must include the wiki).
   */
  WIKI_REPO: string;
  /**
   * The commit this Worker was built from — a plain `[vars]` binding, NOT a secret, injected by
   * the deploy workflow (`--var WORKER_VERSION:<sha>`). Optional because a hand-run
   * `wrangler deploy` passes none.
   */
  WORKER_VERSION?: string;
}

/**
 * What `GET /` reports when nothing stamped the build. Deploying by hand leaves this, which is
 * the useful reading: no CI run vouches for which commit is live.
 */
const UNSTAMPED = 'unstamped';

/**
 * The frequent schedule: the Inbox classifier and the comms JUDGE pass (not the Gmail poll — see
 * `POLL_CRON`). Both live on it because neither is worth its own trigger and nobody is waiting on
 * either.
 */
export const TICK_CRON = '*/2 * * * *';

/**
 * The Gmail poll, on its own three-minute tick rather than sharing `TICK_CRON`. The two are
 * separated because they compete for one budget: the Workers runtime allows 50 outbound fetches
 * per INVOCATION on the Free plan, and polling and judging both scale with how much mail is
 * waiting, so together they exhausted it and the whole tick threw. Apart, each gets the full 50.
 *
 * Three minutes rather than an offset two. This was a stepped range starting at 1, to interleave
 * the poll with the judge pass on the odd minutes. Cloudflare accepted it, and its API echoed it
 * back verbatim, but the SCHEDULER ran the offset-free form: the trigger fired on the EVEN minute
 * alongside `TICK_CRON` and reported itself as `TICK_CRON`'s own expression. Since `event.cron` is
 * the whole dispatch, the poll became unreachable — `pollGmail` was never called once, and both
 * Gmail accounts sat dark while every tick silently took the fall-through branch. A stepped range
 * with a NONZERO start is the trap; an offset-free expression cannot collapse onto another
 * schedule. The two now coincide every sixth minute, which costs nothing: separate invocations
 * carry separate budgets.
 */
export const POLL_CRON = '*/3 * * * *';

/**
 * The daily housekeeping run — the comms message sweep, then the Reader's 90-day text sweep, then
 * the wiki snapshot's safety-net sync, which repairs whatever a missed push webhook left stale.
 * Housekeeping rather than triage, so it runs alone, overnight, and never drags a model call
 * along with it. Each unit is isolated in its own try/catch (the two sweeps inside their
 * wrappers, the sync in `runWikiSync`), so no unit's failure skips the ones after it; the sync
 * runs last so nothing waits on GitHub.
 *
 * Budget: 50 subrequests per invocation. The comms sweep spends 1, the reader sweep at most 40
 * (its `MAX_BATCHES`), and the wiki sync at most 6 (`WIKI_SYNC_SUBREQUEST_CEILING`) — 47. CPU is
 * dominated by the sync's page parsing, capped at ~6ms by `WIKI_SYNC_PAGE_CAP`; the sweeps are
 * database-side and cost next to none. These strings must match wrangler.toml's `crons`: the
 * runtime hands the handler the expression it fired, and that is all it has to dispatch on.
 */
export const RETENTION_CRON = '17 9 * * *';

/**
 * The Reader tick — discovery, intake and the summariser, every five minutes on its own trigger.
 * Its own schedule for the reason the poll has one: a tick spends up to ~44 of the 50
 * subrequests an invocation gets, so it cannot share. Offset-free like the others, because a
 * stepped range with a nonzero start collapses onto another schedule (see `POLL_CRON`).
 * Coinciding with the two- and three-minute schedules on some minutes is harmless — each trigger
 * is its own invocation with its own budget.
 */
export const READER_CRON = '*/5 * * * *';

/** The `pull_request` payload fields we read (a tiny subset of GitHub's event). */
interface PullRequestPayload {
  action: string;
  pull_request: {
    body: string | null;
    html_url: string;
    merged: boolean;
    merge_commit_sha: string | null;
  };
  repository: {
    full_name: string;
  };
}

const json = (status: number, data: Record<string, unknown>): Response =>
  Response.json(data, {
    status,
    // Stryker disable next-line ObjectLiteral: AT_CEILING — Response.json already defaults Content-Type to application/json when the header is absent, so emptying this object yields the identical response. (The empty-string mutant on the value IS observable and stays covered.)
    headers: { 'Content-Type': 'application/json' },
  });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check — and the deploy's receipt. It names the commit the running code was built
    // from so "is production current?" is one curl plus a `git rev-parse`, rather than the
    // guesswork that let a Worker sit three phases behind main for days (ALF-149).
    //
    // It reports the RESOLVED classifier config for the same reason. The deploy workflow passes
    // `--var WORKER_VERSION:<sha>`, and this is the first release to put anything else in
    // `[vars]`; if a CLI `--var` ever shadowed the file's vars rather than merging with them,
    // the classifier would silently fall back to its defaults in production with no symptom.
    // Naming them here makes that a one-curl check instead of a mystery. It deliberately says
    // nothing about the API key: a health check must not probe a billed endpoint.
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(
        `alfred workers ok (build ${env.WORKER_VERSION ?? UNSTAMPED}; ` +
          `classifier ${env.CLASSIFIER_MODEL} @ ${env.CLASSIFIER_TIMEZONE}; ` +
          `comms ingest ${env.COMMS_INGEST_HMAC_SECRET === undefined ? 'unconfigured' : 'configured'}; ` +
          `reader ${env.READER_MODEL} cap ${env.READER_DAILY_CAP ?? String(READER_DEFAULT_DAILY_CAP)}; ` +
          `wiki ${env.WIKI_REPO})`,
      );
    }

    if (request.method === 'POST' && url.pathname === '/github/webhook') {
      return handleWebhook(request, env, ctx);
    }

    // The daemon's ingest endpoint. `now` is passed in rather than read inside, so the replay
    // window, the heartbeat stamp and the reply drain all read one instant.
    if (request.method === 'POST' && url.pathname === '/comms/ingest') {
      return handleIngest(request, env, new Date());
    }

    return new Response('not found', { status: 404 });
  },

  /**
   * The cron triggers' entrypoint, shared by all four schedules — the runtime hands over which
   * one fired and nothing else, so `event.cron` is the whole dispatch. An unrecognised expression
   * takes the frequent path: a schedule that was renamed in wrangler.toml and not here should
   * keep triaging rather than silently do nothing.
   *
   * Everything is AWAITED rather than handed to `ctx.waitUntil` or fired and forgotten: a
   * scheduled invocation is torn down when the promise it returns settles, so unawaited work is
   * silently killed part-way through.
   */
  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const now = new Date();

    if (event.cron === RETENTION_CRON) {
      // Three isolated units on one schedule: each owns its own try/catch, so no failure skips
      // the units after it. The wiki sync goes last: it is the only one that waits on GitHub.
      logRetention(await runCommsRetention(env, now));
      logReaderRetention(await runReaderRetention(env, now));
      await runWikiSync(env, now);
      return;
    }

    if (event.cron === POLL_CRON) {
      logCommsTick(await runCommsPoll(env, now));
      return;
    }

    if (event.cron === READER_CRON) {
      logReaderTick(await runReaderTick(env, now));
      return;
    }

    // Named rather than swallowed. The fall-through below is deliberate, but it is also how a
    // dispatch that matches nothing hides: a schedule whose expression the runtime reports
    // differently from the constant here keeps triaging and never says its own unit stopped.
    if (event.cron !== TICK_CRON) {
      console.warn(`comms: unrecognised cron ${event.cron} — taking the frequent path`);
    }

    const summary = await runSweep(env, now);
    console.log(
      `classifier sweep: ${String(summary.eligible)} eligible, ` +
        `${String(summary.classified)} classified, ${String(summary.failed)} failed` +
        (summary.aborted ? ' (aborted)' : ''),
    );

    logCommsTick(await runCommsJudge(env, now));
  },
};

/**
 * One line per unit of the comms tick, because `wrangler tail` is the only window into a cron and
 * a tick that half-ran has to be able to say which half. A unit that threw is named rather than
 * omitted — "did not run" is a reading; a missing line is not.
 */
function logCommsTick(summary: CommsTickSummary): void {
  const gmail = summary.gmail;
  if (gmail === undefined) {
    console.log('comms gmail poll: did not run');
  } else {
    const accepted = gmail.accounts.reduce((total, account) => total + account.accepted, 0);
    const plural = gmail.accounts.length === 1 ? 'account' : 'accounts';
    console.log(
      `comms gmail poll: ${String(gmail.accounts.length)} ${plural}, ${String(accepted)} accepted`,
    );
  }

  const sweep = summary.sweep;
  console.log(
    sweep === undefined
      ? 'comms classifier sweep: did not run'
      : `comms classifier sweep: ${String(sweep.eligible)} eligible, ` +
          `${String(sweep.classified)} classified, ${String(sweep.failed)} failed` +
          (sweep.aborted ? ' (aborted)' : ''),
  );

  logFailures(summary.failures);
}

/** The same, for the daily sweep — one line, plus whatever went wrong. */
function logRetention(summary: CommsRetentionSummary): void {
  console.log(
    summary.deleted === undefined
      ? 'comms retention: did not run'
      : `comms retention: ${String(summary.deleted)} messages deleted`,
  );
  logFailures(summary.failures);
}

/** The reader's own text sweep, logged separately so a half-run day still says which half. */
function logReaderRetention(summary: ReaderRetentionSummary): void {
  if (summary.swept === undefined) {
    console.log('reader retention: did not run');
  } else {
    const plural = summary.swept === 1 ? 'post' : 'posts';
    console.log(`reader retention: ${String(summary.swept)} ${plural} swept`);
  }
  logFailures(summary.failures, 'reader');
}

/**
 * The reader tick, as ONE line of counts, so `wrangler tail` can say how much of a tick ran. The
 * counts are the tick's own summary; each failure that ended a unit is an error line beneath them.
 */
function logReaderTick(summary: ReaderTickSummary): void {
  console.log(
    `reader tick: ${String(summary.discovered)} discovered, ${String(summary.intake)} taken in, ` +
      `${String(summary.summarized)} summarised, ${String(summary.refused)} refused, ` +
      `${String(summary.countedFailures)} counted failures, ` +
      `${String(summary.uncountedFailures)} uncounted, ` +
      `${String(summary.skippedForCap)} waiting on the cap, ` +
      `${String(summary.skippedForBudget)} left for the budget`,
  );
  for (const failure of summary.failures) console.error(`reader: ${failure}`);
}

/**
 * Run one wiki sync and log it as one line. `syncWiki` records its own failures in `wiki_sync`
 * and resolves; it rejects only when that record could not be written — caught here, so neither
 * the cron nor a webhook's background task ever ends on an unhandled rejection.
 */
async function runWikiSync(env: Env, now?: Date): Promise<void> {
  try {
    logWikiSync(await syncWiki(env, now === undefined ? {} : { now }));
  } catch (error) {
    console.error(`wiki sync: threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function logWikiSync(summary: WikiSyncSummary): void {
  if (summary.ok) {
    console.log(
      `wiki sync: ${String(summary.changed)} changed, ${String(summary.removed)} removed, ` +
        `${String(summary.pending)} pending at ${summary.commitOid.slice(0, 7)}`,
    );
  } else {
    console.error(`wiki sync: failed (recorded in wiki_sync): ${summary.error}`);
  }
}

function logFailures(failures: string[], unit = 'comms'): void {
  for (const failure of failures) console.error(`${unit}: ${failure}`);
}

async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // 1. Verify GitHub's HMAC over the RAW body before anything else — reject forgeries.
  const rawBody = await request.text();
  const signature = request.headers.get('X-Hub-Signature-256') ?? undefined;
  if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, rawBody, signature))) {
    return json(401, { error: 'invalid signature' });
  }

  // 2. A push is the wiki repo's: sync the page snapshot for a push to its main, else ignore.
  if (request.headers.get('X-GitHub-Event') === 'push') {
    return handlePush(rawBody, env, ctx);
  }

  // 3. Otherwise we only act on pull_request events.
  if (request.headers.get('X-GitHub-Event') !== 'pull_request') {
    return json(200, { ignored: 'not a pull_request event' });
  }

  let payload: PullRequestPayload;
  try {
    payload = JSON.parse(rawBody) as PullRequestPayload;
  } catch {
    return json(400, { error: 'invalid JSON' });
  }

  // 4. Parse the alfred frontmatter block; no block → not ours, ignore.
  const frontmatter = parseFrontmatter(payload.pull_request.body ?? undefined);
  if (frontmatter === undefined) {
    return json(200, { ignored: 'no alfred frontmatter block' });
  }

  // 5. Plan the transition from (phase, action, merged); undefined → a no-op action.
  const plan = planTransition({
    phase: frontmatter.phase,
    action: payload.action,
    merged: payload.pull_request.merged,
    prUrl: payload.pull_request.html_url,
    specPath: frontmatter.specPath,
  });
  if (plan === undefined) {
    return json(200, { ignored: `no-op for action '${payload.action}'` });
  }

  // 6. Apply the column updates to every ticket the PR names (always a list), against the
  //    table the plan routes to — `code_items` for a story phase, `epics` for epic-refinement.
  const patch = patchFor(plan.target);
  const results = await Promise.all(
    frontmatter.tickets.map(async (ref) => ({
      ref,
      count: await patch(env, ref, plan.updates),
    })),
  );
  const matched = results.filter((result) => result.count > 0).map((result) => result.ref);

  // 7. Snapshot the document in the background on refinement- or spike-merge — best-effort,
  //    post-response. A spike snapshots on MERGE, not open: its findings only exist on its own PR.
  if (plan.snapshotSpec && frontmatter.specPath !== undefined && matched.length > 0) {
    ctx.waitUntil(snapshotSpec(env, payload, matched, frontmatter.specPath, plan.target));
  }

  // `state` is undefined for an epic plan — epics have no factory_state.
  return json(200, { ok: true, tickets: matched, state: plan.updates.factory_state });
}

/** The `push` payload fields we read. */
interface PushPayload {
  ref?: string;
  repository?: { full_name?: string };
}

/**
 * A (signature-verified) push. Only a push to `WIKI_REPO`'s main means anything: the sync runs
 * after the response, via `ctx.waitUntil`, and the 202 says it was queued rather than done.
 * The sync reads the tree itself, so nothing in the payload beyond the repo and ref is trusted.
 */
function handlePush(rawBody: string, env: Env, ctx: ExecutionContext): Response {
  let payload: PushPayload;
  try {
    // `?? {}`: a bare JSON `null` is valid JSON and must read as "not the wiki", not throw.
    payload = (JSON.parse(rawBody) as PushPayload | undefined) ?? {};
  } catch {
    return json(400, { error: 'invalid JSON' });
  }

  if (payload.repository?.full_name !== env.WIKI_REPO || payload.ref !== 'refs/heads/main') {
    return json(200, { ignored: `not a push to ${env.WIKI_REPO} main` });
  }

  ctx.waitUntil(runWikiSync(env));
  return json(202, { sync: 'queued' });
}

/** The ref-keyed PATCH for a plan's target table. */
function patchFor(target: TransitionTarget): typeof patchCodeItem {
  return target === 'epic' ? patchEpic : patchCodeItem;
}

/**
 * Fetch the merged spec from GitHub and store it on each matched ticket. Best-effort: a
 * failed fetch leaves `spec_markdown` null and the modal falls back to the live "view in repo"
 * link — the state transition is already recorded, so this never blocks it.
 *
 * `epics` names its snapshot columns exactly as `code_items` does, so the only per-target
 * difference is which table the snapshot lands in.
 */
async function snapshotSpec(
  env: Env,
  payload: PullRequestPayload,
  refs: string[],
  specPath: string,
  target: TransitionTarget,
): Promise<void> {
  const [owner, name] = payload.repository.full_name.split('/');
  const sha = payload.pull_request.merge_commit_sha ?? undefined;
  // Truthiness (not `=== undefined`) so all three narrow to `string` for the fetch below.
  if (!owner || !name || !sha) return;

  const spec = await fetchSpec(env, owner, name, specPath, sha);
  if (spec === undefined) return;

  const patch = patchFor(target);
  await Promise.all(
    refs.map((ref) => patch(env, ref, { spec_markdown: spec.markdown, spec_sha: spec.sha })),
  );
}

export { handleWebhook };
