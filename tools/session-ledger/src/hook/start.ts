import type { GitRunner } from '../git.ts';
import type { JsonObject } from '../types.ts';
import { named } from './failure.ts';
import { captureStart } from './repo.ts';
import { writeState } from './state.ts';

/**
 * The session-start write: what the session started from. The state file keeps that for every
 * later stop, since by then the session has moved the checkout.
 */
export function startBody(args: {
  sessionId: string;
  git: GitRunner;
  tmpDir: string;
  now: Date;
}): JsonObject {
  const { repo, base_sha, builder_sha } = captureStart(args.git);
  if (repo === null) throw named('RepoUnresolved');
  if (base_sha === null) throw named('BaseUnresolved');
  writeState(args.tmpDir, args.sessionId, { repo, base_sha, builder_sha });
  return {
    event: 'session-start',
    session_id: args.sessionId,
    repo,
    base_sha,
    builder_sha,
    session_created_at: args.now.toISOString(),
    warnings: [],
  };
}
