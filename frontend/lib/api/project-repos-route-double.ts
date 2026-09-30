import {
  type SupabaseDouble,
  makeSignedOutDouble,
  makeSupabaseDouble,
} from '@/lib/api/supabase-route-double';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Shared fixtures for the two routes that measure GitHub across the Code module's
 * projects — `pr-ratio` and `loc-velocity`. Both read the exact same `projects` columns
 * through the exact same session-or-admin-client resolution (`resolveIngestClient`), so the
 * Supabase stub and its auth helpers are one thing to maintain, not two copies drifting apart.
 * Built on the shared route-test double (`lib/api/supabase-route-double`): the `projects` read
 * is a `list` terminal (the route awaits `.select().order()` directly, no `.single()`).
 *
 * Each consuming test file keeps its own `jest.mock('@/lib/supabase/server', …)` and
 * `jest.mock('@/lib/supabase/admin', …)` calls — Jest hoists `jest.mock` per file, so this
 * module can't set those up on a caller's behalf — but importing `createClient` /
 * `createAdminClient` here still resolves to that file's mock, since both modules load into
 * the same per-file module registry.
 */

export const mockCreateClient = jest.mocked(createClient);
export const mockCreateAdminClient = jest.mocked(createAdminClient);

/** A project row as the route selects it — oldest first, the order the table answers in. */
export interface ProjectRepoRow {
  name: string;
  repo_owner: string;
  repo_name: string;
  exclude_from_pr_ratio: boolean;
}

export const PROJECTS: ProjectRepoRow[] = [
  {
    name: 'RealPlay',
    repo_owner: 'ac3charland',
    repo_name: 'realplay',
    exclude_from_pr_ratio: false,
  },
  { name: 'Alfred', repo_owner: 'ac3charland', repo_name: 'alfred', exclude_from_pr_ratio: false },
];

/** A third project the owner has excluded from the PR ratio, as the knowledge repo ships. */
export const EXCLUDED_KNOWLEDGE: ProjectRepoRow = {
  name: 'Knowledge',
  repo_owner: 'ac3charland',
  repo_name: 'knowledge',
  exclude_from_pr_ratio: true,
};

export interface ProjectsRead {
  data: ProjectRepoRow[] | null;
  error: { message: string; code?: string } | null;
}

export const READ_OK: ProjectsRead = { data: PROJECTS, error: null };

/** Builds the `projects` table stub the shared double expects from a `ProjectsRead`. */
function projectsDouble(read: ProjectsRead): SupabaseDouble {
  return makeSupabaseDouble({
    projects: { list: { data: read.data, error: read.error ?? undefined } },
  });
}

/** A signed-in browser session whose `projects` read answers `read`. */
export function signedIn(read: ProjectsRead = READ_OK): SupabaseDouble {
  const supabase = projectsDouble(read);
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

/** No session at all; a keyed caller is served by the admin client, which answers `read`. */
export function keyedCaller(read: ProjectsRead = READ_OK): SupabaseDouble {
  mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
  const admin = projectsDouble(read);
  mockCreateAdminClient.mockReturnValue(admin as never);
  return admin;
}
