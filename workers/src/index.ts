/**
 * alfred Software Factory — the GitHub PR webhook Worker (code-module §13).
 *
 * One signature-verified Worker, no LLM: it turns `pull_request` webhooks into deterministic
 * `code_items` state transitions. Because both lifecycle phases end in a PR, this single endpoint
 * tracks the whole factory (§1 keystone). Flow per delivery:
 *   verify HMAC → it's a pull_request → parse the `alfred` block → plan the transition →
 *   PATCH the ticket(s) → (on refinement-merge) snapshot the spec in the background.
 */
import { parseFrontmatter } from './frontmatter';
import { fetchSpec } from './github';
import { verifySignature } from './hmac';
import { patchCodeItem } from './supabase';
import { planTransition } from './transitions';

/**
 * Worker secrets (code-module §13.4 / §19.1). Hand-written because these are SECRETS, not
 * `wrangler.toml` bindings — `wrangler types` only generates bindings, so secret typing must be
 * declared here. Values are set with `wrangler secret put`, never committed.
 */
export interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

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
    headers: { 'Content-Type': 'application/json' },
  });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check (keep the skeleton's default 200, §13.1).
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('alfred workers ok');
    }

    if (request.method === 'POST' && url.pathname === '/github/webhook') {
      return handleWebhook(request, env, ctx);
    }

    return new Response('not found', { status: 404 });
  },
};

async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // 1. Verify GitHub's HMAC over the RAW body before anything else (§13.1) — reject forgeries.
  const rawBody = await request.text();
  const signature = request.headers.get('X-Hub-Signature-256') ?? undefined;
  if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, rawBody, signature))) {
    return json(401, { error: 'invalid signature' });
  }

  // 2. We only act on pull_request events (§13.2).
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

  // 5. Apply the column updates to every ticket the PR names (§12 — always a list).
  const results = await Promise.all(
    frontmatter.tickets.map(async (ref) => ({
      ref,
      count: await patchCodeItem(env, ref, plan.updates),
    })),
  );
  const matched = results.filter((result) => result.count > 0).map((result) => result.ref);

  // 6. Snapshot the spec in the background on refinement-merge (§13.3) — best-effort, post-response.
  if (plan.snapshotSpec && frontmatter.specPath !== undefined && matched.length > 0) {
    ctx.waitUntil(snapshotSpec(env, payload, matched, frontmatter.specPath));
  }

  return json(200, { ok: true, tickets: matched, state: plan.updates.factory_state });
}

/**
 * Fetch the merged spec from GitHub and store it on each matched ticket (§13.3). Best-effort: a
 * failed fetch leaves `spec_markdown` null and the modal falls back to the live "view in repo"
 * link — the state transition is already recorded, so this never blocks it.
 */
async function snapshotSpec(
  env: Env,
  payload: PullRequestPayload,
  refs: string[],
  specPath: string,
): Promise<void> {
  const [owner, name] = payload.repository.full_name.split('/');
  const sha = payload.pull_request.merge_commit_sha ?? undefined;
  // Truthiness (not `=== undefined`) so all three narrow to `string` for the fetch below.
  if (!owner || !name || !sha) return;

  const spec = await fetchSpec(env, owner, name, specPath, sha);
  if (spec === undefined) return;

  await Promise.all(
    refs.map((ref) =>
      patchCodeItem(env, ref, { spec_markdown: spec.markdown, spec_sha: spec.sha }),
    ),
  );
}

export { handleWebhook };
