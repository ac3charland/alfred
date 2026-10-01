#!/usr/bin/env node
/**
 * `npm run eval:reader -w workers -- --fixtures` against a stand-in model, printing only the link
 * roundup: what the model was shown (its numbered links block) and what the summariser stored.
 * The eval script and the summariser run unmodified; `ANTHROPIC_BASE_URL` points the SDK here.
 *
 * The stand-in answers the roundup with four picks written the way a model could get them wrong —
 * link 5, link 1, a number the post never had (42), and link 1 again — so the stored list shows
 * normalisation doing its job: URLs only from the post, each once, in link order.
 *
 *   node docs/demos/alf-289-further-reading/roundup-with-stand-in.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ROUNDUP = 'Import Notes 412: three new evals, and a robot that folds';
let shown = '';

const PICKS = [
  { link: 5, title: 'A sceptic’s reply to “scale the simulator”', note: 'The best case against the view the author holds.' },
  { link: 1, title: 'The sim-to-real gap in dexterous manipulation', note: 'The paper behind the lead item.' },
  { link: 42, title: 'An invented source', note: 'A number the post never had.' },
  { link: 1, title: 'The gap paper, again', note: 'A repeat of link 1.' },
];

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const user = JSON.parse(raw).messages[0].content;
    const title = /Title: (.*)/.exec(user)?.[1];
    if (title === ROUNDUP) {
      const [text, links] = user.split('\n\n--- links ---\n');
      const marked = text.split('\n').filter((line) => /\[\d+]/.test(line));
      shown = [...marked, '', '--- links ---', links].join('\n');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_demo',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 300 },
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              headline: 'A roundup worth its links more than itself.',
              gist: 'Mostly restates last week; one new dexterity eval.',
              overview: {
                novel_ideas: [],
                evidence: [],
                argument: 'The issue lists the week’s evals.',
                who_should_read: 'Robotics readers, for the links.',
                further_reading: title === ROUNDUP ? PICKS : [],
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
const stdout = await new Promise((resolve) => {
  const child = spawn('npm', ['run', '--silent', 'eval:reader', '-w', 'workers', '--', '--fixtures'], {
    cwd: ROOT,
    env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-demo', ANTHROPIC_BASE_URL: origin },
  });
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.on('close', () => resolve(out));
});
server.close();

console.log('what the model was shown: the text lines that carry a link marker, then the links block');
console.log(shown.replace(/^/gm, '  '));
console.log('');
console.log('what the eval printed for it:');
const block = stdout.split('\n\n').find((part) => part.startsWith('link-roundup'));
console.log(block ?? '(no link-roundup block)');
