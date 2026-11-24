import { GitHistory } from '../git.ts';
import type { GitRunner } from '../git.ts';
import { skillPathsIn } from '../replay.ts';
import type { JsonObject } from '../types.ts';
import type { StartState } from './state.ts';

/** The leading ticket ref (`ALF-310`) of a prompt, when it has one. */
function refOf(prompt: string): string | null {
  return /^[A-Z]+-\d+/.exec(prompt)?.[0] ?? null;
}

/**
 * What a prompt contributes to a write: the prompt itself, the skills it names resolved to blobs at
 * the commit the session started on (omitted without a start state, since there is no answer then),
 * and its leading ref when it has one. The server freezes all three with the first write that
 * carries a prompt, so every write that sends one must send its skills alongside.
 */
export function promptFields(
  prompt: string,
  state: StartState | null,
  git: GitRunner,
): { prompt: string; skills?: JsonObject[]; ref?: string } {
  const ref = refOf(prompt);
  const history = new GitHistory(git);
  return {
    prompt,
    ...(state !== null && {
      skills: skillPathsIn(prompt).map((skill) => ({
        path: skill,
        blob_sha: history.blobAt(state.base_sha, skill),
      })),
    }),
    ...(ref !== null && { ref }),
  };
}

/**
 * The first-prompt write: the prompt as the session received it, so the session's ticket learns of
 * it while the first turn is still running rather than when it stops.
 */
export function promptBody(args: {
  sessionId: string;
  prompt: string;
  state: StartState;
  git: GitRunner;
}): JsonObject {
  return {
    event: 'prompt',
    session_id: args.sessionId,
    repo: args.state.repo,
    ...promptFields(args.prompt, args.state, args.git),
    warnings: [],
  };
}
