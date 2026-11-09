/**
 * What the Worker's three model calls put on the wire, with the model ids `wrangler.toml` ships.
 * The real `classifyJson` (Inbox and Comms classifier), `summarizePost` (Reader) and `writeOpener`
 * (morning digest) run unmodified; the SDK's own `ANTHROPIC_BASE_URL` points them at a stand-in
 * in this process, which records each request body and answers `{}`. A last call shows the Reader
 * var rolled back to Sonnet 5 with no code change.
 *
 *   node --import ./workers/scripts/ts-resolve.mjs docs/demos/alf-340-haiku-sonnet-5-5/wire-requests.mts
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyJson } from '../../../workers/src/classifier.ts';
import { writeOpener } from '../../../workers/src/digest/opener.ts';
import { summarizePost } from '../../../workers/src/reader/summarize.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const toml = readFileSync(path.join(ROOT, 'workers/wrangler.toml'), 'utf8');
const shipped = (name: string): string =>
  new RegExp(`^${name} = "([^"]+)"$`, 'm').exec(toml)?.[1] ?? '';

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
  req.on('end', () => {
    const body = JSON.parse(raw) as {
      model: string;
      max_tokens: number;
      thinking?: unknown;
      output_config?: { effort?: string };
    };
    console.log(
      JSON.stringify({
        model: body.model,
        max_tokens: body.max_tokens,
        thinking: body.thinking ?? '(omitted)',
        effort: body.output_config?.effort ?? '(omitted)',
      }),
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_demo',
        type: 'message',
        role: 'assistant',
        model: body.model,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: '{}' }],
      }),
    );
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address !== null ? address.port : 0;
process.env['ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${String(port)}`;

const apiKey = 'sk-ant-demo';
const post = {
  kind: 'essay' as const,
  publication: 'Demo Weekly',
  title: 'A post',
  receivedAt: '2026-10-09T12:00:00Z',
  wordCount: 3,
  text: 'Three short words.',
};

console.log(
  `wrangler.toml: CLASSIFIER_MODEL=${shipped('CLASSIFIER_MODEL')} ` +
    `READER_MODEL=${shipped('READER_MODEL')} DIGEST_MODEL=${shipped('DIGEST_MODEL')}`,
);
process.stdout.write('classifier  ');
await classifyJson(
  { ANTHROPIC_API_KEY: apiKey, CLASSIFIER_MODEL: shipped('CLASSIFIER_MODEL') },
  { system: 'Classify.', user: 'title: buy milk', schema: { type: 'object' } },
);
process.stdout.write('reader      ');
await summarizePost(post, { apiKey, model: shipped('READER_MODEL') });
process.stdout.write('digest      ');
await writeOpener(
  { ANTHROPIC_API_KEY: apiKey, DIGEST_MODEL: shipped('DIGEST_MODEL') },
  {
    date: 'Monday, Nov 9',
    plan: null,
    due: [],
    due_overflow: 0,
    comms: { counts: { asap: 0, today: 0, whenever: 0 }, asks: [] },
    reader_waiting: 0,
  },
);
process.stdout.write('reader (READER_MODEL rolled back to claude-sonnet-5)  ');
await summarizePost(post, { apiKey, model: 'claude-sonnet-5' });
server.close();
