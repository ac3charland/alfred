/**
 * Run the Reader's extractor and summariser over real mail — or over the committed fixtures.
 *
 * A MANUAL instrument, never part of any check: outside `--dry-run` it makes one real model call
 * per post, and no suite in this repo is allowed to spend money or depend on a network. It lives
 * outside `src/` so neither jest nor the Worker's tsconfig picks it up, and its results are
 * gitignored.
 *
 *   npm run eval:reader -w workers -- --query "from:substack.com newer_than:14d" --limit 5
 *   npm run eval:reader -w workers -- --ids 18f3a…,18f3b…
 *   npm run eval:reader -w workers -- --fixtures            # replay the committed set, still billed
 *   npm run eval:reader -w workers -- --fixtures --dry-run  # extraction only: no key, no bill, no file
 *   npm run eval:reader -w workers -- --query … --model claude-opus-5
 *
 * Two modes matter for different reasons. Against the MAILBOX it is the only way to see the
 * extractor meet templates nobody hand-built — the checkpoint asks the owner for five real posts,
 * and this makes that a one-line command instead of an export chore. Against the FIXTURES with
 * `--dry-run` it is a pure function: no key, no network, no clock, no ids, stable ordering, so its
 * stdout is stable enough to be the demo doc's Worker-side evidence under `showboat verify`.
 * Anything non-deterministic printed in that mode is a bug in this file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { headerValue, parseAddress } from '../src/comms/email-text.ts';
import { type GmailMessage, gmailClient } from '../src/comms/gmail-api.ts';
import { fetchAccessToken } from '../src/comms/gmail-oauth.ts';
import { type ExtractedPost, extractPost } from '../src/reader/extract.ts';
import { READER_FIXTURES } from '../src/reader/fixtures/index.ts';
import { summarizePost } from '../src/reader/summarize.ts';
import type { SummaryInput, SummaryOutcome } from '../src/reader/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV_VARS = path.join(HERE, '..', '.dev.vars');
const RESULTS_DIR = path.join(HERE, '..', 'eval-results');

/** The model `wrangler.toml` ships as `READER_MODEL`. Override with `--model` to compare another. */
const DEFAULT_MODEL = 'claude-sonnet-5';

/** How many mailbox messages a run reads when `--limit` is not given. */
const DEFAULT_LIMIT = 5;

/**
 * List prices in dollars per MILLION tokens, keyed by model-id prefix and matched longest-first.
 *
 * A prefix rather than an exact id so a pinned snapshot (`claude-haiku-4-5-20251001`) prices the
 * same as its alias. An unrecognised model prints "unknown price" rather than a confident zero —
 * a cost line that silently reads $0.0000 for a model nobody priced is worse than no cost line.
 */
const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: 'claude-opus-5', input: 5, output: 25 },
  { prefix: 'claude-sonnet-5', input: 2, output: 10 },
  { prefix: 'claude-haiku-4-5', input: 1, output: 5 },
];

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

/** `.dev.vars` first, then the environment — the same precedence `eval:comms` uses. */
function credential(name: string): string {
  return readDevVar(name) ?? process.env[name] ?? '';
}

/** Every flag this script knows, so a value can be told from the next flag by name. */
const FLAGS = new Set(['--query', '--limit', '--ids', '--fixtures', '--dry-run', '--model']);

/**
 * The value after a flag, or undefined when the flag is absent, trailing, or followed by one of
 * this script's OWN flags: `--ids --dry-run` asks for no ids, not for an id called `--dry-run`.
 * Swallowing the next flag would otherwise turn a typo into a run that quietly reads the whole
 * mailbox.
 *
 * Anything else is a value, however it is spelled. A leading `-` is not the test: `-from:x` is a
 * legitimate Gmail negation, and `--limit -1` has to REACH the positive-integer check rather than
 * read as a missing limit and fall back to the default.
 */
function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  if (at === -1) return undefined;
  const value = process.argv[at + 1];
  return value === undefined || FLAGS.has(value) ? undefined : value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

/** True when a value-taking flag was given but its value is absent or shaped like another flag. */
function missingValue(name: string): boolean {
  return hasFlag(name) && flagValue(name) === undefined;
}

/** `--model <id>`, else `READER_MODEL` from `.dev.vars` or the environment, else the shipped default. */
function chosenModel(): string {
  const flag = flagValue('--model') ?? '';
  if (flag !== '') return flag;
  const configured = credential('READER_MODEL');
  return configured === '' ? DEFAULT_MODEL : configured;
}

/** What one run was asked to do. */
interface Options {
  fixtures: boolean;
  dryRun: boolean;
  model: string;
  query?: string;
  ids: string[];
  limit: number;
}

/** A positive integer written in decimal digits and nothing else — as `config.ts` parses the cap. */
const POSITIVE_INTEGER = /^\d+$/;

/**
 * The options, or `undefined` — after printing why — when a flag was given a value the run must
 * not guess at.
 */
function readOptions(): Options | undefined {
  const rawLimit = flagValue('--limit');
  // A silent fallback to the default here reads a different mailbox slice than the one asked
  // for, and on a billed run that is real money spent on the wrong posts.
  if (
    rawLimit !== undefined &&
    (!POSITIVE_INTEGER.test(rawLimit) || Number.parseInt(rawLimit, 10) < 1)
  ) {
    console.error('--limit takes a positive integer, e.g. --limit 5.');
    return undefined;
  }
  // A trailing or flag-shaped value here would otherwise read as the flag being simply absent —
  // silently running the wrong query, ids or model instead of refusing the run.
  if (missingValue('--query') || missingValue('--ids') || missingValue('--model')) {
    console.error('--query, --ids and --model each take a value.');
    return undefined;
  }
  const ids = (flagValue('--ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number.parseInt(rawLimit, 10);
  const query = flagValue('--query');
  return {
    fixtures: hasFlag('--fixtures'),
    dryRun: hasFlag('--dry-run'),
    model: chosenModel(),
    ...(query === undefined ? {} : { query }),
    ids,
    limit,
  };
}

/** One post to run, named by whatever identifies it in this mode. */
interface Candidate {
  label: string;
  message: GmailMessage;
}

/**
 * The publication name for a message read outside the tick.
 *
 * The tick gets this from the roster row; a script pointed at an arbitrary mailbox has no roster,
 * so it reads the `From` display name and falls back to the address's local part. That is exactly
 * what discovery would seed the roster with, so the extractor sees the same input either way.
 */
function publicationName(message: GmailMessage): string {
  const from = parseAddress(headerValue(message.payload?.headers, 'From'));
  if (from === undefined) return 'unknown';
  return from.name ?? from.handle.split('@', 1)[0] ?? from.handle;
}

/** `ExtractedPost` as the summariser's seam wants it. */
function toSummaryInput(post: ExtractedPost, publication: string): SummaryInput {
  return {
    publication,
    ...(post.author === undefined ? {} : { author: post.author }),
    title: post.title,
    receivedAt: post.received_at,
    wordCount: post.word_count,
    text: post.text,
  };
}

function pad(label: string): string {
  return label.padEnd(15);
}

/** The extraction block — the whole of a `--dry-run`, and the header of a billed post. */
function printExtraction(label: string, publication: string, post: ExtractedPost): void {
  console.log(label);
  console.log(`  ${pad('publication')}${publication}`);
  console.log(`  ${pad('title')}${post.title}`);
  console.log(`  ${pad('author')}${post.author ?? '(none)'}`);
  console.log(`  ${pad('canonical URL')}${post.canonical_url ?? 'none → mailbox'}`);
  console.log(`  ${pad('word count')}${String(post.word_count)}`);
  console.log(`  ${pad('html_extracted')}${String(post.html_extracted)}`);
}

/** The dollars one call cost at list price, or undefined for a model this file has no price for. */
function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const price = PRICES.find((entry) => model.startsWith(entry.prefix));
  if (price === undefined) return undefined;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** Everything a billed run prints below the extraction block. */
function printSummary(model: string, outcome: SummaryOutcome): void {
  switch (outcome.kind) {
    case 'done': {
      const { headline, gist, overview } = outcome.summary;
      console.log(`  ${pad('headline')}${headline}`);
      console.log(`  ${pad('gist')}${gist}`);
      console.log('  novel ideas');
      for (const bullet of overview.novel_ideas) console.log(`    - ${bullet}`);
      if (overview.novel_ideas.length === 0) console.log('    (none — a restatement)');
      console.log('  evidence');
      for (const bullet of overview.evidence) console.log(`    - ${bullet}`);
      if (overview.evidence.length === 0) console.log('    (none)');
      console.log(`  ${pad('argument')}${overview.argument}`);
      console.log(`  ${pad('who should read')}${overview.who_should_read}`);

      break;
    }
    case 'refused': {
      console.log(`  ${pad('OUTCOME')}refused`);

      break;
    }
    case 'systemic': {
      console.log(`  ${pad('OUTCOME')}systemic ${outcome.reason}: ${outcome.error}`);

      break;
    }
    default: {
      console.log(`  ${pad('OUTCOME')}${outcome.kind}: ${outcome.error}`);
    }
  }

  const usage = 'usage' in outcome ? outcome.usage : undefined;
  if (usage === undefined) {
    console.log(`  ${pad('usage')}(none reported)`);
    return;
  }
  const cost = estimateCost(model, usage.inputTokens, usage.outputTokens);
  const priced = cost === undefined ? 'unknown price' : `$${cost.toFixed(4)}`;
  console.log(
    `  ${pad('usage')}in ${String(usage.inputTokens)} · out ${String(usage.outputTokens)} · ${priced}`,
  );
}

/** Mint a token and pull the requested messages out of the personal mailbox. */
async function mailboxCandidates(options: Options): Promise<Candidate[] | undefined> {
  const clientId = credential('GMAIL_OAUTH_CLIENT_ID');
  const clientSecret = credential('GMAIL_OAUTH_CLIENT_SECRET');
  const refreshToken = credential('GMAIL_PERSONAL_REFRESH_TOKEN');
  const missing = [
    clientId === '' ? 'GMAIL_OAUTH_CLIENT_ID' : '',
    clientSecret === '' ? 'GMAIL_OAUTH_CLIENT_SECRET' : '',
    refreshToken === '' ? 'GMAIL_PERSONAL_REFRESH_TOKEN' : '',
  ].filter((name) => name !== '');
  if (missing.length > 0) {
    console.error(
      `Missing ${missing.join(', ')} in workers/.dev.vars or the environment — cannot read the mailbox.`,
    );
    console.error('Use --fixtures to replay the committed set without a Gmail credential.');
    return undefined;
  }

  const token = await fetchAccessToken(
    { GMAIL_OAUTH_CLIENT_ID: clientId, GMAIL_OAUTH_CLIENT_SECRET: clientSecret },
    refreshToken,
  );
  if (!token.ok) {
    console.error(`Could not mint an access token (${token.reason}): ${token.detail}`);
    return undefined;
  }

  const gmail = gmailClient(token.token);
  let ids = options.ids;
  if (ids.length === 0) {
    const listed = await gmail.listMessageIds({ q: options.query });
    if (!listed.ok) {
      console.error(`messages.list failed (${listed.reason}): ${listed.detail}`);
      return undefined;
    }
    ids = listed.value.ids.slice(0, options.limit);
    console.log(`${String(listed.value.ids.length)} matched; reading ${String(ids.length)}\n`);
  }

  const candidates: Candidate[] = [];
  for (const id of ids) {
    const fetched = await gmail.getMessage(id);
    if (!fetched.ok) {
      console.error(`messages.get ${id} failed (${fetched.reason}): ${fetched.detail}`);
      continue;
    }
    candidates.push({ label: id, message: fetched.value });
  }
  return candidates;
}

/** One post's row in the results file. */
interface ResultRow {
  label: string;
  publication: string;
  extraction: {
    title: string;
    author?: string | undefined;
    canonical_url?: string | undefined;
    word_count: number;
    html_extracted: boolean;
  };
  outcome?: SummaryOutcome;
  costUsd?: number | undefined;
}

async function main(): Promise<void> {
  const options = readOptions();
  if (options === undefined) {
    // readOptions() already named the offending flag.
    process.exitCode = 1;
    return;
  }

  if (!options.fixtures && options.ids.length === 0 && options.query === undefined) {
    console.error('Nothing to read. Pass --fixtures, or --query "<gmail search>", or --ids a,b,c.');
    process.exitCode = 1;
    return;
  }

  // The key is read BEFORE anything else happens on a billed run, so a missing one costs a Gmail
  // read of nothing rather than being discovered post by post.
  const apiKey = options.dryRun ? '' : credential('ANTHROPIC_API_KEY');
  if (!options.dryRun && apiKey === '') {
    console.error('No ANTHROPIC_API_KEY in workers/.dev.vars or the environment.');
    console.error('Add one, or pass --dry-run to stop after extraction.');
    process.exitCode = 1;
    return;
  }

  let candidates: Candidate[] | undefined;
  if (options.fixtures) {
    // Deliberately the ONLY header line in fixtures mode, and free of anything that varies:
    // this stdout is diffed by the demo's `verify`.
    console.log(
      `reader eval — ${String(READER_FIXTURES.length)} fixtures${options.dryRun ? ', extraction only' : `, model ${options.model}`}\n`,
    );
    candidates = READER_FIXTURES.map((fixture) => ({
      label: fixture.name,
      message: fixture.message,
    }));
  } else {
    console.log(
      `reader eval — mailbox${options.dryRun ? ', extraction only' : `, model ${options.model}`}`,
    );
    candidates = await mailboxCandidates(options);
  }
  if (candidates === undefined) {
    process.exitCode = 1;
    return;
  }

  const rows: ResultRow[] = [];
  for (const candidate of candidates) {
    const publication = publicationName(candidate.message);
    const post = extractPost(candidate.message, { name: publication });
    printExtraction(candidate.label, publication, post);

    const row: ResultRow = {
      label: candidate.label,
      publication,
      extraction: {
        title: post.title,
        author: post.author,
        canonical_url: post.canonical_url,
        word_count: post.word_count,
        html_extracted: post.html_extracted,
      },
    };

    if (!options.dryRun) {
      if (post.text === '') {
        console.log(`  ${pad('OUTCOME')}skipped — no readable body`);
      } else {
        const outcome = await summarizePost(toSummaryInput(post, publication), {
          apiKey,
          model: options.model,
        });
        printSummary(options.model, outcome);
        row.outcome = outcome;
        const usage = 'usage' in outcome ? outcome.usage : undefined;
        row.costUsd =
          usage === undefined
            ? undefined
            : estimateCost(options.model, usage.inputTokens, usage.outputTokens);
      }
    }

    rows.push(row);
    console.log('');
  }

  // `--dry-run` writes nothing and prints no path: the file's name is a timestamp, which would be
  // the one non-deterministic line in the output the demo diffs.
  if (options.dryRun) return;

  const at = new Date().toISOString();
  const file = path.join(RESULTS_DIR, `${at.replaceAll(':', '-')}.json`);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ at, model: options.model, rows }, undefined, 2)}\n`,
    'utf8',
  );
  console.log(`wrote ${file}`);
}

await main();
