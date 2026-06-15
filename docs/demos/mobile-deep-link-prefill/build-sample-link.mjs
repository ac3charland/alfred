// Builds a sample refinement deep link from the REAL link builder and prints the
// composer param, proving the prefill rides on `q` (the param the mobile Claude app reads).
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { buildRefinementUrl } = await import(
  resolve(here, '../../../frontend/lib/code/links.ts')
);

const project = { repo_owner: 'ac3charland', repo_name: 'alfred' };
const story = { ref: 'ALF-42', title: 'Verify the webhook HMAC signature', notes: null, spec_path: null };

const u = new URL(buildRefinementUrl(project, story));
console.log('origin+path :', u.origin + u.pathname);
console.log('q present   :', u.searchParams.has('q'));
console.log('prompt absent:', !u.searchParams.has('prompt'));
console.log('q first line:', (u.searchParams.get('q') ?? '').split('\n')[0]);
