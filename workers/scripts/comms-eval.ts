/**
 * Run the Comms classifier against the evaluation fixtures and score it.
 *
 * A MANUAL measurement, never part of any check: it makes one real model call per fixture, and no
 * suite in this repo is allowed to spend money or depend on a network. It lives outside `src/` so
 * neither jest nor the Worker's tsconfig picks it up, and its results are gitignored.
 *
 *   npm run eval:comms -w workers
 *   npm run eval:comms -w workers -- --model claude-opus-4-5
 *
 * What it is for: the correction log can only ever show DEMOTIONS — a wrongly-shelved message
 * never becomes a correction, because nothing forces the owner to open the shelf. This is the one
 * instrument that can see a false negative, which is why the headline numbers are queue recall
 * ("did the obligations reach the queue?") and asap precision ("did the loud tier stay earned?")
 * rather than a single accuracy figure that would average the two into meaninglessness.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyJson } from '../src/classifier.ts';
import {
  FIXTURES,
  FIXTURE_NOW,
  FIXTURE_PEOPLE,
  FIXTURE_RUBRIC,
  FIXTURE_TIME_ZONE,
} from '../src/comms/eval/fixtures.ts';
import { type ScoredResult, renderConfusion, scoreRun } from '../src/comms/eval/score.ts';
import { buildCommsRequest } from '../src/comms/prompt.ts';
import type { CommTier } from '../src/comms/types.ts';
import { applyFloor, capForBacklog, parseCommVerdict } from '../src/comms/verdict.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV_VARS = path.join(HERE, '..', '.dev.vars');
const RESULTS_DIR = path.join(HERE, '..', 'eval-results');

/** The model the module ships with. Override to compare a bigger one on the same fixtures. */
const DEFAULT_MODEL = 'claude-haiku-4-5';

/** Read one key out of `.dev.vars`, which is dotenv format: `KEY=value`, `#` comments, blanks. */
function readDevVar(name: string): string | undefined {
  let contents: string;
  try {
    contents = readFileSync(DEV_VARS, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at === -1) continue;
    if (trimmed.slice(0, at).trim() !== name) continue;
    return trimmed
      .slice(at + 1)
      .trim()
      .replaceAll(/^["']|["']$/gu, '');
  }
  return undefined;
}

/** `--model <id>`, else `COMMS_EVAL_MODEL`, else the shipped default. */
function chosenModel(): string {
  const flag = process.argv.indexOf('--model');
  const named = flag === -1 ? undefined : process.argv[flag + 1];
  return named ?? process.env['COMMS_EVAL_MODEL'] ?? DEFAULT_MODEL;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

interface FixtureOutcome {
  id: string;
  about: string;
  expected: { queued: boolean; tier: CommTier };
  actual?: { queued: boolean; tier: CommTier };
  ask?: string;
  reason?: string;
  failure?: string;
}

const apiKey = readDevVar('ANTHROPIC_API_KEY') ?? process.env['ANTHROPIC_API_KEY'];
if (apiKey === undefined || apiKey === '') {
  console.error(
    'No ANTHROPIC_API_KEY in workers/.dev.vars or the environment — nothing to run against.',
  );
  process.exitCode = 1;
} else {
  const model = chosenModel();
  const env = { ANTHROPIC_API_KEY: apiKey, CLASSIFIER_MODEL: model };
  console.log(`Running ${String(FIXTURES.length)} fixtures against ${model}\n`);

  const outcomes: FixtureOutcome[] = [];
  const scored: ScoredResult[] = [];

  // Sequential, one request per fixture — the same shape the sweep uses, and the only way the
  // run stays inside a rate limit without a backoff nobody would maintain.
  for (const fixture of FIXTURES) {
    const request = buildCommsRequest({
      message: fixture.message,
      account: fixture.account,
      rubric: FIXTURE_RUBRIC,
      examples: [],
      people: FIXTURE_PEOPLE,
      timeZone: FIXTURE_TIME_ZONE,
      now: FIXTURE_NOW,
    });

    const outcome = await classifyJson(env, request);
    if ('failed' in outcome) {
      const failure = outcome.failed.reason;
      outcomes.push({ id: fixture.id, about: fixture.about, expected: fixture.expected, failure });
      console.log(`  ERR  ${fixture.id.padEnd(28)} ${failure}`);
      continue;
    }

    const parsed = parseCommVerdict(outcome.ok);
    if (parsed === undefined) {
      outcomes.push({
        id: fixture.id,
        about: fixture.about,
        expected: fixture.expected,
        failure: 'unparseable',
      });
      console.log(`  ERR  ${fixture.id.padEnd(28)} unparseable`);
      continue;
    }

    // The same post-processing the sweep applies, so the score describes what the module would
    // actually have shown rather than what the model said before the floor and the cap.
    const verdict = applyFloor(parsed);
    const tier = capForBacklog(verdict.tier, {
      receivedAt: new Date(fixture.message.received_at),
      now: FIXTURE_NOW,
    });
    const actual = { queued: tier !== 'fyi', tier };

    scored.push({ expected: fixture.expected, actual });
    outcomes.push({
      id: fixture.id,
      about: fixture.about,
      expected: fixture.expected,
      actual,
      ask: verdict.ask,
      reason: verdict.reason,
    });
    const mark = tier === fixture.expected.tier ? 'ok  ' : 'MISS';
    console.log(
      `  ${mark} ${fixture.id.padEnd(28)} expected ${fixture.expected.tier.padEnd(9)} got ${tier.padEnd(9)} ${verdict.ask}`,
    );
  }

  const score = scoreRun(scored);
  const unscored = FIXTURES.length - scored.length;

  // An empty run must not report a perfect one. Every rate is vacuously 1 with no data behind it,
  // and a run where the key was wrong would otherwise print the best numbers in the file.
  if (scored.length === 0) {
    console.error('\nNo fixture produced a usable verdict — nothing to score.');
    process.exitCode = 1;
  }

  console.log(`\nqueue recall     ${percent(score.queueRecall)}   (the number that decides)`);
  console.log(`asap precision   ${percent(score.asapPrecision)}   (the tier that claims "now")`);
  console.log(`queue precision  ${percent(score.queuePrecision)}`);
  console.log(`asap recall      ${percent(score.asapRecall)}`);
  console.log(`tier accuracy    ${percent(score.tierAccuracy)}`);
  if (unscored > 0) console.log(`unscored         ${String(unscored)} (no usable verdict)`);
  console.log(`\n${renderConfusion(score.confusion)}`);

  const at = new Date().toISOString();
  const file = path.join(RESULTS_DIR, `${at.replaceAll(':', '-')}.json`);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ at, model, score, outcomes }, undefined, 2)}\n`, 'utf8');
  console.log(`\nwrote ${file}`);
}
