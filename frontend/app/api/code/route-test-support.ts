import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Shared fixtures for the two routes that measure GitHub across the Code module's
 * projects — `pr-ratio` and `loc-velocity`. Both read the exact same `projects` columns
 * through the exact same session-or-admin-client resolution (`resolveIngestClient`), so the
 * Supabase stub and its auth helpers are one thing to maintain, not two copies drifting apart.
 *
 * Each consuming test file keeps its own `jest.mock('@/lib/supabase/server', …)` and
 * `jest.mock('@/lib/supabase/admin', …)` calls — Jest hoists `jest.mock` per file, so this
 * module can't set those up on a caller's behalf — but importing `createClient` /
 * `createAdminClient` here still resolves to that file's mock, since both modules load into
 * the same per-file module registry.
 */

export const mockCreateClient = jest.mocked(createClient);
export const mockCreateAdminClient = jest.mocked(createAdminClient);

const TEST_USER = { id: 'user-123' };

/** A project row as the route selects it — oldest first, the order the table answers in. */
export interface ProjectRepoRow {
  name: string;
  repo_owner: string;
  repo_name: string;
}

export const PROJECTS: ProjectRepoRow[] = [
  { name: 'RealPlay', repo_owner: 'ac3charland', repo_name: 'realplay' },
  { name: 'Alfred', repo_owner: 'ac3charland', repo_name: 'alfred' },
];

export interface ProjectsRead {
  data: ProjectRepoRow[] | null;
  error: { message: string; code?: string } | null;
}

/** The stubbed `projects` read: a chainable `select().order()` resolving to `read`. */
export interface SupabaseProjectsDouble {
  auth: { getUser: jest.Mock };
  from: jest.Mock;
  _chain: { select: jest.Mock; order: jest.Mock };
}

/**
 * A Supabase stub that says whether a session exists and answers the one `projects` read the
 * route makes. The spies are returned so a test can assert which client served the read and
 * how it was ordered.
 */
export function makeSupabase(
  user: { id: string } | undefined,
  read: ProjectsRead,
): SupabaseProjectsDouble {
  const chain = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(read),
  };
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

export const READ_OK: ProjectsRead = { data: PROJECTS, error: null };

/** A signed-in browser session whose `projects` read answers `read`. */
export function signedIn(read: ProjectsRead = READ_OK): SupabaseProjectsDouble {
  const supabase = makeSupabase(TEST_USER, read);
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

/** No session at all; a keyed caller is served by the admin client, which answers `read`. */
export function keyedCaller(read: ProjectsRead = READ_OK): SupabaseProjectsDouble {
  mockCreateClient.mockResolvedValue(makeSupabase(undefined, { data: [], error: null }) as never);
  const admin = makeSupabase(undefined, read);
  mockCreateAdminClient.mockReturnValue(admin as never);
  return admin;
}
