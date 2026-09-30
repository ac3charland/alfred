#!/usr/bin/env node
/**
 * The summariser's Further reading on the committed link-roundup fixture: the REAL extractor and
 * the REAL `summarizePost` (bundled straight from `workers/src/reader/` by esbuild, imported
 * unmodified), with a `fetch` that plays the Anthropic Messages API in memory.
 *
 *   node docs/demos/alf-289-further-reading/summarise-roundup.mjs
 *
 * It prints what the model is SHOWN — each kept link's [n] marker where it sits in the prose, and
 * the numbered links block — then the stand-in model's answer, which names links only by number
 * (including a number the post doesn't have and a repeat), and finally what the summariser would
 * STORE: each pick mapped to a URL the post really contains, deduped, in link order.
 *
 * STOOD UP LOCALLY: only the model, whose answer is fixed — no judgment is being demonstrated
 * here, only the plumbing that turns numbers into the post's own URLs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = mkdtempSync(path.join(tmpdir(), 'further-reading-'));
await build({
  stdin: {
    contents: [
      "export { summarizePost } from './workers/src/reader/summarize.ts';",
      "export { extractPost } from './workers/src/reader/extract.ts';",
      "export { LINK_ROUNDUP_MESSAGE } from './workers/src/reader/fixtures/index.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(out, 'reader.mjs'),
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'silent',
});
const { summarizePost, extractPost, LINK_ROUNDUP_MESSAGE } = await import(
  pathToFileURL(path.join(out, 'reader.mjs')).href
);
rmSync(out, { recursive: true, force: true });

/** The stand-in model's answer: picks by number only — one the post lacks (42), one repeated (1). */
const ANSWER = {
  headline: 'Mostly last week again, plus one dexterity eval worth the links.',
  gist: 'A roundup that restates last week’s benchmark releases; the new item is a folding eval with a sim-to-real gap.',
  overview: {
    novel_ideas: ['Dexterity evals show a sim-to-real gap scaling the simulator does not close.'],
    evidence: ['Per-task numbers for the folding benchmark.'],
    argument: 'The issue lists the week’s releases and spends its length on the folding result.',
    who_should_read: 'Anyone tracking robotics evals.',
    further_reading: [
      { link: 5, title: 'A sceptic’s reply to “scale the simulator”', note: 'The best case against the author’s own view.' },
      { link: 1, title: 'The sim-to-real gap in dexterous manipulation', note: 'The paper behind the lead item — per-task numbers.' },
      { link: 42, title: 'An invented source', note: 'Not a link in the post.' },
      { link: 1, title: 'The same paper again', note: 'A repeat pick.' },
      { link: 2, title: 'Why most robotics evals don’t transfer', note: 'Argues the suite measures the simulator, not the policy.' },
    ],
  },
};

let userTurn = '';
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'api.anthropic.com') throw new Error(`unexpected fetch ${url.href}`);
  const body = JSON.parse(init.body);
  userTurn = body.messages[0].content;
  return new Response(
    JSON.stringify({
      id: 'msg_demo',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: JSON.stringify(ANSWER) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 400 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

const post = extractPost(LINK_ROUNDUP_MESSAGE, { name: 'Gridwork' });
const outcome = await summarizePost(
  {
    publication: 'Gridwork',
    author: post.author,
    title: post.title,
    receivedAt: post.received_at,
    wordCount: post.word_count,
    text: post.text,
    html: post.html,
    canonicalUrl: post.canonical_url,
  },
  { apiKey: 'sk-ant-demo', model: 'claude-sonnet-5' },
);

console.log('WHAT THE MODEL IS SHOWN');
console.log('  prose lines carrying a link marker:');
const [, afterText = ''] = userTurn.split('--- post text ---\n');
const [text = '', links = ''] = afterText.split('\n\n--- links ---\n');
for (const line of text.split('\n').filter((l) => /\[\d+]/.test(l))) console.log(`    ${line}`);
console.log('  links block:');
for (const line of links.split('\n')) console.log(`    ${line}`);

console.log('\nWHAT THE MODEL ANSWERS (further_reading)');
for (const pick of ANSWER.overview.further_reading) {
  console.log(`  link ${String(pick.link).padStart(2)}  ${pick.title}`);
}

console.log(`\nWHAT IS STORED (outcome: ${outcome.kind})`);
for (const item of outcome.summary.overview.further_reading) {
  console.log(`  ${item.url}`);
  console.log(`    ${item.title} — ${item.note}`);
}
