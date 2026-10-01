#!/usr/bin/env node
/**
 * The summariser's request and its stored answer for the committed roundup fixture, with a
 * stand-in model: the REAL eval script (`npm run eval:reader -w workers -- --fixtures`) and the
 * real summariser, prompt and normalisation, pointed at a local server that plays the Anthropic
 * Messages API. The stand-in records what the model was SHOWN for the roundup — the post text with
 * its `[n]` markers and the numbered links block — and answers every post with the same picks:
 * link 2 twice, link 1, a link 99 the post never offered, and link 7, in that order. What the eval
 * then prints as "further reading" is what the row would store: URLs from the post, deduped, in
 * link order, the invented number gone.
 *
 *   node docs/demos/alf-289-further-reading/summariser-stand-in.mjs
 *
 * Output is deterministic: the fixtures are committed, the stand-in's usage is fixed, and the
 * results file's timestamped name is masked.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let roundupInput;

const PICKS = [
  { link: 2, title: 'A barrage of benchmark releases, sorted', note: 'The roundup’s lead item; the post calls it the one worth reading in full.' },
  { link: 2, title: 'The same link again', note: 'A repeat: the model named link 2 twice.' },
  { link: 1, title: 'The quiet berth, revisited', note: 'The essay the opening paragraph argues with.' },
  { link: 99, title: 'A link that does not exist', note: 'The model invented number 99.' },
  { link: 7, title: 'A sponsor-adjacent explainer', note: 'The post leans on it for its closing numbers.' },
];

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    if (req.url !== '/v1/messages') {
      res.writeHead(404);
      res.end();
      return;
    }
    const user = JSON.parse(raw).messages[0].content;
    if (/Title: Slow Links, Fast Takes/.test(user)) roundupInput = user;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_demo',
        type: 'message',
        role: 'assistant',
        model: 'stand-in',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 300 },
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              headline: 'A link roundup with one item worth the click.',
              gist: 'Mostly restated releases; the lead link is the substance.',
              overview: {
                novel_ideas: [],
                evidence: [],
                argument: 'Eight links, one argument.',
                who_should_read: 'Nobody needs the issue; one link is worth it.',
                further_reading: PICKS,
              },
            }),
          },
        ],
      }),
    );
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${String(server.address().port)}`;

// Async, not spawnSync: the stand-in answers from this same process's event loop.
const run = await new Promise((resolve) => {
  const child = spawn('npm', ['run', '--silent', 'eval:reader', '-w', 'workers', '--', '--fixtures'], {
    cwd: ROOT,
    env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-demo', ANTHROPIC_BASE_URL: origin },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('close', () => resolve({ stdout, stderr }));
});
server.close();

// What the model was shown for the roundup: the lines of the post text that carry a marker, and
// the links block in full.
console.log('── the model’s input for the roundup fixture ──');
if (roundupInput === undefined) {
  console.log('(the stand-in never saw the roundup — see stderr below)');
} else {
  const [text, links] = roundupInput.split('\n--- links ---\n');
  for (const line of text.split('\n')) if (/\[\d+\]/.test(line)) console.log(`  ${line}`);
  console.log('  --- links ---');
  for (const line of links.split('\n')) console.log(`  ${line}`);
}
console.log();
console.log('── the stand-in’s picks, as the model would send them ──');
for (const pick of PICKS) console.log(`  { link: ${String(pick.link)} } ${pick.title}`);
console.log();
console.log('── what the eval prints for the roundup: the picks normalised into the stored list ──');
const section = /^roundup\n[\S\s]*?(?=\n\n|\nwrote )/m.exec(run.stdout)?.[0] ?? '(no roundup section)';
console.log(section.replaceAll(/\n {2}(publication|title|author|canonical URL|word count|html_extracted) .*/g, ''));
console.log();
console.log(run.stdout.replace(/wrote .*\.json/, 'wrote workers/eval-results/<timestamp>.json').split('\n').filter((line) => line.startsWith('wrote ')).join('\n'));
if (run.stderr.trim() !== '') console.log(`stderr: ${run.stderr}`);
