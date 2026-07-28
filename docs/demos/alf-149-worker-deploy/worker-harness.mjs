// Load the real Worker entrypoint from TypeScript source.
//
// `workers/src/index.ts` imports its siblings extensionless (`./frontmatter`), which Node's
// type-stripping loader won't resolve on its own — so register a tiny resolve hook that appends
// `.ts`. Everything the demo exercises below is then the SHIPPING code, not a reimplementation.
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
    const candidate = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
  }
  return next(specifier, context);
}`;

register('data:text/javascript,' + encodeURIComponent(HOOK), import.meta.url);

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const workerModule = await import(resolve(REPO_ROOT, 'workers/src/index.ts'));

/** PR 247's `alfred` block, verbatim — the epic-refinement PR whose spec never attached. */
export const PR_247_BODY = [
  '```alfred',
  'alfred-ticket: ALF-146',
  'phase: epic-refinement',
  'spec-path: docs/specs/epics/ALF-146.html',
  '```',
].join('\n');

export const ENV = {
  GITHUB_WEBHOOK_SECRET: 'webhook-secret',
  GITHUB_TOKEN: 'pat-123',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

/** HMAC-SHA256 hex of `body`, as GitHub's `X-Hub-Signature-256` value. */
export async function sign(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deliver a signed `pull_request` webhook, capturing every outbound call the Worker makes. */
export async function deliver({ action, merged }) {
  const payload = JSON.stringify({
    action,
    pull_request: {
      body: PR_247_BODY,
      html_url: 'https://github.com/ac3charland/alfred/pull/247',
      merged,
      merge_commit_sha: '832fe360e52a9075bf0aa13aa2abdb0568209846',
    },
    repository: { full_name: 'ac3charland/alfred' },
  });

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    return String(url).startsWith('https://api.github.com/')
      ? new Response(
          JSON.stringify({ content: btoa('<html>the epic spec</html>'), encoding: 'base64', sha: 'b1a5f00d' }),
          { status: 200 },
        )
      : new Response(JSON.stringify([{ ref: 'ALF-146' }]), { status: 200 });
  };

  const background = [];
  const ctx = { waitUntil: (p) => background.push(p) };
  const request = new Request('https://worker.dev/github/webhook', {
    method: 'POST',
    body: payload,
    headers: {
      'X-GitHub-Event': 'pull_request',
      'X-Hub-Signature-256': await sign(ENV.GITHUB_WEBHOOK_SECRET, payload),
    },
  });

  const response = await workerModule.default.fetch(request, ENV, ctx);
  const text = await response.text();
  await Promise.all(background);
  return { status: response.status, text, calls };
}

export { existsSync };
