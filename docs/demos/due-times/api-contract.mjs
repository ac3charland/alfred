#!/usr/bin/env node
/**
 * POST /api/items and PATCH /api/items/:id with `due_time`, against the real Next app booted by
 * `with-app.sh`.
 *
 * REAL: the route handlers, their zod schemas, `@supabase/ssr` sign-in and cookies. STOOD UP
 * LOCALLY: Supabase — the E2E harness's in-memory mock (`frontend/scripts/mock-supabase.mjs`),
 * which mirrors the migration's CHECK and clear-with-the-date trigger. Ids are literals, so the
 * output is deterministic.
 */
import process from 'node:process';

import { createServerClient } from '@supabase/ssr';

const APP = process.env.APP_URL;
const MOCK = process.env.MOCK_URL;
const TIMED = 'a1610000-0000-4000-8000-000000000001';
const UNDATED = 'a1610000-0000-4000-8000-000000000002';

const jar = new Map();
const auth = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, value);
      },
    },
  },
);
const { error: signInError } = await auth.auth.signInWithPassword({
  email: 'demo@alfred.test',
  password: 'demo-password-123',
});
if (signInError) throw signInError;
const COOKIE = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

await fetch(`${MOCK}/__mock__/reset`, { method: 'POST' });
const seeded = await fetch(`${MOCK}/__mock__/seed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: [
      { id: TIMED, title: 'Call the dentist', item_type: 'task', due_date: '2026-10-03', due_time: '15:00:00' },
      { id: UNDATED, title: 'Water the plants', item_type: 'task' },
    ],
  }),
});
if (!seeded.ok) throw new Error(`seed failed: ${seeded.status}`);

/** One request, printed as `METHOD path body → status` plus the fields that matter. */
async function call(method, path, body) {
  const response = await fetch(`${APP}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  const shown =
    response.ok
      ? JSON.stringify({ due_date: json.due_date, due_time: json.due_time })
      : JSON.stringify(json);
  console.log(`${method} ${path.replace(/[0-9a-f-]{36}$/, ':id')} ${JSON.stringify(body)}`);
  console.log(`  → ${String(response.status)} ${shown}`);
}

console.log('Create');
await call('POST', '/api/items', { title: 'Dentist', item_type: 'task', due_date: '2026-10-04', due_time: '15:00' });
await call('POST', '/api/items', { title: 'Dentist', item_type: 'task', due_time: '15:00' });
await call('POST', '/api/items', { title: 'Dentist', item_type: 'task', due_date: null, due_time: '15:00' });
await call('POST', '/api/items', { title: 'Dentist', item_type: 'task', due_date: '2026-10-04', due_time: '3pm' });
console.log('');
console.log('Update');
await call('PATCH', `/api/items/${TIMED}`, { due_time: '09:30' });
await call('PATCH', `/api/items/${TIMED}`, { due_date: '2026-10-10' });
await call('PATCH', `/api/items/${TIMED}`, { due_time: '15:00:00' });
await call('PATCH', `/api/items/${TIMED}`, { due_time: '25:00' });
await call('PATCH', `/api/items/${TIMED}`, { due_date: null, due_time: '15:00' });
await call('PATCH', `/api/items/${TIMED}`, { due_date: null });
await call('PATCH', `/api/items/${UNDATED}`, { due_time: '15:00' });
