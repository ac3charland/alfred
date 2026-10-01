import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { GitHistory } from '../git.ts';
import type { GitRunner } from '../git.ts';
import { skillPathsIn } from '../replay.ts';
import { byString, sortedBy } from '../sort.ts';
import type { JsonObject } from '../types.ts';
import { named } from './failure.ts';
import { repoFromRemote } from './repo.ts';
import { readState } from './state.ts';
import {
  hasPartialUsage,
  mainFacts,
  mergeUsage,
  parseJsonl,
  tokenTotals,
  usageByModel,
} from './transcript.ts';
import type { UsageByModel } from './transcript.ts';

const AGENT_FILE = /^agent-.+\.jsonl$/;

/** The leading ticket ref (`ALF-310`) of a prompt, when it has one. */
function refOf(prompt: string): string | null {
  return /^[A-Z]+-\d+/.exec(prompt)?.[0] ?? null;
}

interface Subagents {
  usage: UsageByModel;
  count: number;
  unreadable: boolean;
  /** Some subagent response was recorded only by its streaming-start placeholder. */
  partial: boolean;
}

/** Every subagent's own transcript, `<transcript minus .jsonl>/subagents/agent-*.jsonl`. */
function readSubagents(transcriptPath: string): Subagents {
  const dir = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => AGENT_FILE.test(name));
  } catch (error) {
    // No directory means no subagents ran; any other failure means some did and can't be counted.
    const missing = (error as { code?: unknown }).code === 'ENOENT';
    return { usage: {}, count: 0, unreadable: !missing, partial: false };
  }
  let usage: UsageByModel = {};
  let unreadable = false;
  let partial = false;
  for (const name of sortedBy(names, byString)) {
    try {
      const entries = parseJsonl(readFileSync(path.join(dir, name), 'utf8'));
      usage = mergeUsage(usage, usageByModel(entries));
      partial ||= hasPartialUsage(entries);
    } catch {
      unreadable = true;
    }
  }
  return { usage, count: names.length, unreadable, partial };
}

/**
 * The stop write: the whole picture so far, recounted from the transcripts, so a missed write is
 * healed by the next one. The prompt, skills and ref ride along on every stop; the server freezes
 * them after the first. No cost is sent — alfred prices the usage.
 */
export function stopBody(args: {
  sessionId: string;
  transcriptPath: string;
  env: Record<string, string | undefined>;
  git: GitRunner;
  tmpDir: string;
}): JsonObject {
  const main = parseJsonl(readFileSync(args.transcriptPath, 'utf8'));
  const subagents = readSubagents(args.transcriptPath);
  const facts = mainFacts(main);
  const mainUsage = usageByModel(main);
  const totals = tokenTotals(mainUsage, subagents.usage);

  const state = readState(args.tmpDir, args.sessionId);
  const repo = state?.repo ?? repoFromRemote(args.git);
  if (repo === null) throw named('RepoUnresolved');

  const warnings = new Set<string>();
  if (state === null) warnings.add('start_unrecorded');
  if (subagents.unreadable) warnings.add('subagents_unreadable');
  if (subagents.partial) warnings.add('subagent_usage_partial');

  // Skills resolve to blobs at the commit the session started on; without it there is no answer.
  const history = new GitHistory(args.git);
  const skills =
    state === null
      ? undefined
      : skillPathsIn(facts.prompt ?? '').map((skill) => ({
          path: skill,
          blob_sha: history.blobAt(state.base_sha, skill),
        }));
  const ref = facts.prompt === null ? null : refOf(facts.prompt);

  return {
    event: 'stop',
    session_id: args.sessionId,
    repo,
    session_created_at: facts.createdAt,
    ...(facts.prompt !== null && { prompt: facts.prompt }),
    ...(facts.prompt !== null && skills !== undefined && { skills }),
    ...(ref !== null && { ref }),
    model: facts.model,
    served_model: facts.servedModel,
    effort_level: facts.effort ?? args.env['CLAUDE_EFFORT'] ?? null,
    ...totals,
    subagent_count: subagents.count,
    usage_by_model: { main: mainUsage, subagents: subagents.usage },
    warnings: sortedBy(warnings, byString),
  };
}
