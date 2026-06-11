/**
 * In-memory mock of the Supabase HTTP API (GoTrue Auth + PostgREST) for the
 * Playwright integration suite.
 *
 * WHY: every Supabase touch in alfred is server-side (middleware getUser,
 * lib/data readers, route handlers) — so Playwright's browser-level page.route()
 * can't intercept it. Instead we point the Next server's NEXT_PUBLIC_SUPABASE_URL
 * at this process (see playwright.config.ts). The real @supabase/ssr client,
 * cookie handling, PostgREST query strings and route handlers all still execute;
 * only the database+auth backend is faked. That makes these genuine integration
 * tests with zero production-code branches, and lets us drive the authenticated
 * app to any seeded state.
 *
 * It implements just the subset of the wire protocol alfred uses:
 *   Auth (GoTrue):
 *     POST /auth/v1/token?grant_type=password|refresh_token   → mint a session
 *     GET  /auth/v1/user                                      → the single user
 *     POST /auth/v1/logout                                    → 204
 *   Data (PostgREST):
 *     GET|POST|PATCH|DELETE /rest/v1/{folders,items}          → CRUD + filters
 *     POST /rest/v1/rpc/complete_subtree                      → cascade complete
 *   Test control (not part of Supabase):
 *     GET  /__mock__/health   POST /__mock__/reset   POST /__mock__/seed
 *
 * Single-process, in-memory, single worker (playwright.config runs workers: 1),
 * so a shared store with per-test reset/seed is safe. Self-contained: only Node
 * builtins, no cross-package imports, so `node scripts/mock-supabase.mjs` runs
 * standalone as a Playwright webServer.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import process from 'node:process';

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? '54331');

// The single user. alfred is single-user; credentials are shared with the
// Playwright auth.setup (see e2e/support/constants.ts).
const USER = {
  id: process.env.E2E_USER_ID ?? '00000000-0000-4000-8000-000000000001',
  email: process.env.E2E_USER_EMAIL ?? 'demo@alfred.test',
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: '2024-01-01T00:00:00.000Z',
  phone: '',
  confirmed_at: '2024-01-01T00:00:00.000Z',
  last_sign_in_at: '2024-01-01T00:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};
const PASSWORD = process.env.E2E_USER_PASSWORD ?? 'demo-password-123';

// Mutable data tables, reset/seeded between tests via /__mock__/*.
/** @type {Record<string, unknown>[]} */
let folders = [];
/** @type {Record<string, unknown>[]} */
let items = [];

// ── helpers ────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  // The browser login (createBrowserClient) is the one cross-origin caller; allow
  // every header the supabase client sends so the preflight passes.
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
};

function sendJson(res, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return;
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return;
  try {
    return JSON.parse(text);
  } catch {
    return;
  }
}

/** A PostgREST request wants a single object when the Accept header asks for it. */
function wantsObject(req) {
  return (req.headers['accept'] ?? '').includes('application/vnd.pgrst.object');
}

function wantsRepresentation(req) {
  return (req.headers['prefer'] ?? '').includes('return=representation');
}

// ── PostgREST filtering ──────────────────────────────────────────────────────

/**
 * Apply the `column=op.value` filters from the query string. alfred only uses
 * `eq` (e.g. id=eq.x, folder_id=eq.x, status=eq.active) and `is` (folder_id=is.null).
 */
function applyFilters(rows, searchParameters) {
  let result = rows;
  const nonFilterKeys = new Set(['select', 'order', 'limit', 'offset']);
  for (const [key, raw] of searchParameters.entries()) {
    if (nonFilterKeys.has(key)) continue;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    if (op === 'is') {
      const target = value === 'null' ? null : value === 'true';
      result = result.filter((row) => row[key] === target);
    } else if (op === 'eq') {
      result = result.filter((row) => String(row[key]) === value);
    }
  }
  return result;
}

function applyOrder(rows, searchParameters) {
  const order = searchParameters.get('order');
  if (!order) return rows;
  const [column, direction] = order.split('.');
  const sorted = rows.toSorted((a, b) => {
    const av = String(a[column] ?? '');
    const bv = String(b[column] ?? '');
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return direction === 'desc' ? sorted.toReversed() : sorted;
}

function tableFor(name) {
  if (name === 'folders') return folders;
  if (name === 'items') return items;
  return;
}

// ── row construction ─────────────────────────────────────────────────────────

function newItem(input) {
  return {
    id: input.id ?? randomUUID(),
    created_at: input.created_at ?? new Date().toISOString(),
    title: input.title ?? '',
    notes: input.notes ?? null,
    source_url: input.source_url ?? null,
    raw_capture: input.raw_capture ?? null,
    item_type: input.item_type ?? 'unclassified',
    status: input.status ?? 'active',
    due_date: input.due_date ?? null,
    completed_at: input.completed_at ?? null,
    folder_id: input.folder_id ?? null,
    parent_id: input.parent_id ?? null,
  };
}

function newFolder(input) {
  return {
    id: input.id ?? randomUUID(),
    created_at: input.created_at ?? new Date().toISOString(),
    name: input.name ?? '',
  };
}

/** Ids of an item plus every descendant (matches the DB parent_id cascade). */
function subtreeIds(rootId) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.parent_id !== null && ids.has(item.parent_id) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  return ids;
}

// ── route handlers ─────────────────────────────────────────────────────────

function handleAuth(req, res, url, body) {
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    const grantType = url.searchParams.get('grant_type');
    if (grantType === 'password' && (body?.email !== USER.email || body?.password !== PASSWORD)) {
      sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
      });
      return;
    }
    // password or refresh_token both mint a fresh, long-lived session.
    sendJson(res, 200, makeSession());
    return;
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
    const auth = req.headers['authorization'] ?? '';
    if (!auth.startsWith('Bearer ') || auth.slice(7).length === 0) {
      sendJson(res, 401, { code: 401, message: 'invalid claim: missing sub claim' });
      return;
    }
    // Any non-empty access token we minted maps to the single user.
    sendJson(res, 200, USER);
    return;
  }
  if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
    sendNoContent(res);
    return;
  }
  sendJson(res, 404, { message: `No auth route: ${req.method} ${url.pathname}` });
}

function makeSession() {
  const expiresIn = 60 * 60 * 24 * 365; // far-future so it never expires mid-test
  return {
    access_token: `mock-access-${randomUUID()}`,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: `mock-refresh-${randomUUID()}`,
    user: USER,
  };
}

function handleRpc(req, res, fn, body) {
  if (fn === 'complete_subtree' && req.method === 'POST') {
    const rootId = body?.root_id;
    const ids = subtreeIds(rootId);
    const now = new Date().toISOString();
    const affected = [];
    for (const item of items) {
      if (ids.has(item.id)) {
        item.status = 'completed';
        item.completed_at = now;
        affected.push(item);
      }
    }
    sendJson(res, 200, affected);
    return;
  }
  sendJson(res, 404, { message: `No rpc: ${fn}` });
}

function handleRest(req, res, url, body) {
  const rest = url.pathname.slice('/rest/v1/'.length);

  if (rest.startsWith('rpc/')) {
    handleRpc(req, res, rest.slice('rpc/'.length), body);
    return;
  }

  const table = tableFor(rest);
  if (table === undefined) {
    sendJson(res, 404, { message: `No table: ${rest}` });
    return;
  }

  if (req.method === 'GET') {
    const rows = applyOrder(applyFilters(table, url.searchParams), url.searchParams);
    sendJson(res, 200, wantsObject(req) ? (rows[0] ?? null) : rows);
    return;
  }

  if (req.method === 'POST') {
    const inputs = Array.isArray(body) ? body : [body];
    const created = inputs.map((input) => {
      const row = rest === 'folders' ? newFolder(input) : newItem(input);
      table.push(row);
      return row;
    });
    if (!wantsRepresentation(req)) {
      sendNoContent(res);
      return;
    }
    sendJson(res, 201, wantsObject(req) ? created[0] : created);
    return;
  }

  if (req.method === 'PATCH') {
    const matched = applyFilters(table, url.searchParams);
    for (const row of matched) Object.assign(row, body);
    if (!wantsRepresentation(req)) {
      sendNoContent(res);
      return;
    }
    sendJson(res, 200, wantsObject(req) ? (matched[0] ?? null) : matched);
    return;
  }

  if (req.method === 'DELETE') {
    const matched = applyFilters(table, url.searchParams);
    const removeIds = new Set();
    for (const row of matched) {
      if (rest === 'items') {
        for (const id of subtreeIds(row.id)) removeIds.add(id);
      } else {
        removeIds.add(row.id);
      }
    }
    if (rest === 'folders') {
      // ON DELETE SET NULL: items in a deleted folder return to the Inbox.
      for (const item of items) {
        if (removeIds.has(item.folder_id)) item.folder_id = null;
      }
      folders = folders.filter((folder) => !removeIds.has(folder.id));
    } else {
      items = items.filter((item) => !removeIds.has(item.id));
    }
    sendNoContent(res);
    return;
  }

  sendJson(res, 405, { message: `Method not allowed: ${req.method}` });
}

function handleControl(req, res, url, body) {
  if (url.pathname === '/__mock__/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/__mock__/reset' && req.method === 'POST') {
    folders = [];
    items = [];
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/__mock__/seed' && req.method === 'POST') {
    folders = Array.isArray(body?.folders) ? body.folders.map((f) => newFolder(f)) : [];
    items = Array.isArray(body?.items) ? body.items.map((i) => newItem(i)) : [];
    sendJson(res, 200, { folders, items });
    return;
  }
  if (url.pathname === '/__mock__/state' && req.method === 'GET') {
    sendJson(res, 200, { folders, items });
    return;
  }
  sendJson(res, 404, { message: `No control route: ${req.method} ${url.pathname}` });
}

// ── server ───────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${String(PORT)}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await readBody(req);

    try {
      if (url.pathname.startsWith('/__mock__/')) {
        handleControl(req, res, url, body);
      } else if (url.pathname.startsWith('/auth/v1/')) {
        handleAuth(req, res, url, body);
      } else if (url.pathname.startsWith('/rest/v1/')) {
        handleRest(req, res, url, body);
      } else {
        sendJson(res, 404, { message: `Not found: ${req.method} ${url.pathname}` });
      }
    } catch (error) {
      sendJson(res, 500, { message: error instanceof Error ? error.message : 'mock error' });
    }
  })();
});

server.listen(PORT, () => {
  process.stdout.write(`mock-supabase listening on http://localhost:${String(PORT)}\n`);
});
