/**
 * alfred's one Worker, serving two unrelated jobs from a single entrypoint.
 *
 * `fetch` is the GitHub PR webhook: signature-verified, no LLM, it turns `pull_request` webhooks
 * into deterministic `code_items` state transitions. Because both lifecycle phases end in a PR,
 * this single endpoint tracks the whole factory. Flow per delivery:
 *   verify HMAC → it's a pull_request → parse the `alfred` block → plan the transition →
 *   PATCH the ticket(s) → (on refinement- or spike-merge) snapshot the document in the background.
 *
 * `scheduled` is the Inbox classifier, fired by the cron trigger in wrangler.toml. Both handlers
 * stay thin and delegate — the webhook to `handleWebhook`, the cron to `runSweep`.
 */
import { parseFrontmatter } from './frontmatter';
import { fetchSpec } from './github';
import { verifySignature } from './hmac';
import { patchCodeItem, patchEpic } from './supabase';
import { runSweep } from './sweep';
import { type TransitionTarget, planTransition } from './transitions';

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
          `classifier ${env.CLASSIFIER_MODEL} @ ${env.CLASSIFIER_TIMEZONE})`,
      );
    }

    if (request.method === 'POST' && url.pathname === '/github/webhook') {
      return handleWebhook(request, env, ctx);
    }

    return new Response('not found', { status: 404 });
  },

  /**
   * The cron trigger's entrypoint. Thin by design — it delegates to `runSweep` exactly as
   * `fetch` delegates to `handleWebhook`.
   *
   * The promise is AWAITED rather than handed to `ctx.waitUntil` or fired and forgotten: a
   * scheduled invocation is torn down when the promise it returns settles, so unawaited work is
   * silently killed part-way through the sweep.
   */
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const summary = await runSweep(env, new Date());
    console.log(
      `classifier sweep: ${String(summary.eligible)} eligible, ` +
        `${String(summary.classified)} classified, ${String(summary.failed)} failed` +
        (summary.aborted ? ' (aborted)' : ''),
    );
  },
};

async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // 1. Verify GitHub's HMAC over the RAW body before anything else — reject forgeries.
  const rawBody = await request.text();
  const signature = request.headers.get('X-Hub-Signature-256') ?? undefined;
  if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, rawBody, signature))) {
    return json(401, { error: 'invalid signature' });
  }

  // 2. We only act on pull_request events.
  if (request.headers.get('X-GitHub-Event') !== 'pull_request') {
    return json(200, { ignored: 'not a pull_request event' });
  }

  let payload: PullRequestPayload;
  try {
    payload = JSON.parse(rawBody) as PullRequestPayload;
  } catch {
    return json(400, { error: 'invalid JSON' });
  }

  // 3. Parse the alfred frontmatter block; no block → not ours, ignore.
  const frontmatter = parseFrontmatter(payload.pull_request.body ?? undefined);
  if (frontmatter === undefined) {
    return json(200, { ignored: 'no alfred frontmatter block' });
  }

  // 4. Plan the transition from (phase, action, merged); undefined → a no-op action.
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

  // 5. Apply the column updates to every ticket the PR names (always a list), against the
  //    table the plan routes to — `code_items` for a story phase, `epics` for epic-refinement.
  const patch = patchFor(plan.target);
  const results = await Promise.all(
    frontmatter.tickets.map(async (ref) => ({
      ref,
      count: await patch(env, ref, plan.updates),
    })),
  );
  const matched = results.filter((result) => result.count > 0).map((result) => result.ref);

  // 6. Snapshot the document in the background on refinement- or spike-merge — best-effort,
  //    post-response. A spike snapshots on MERGE, not open: its findings only exist on its own PR.
  if (plan.snapshotSpec && frontmatter.specPath !== undefined && matched.length > 0) {
    ctx.waitUntil(snapshotSpec(env, payload, matched, frontmatter.specPath, plan.target));
  }

  // `state` is undefined for an epic plan — epics have no factory_state.
  return json(200, { ok: true, tickets: matched, state: plan.updates.factory_state });
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
