// Preloaded into the Next server (`NODE_OPTIONS=--import …`) so the demo's real route handlers
// can run end to end without reaching GitHub. Only `api.github.com` is answered here; every other
// request (the in-memory Supabase mock above all) goes to the real `fetch`.
//
// Search counts are fixed per repo so the ratio is deterministic, and every search query the
// route sends is appended to $GITHUB_STUB_LOG so the demo can show exactly what was asked.
import { appendFileSync } from 'node:fs';

const MERGED_PRS = { 'ac3charland/realplay': 2, 'ac3charland/alfred': 6, 'ac3charland/knowledge': 4 };
const OTHER_PRS = 1;

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== 'api.github.com') return realFetch(input, init);

  if (url.pathname === '/search/issues') {
    const query = url.searchParams.get('q') ?? '';
    if (process.env.GITHUB_STUB_LOG) appendFileSync(process.env.GITHUB_STUB_LOG, `${query}\n`);
    // `repo:` only at a word start, so the Other sweep's `-repo:` exclusions don't match.
    const repo = /(?:^| )repo:(\S+)/.exec(query)?.[1];
    return Response.json({ total_count: repo === undefined ? OTHER_PRS : (MERGED_PRS[repo] ?? 0) });
  }

  // Contributor statistics: no commits — the demo reads only which repos were counted.
  return Response.json([]);
};
