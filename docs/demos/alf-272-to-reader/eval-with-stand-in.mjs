#!/usr/bin/env node
/**
 * `npm run eval:reader -w workers -- --instapaper` against a stand-in Instapaper and a stand-in
 * model, so the demo can show what the owner's first live run prints — and that it never
 * archives anything. The eval script runs unmodified: `INSTAPAPER_API_URL` and the Anthropic
 * SDK's own `ANTHROPIC_BASE_URL` point it at this process, which records every call it gets.
 *
 *   node docs/demos/alf-272-to-reader/eval-with-stand-in.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const calls = [];

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const json = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/v1/messages') {
      const title = /Title: (.*)/.exec(JSON.parse(raw).messages[0].content)?.[1];
      calls.push(`model  summarise "${title}"`);
      json({
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
              headline: 'Quieter downtowns are emptier downtowns.',
              gist: 'Street noise tracks lost foot traffic, not new ordinances; the sensor data is the new part.',
              overview: {
                novel_ideas: ['Noise sensors as a proxy for foot traffic.'],
                evidence: ['Six downtowns, 2019–2026.'],
                argument: 'The quiet is a symptom of fewer people.',
                who_should_read: 'Anyone who works on downtown recovery.',
                further_reading: [],
              },
            }),
          },
        ],
      });
      return;
    }
    const call = req.url.replace(/^\/api\/1(\.1)?\//, '');
    const form = Object.fromEntries(new URLSearchParams(raw));
    calls.push(`Instapaper ${call}${form.bookmark_id ? ` #${form.bookmark_id}` : ''}`);
    if (call === 'folders/list') return json([{ type: 'folder', folder_id: 77, title: 'To Reader' }]);
    if (call === 'bookmarks/list') {
      return json({
        bookmarks: [
          { type: 'bookmark', bookmark_id: 501, url: 'https://worksinprogress.co/issue/quiet-cities', title: 'Cities Are Getting Quieter', time: 100 },
          { type: 'bookmark', bookmark_id: 502, url: 'https://example.org/later', title: 'Saved later', time: 200 },
        ],
        highlights: [],
      });
    }
    if (call === 'bookmarks/get_text') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Cities Are Getting Quieter</h1><p>Street noise fell in six downtowns as foot traffic did.</p>');
      return;
    }
    json([{ type: 'error', error_code: 1500 }], 400);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${String(server.address().port)}`;

// Async, not spawnSync: the stand-ins answer from this same process's event loop.
const run = await new Promise((resolve) => {
  const child = spawn(
    'npm',
    ['run', '--silent', 'eval:reader', '-w', 'workers', '--', '--instapaper', '--limit', '1'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        INSTAPAPER_CONSUMER_KEY: 'ck',
        INSTAPAPER_CONSUMER_SECRET: 'cs',
        INSTAPAPER_ACCESS_TOKEN: 'tk',
        INSTAPAPER_ACCESS_TOKEN_SECRET: 'ts',
        INSTAPAPER_API_URL: origin,
        ANTHROPIC_API_KEY: 'sk-ant-demo',
        ANTHROPIC_BASE_URL: origin,
      },
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('close', () => resolve({ stdout, stderr }));
});
server.close();

process.stdout.write(run.stdout);
if (run.stderr.trim() !== '') process.stdout.write(`stderr: ${run.stderr}`);
console.log(`every call the stand-ins received (${String(calls.length)}):`);
for (const call of calls) console.log(`  ${call}`);
