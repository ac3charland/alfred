import {
  mainFacts,
  mergeUsage,
  parseJsonl,
  promptOf,
  tokenTotals,
  usageByModel,
} from './transcript.ts';

const usage = (extra: Record<string, unknown> = {}) => ({
  input_tokens: 10,
  output_tokens: 20,
  cache_read_input_tokens: 30,
  cache_creation_input_tokens: 40,
  ...extra,
});

function assistant(id: string, model: string, usageBlock: unknown, extra: object = {}) {
  return { type: 'assistant', message: { id, model, usage: usageBlock }, ...extra };
}

describe('parseJsonl', () => {
  it('skips a partly written line and anything that is not an object', () => {
    const text = ['{"a":1}', '', '[1]', '7', '{"b":', '{"c":3}', '{"d":'].join('\n');
    expect(parseJsonl(text)).toEqual([{ a: 1 }, { c: 3 }]);
  });
});

function noId(requestId?: string) {
  return {
    type: 'assistant',
    ...(requestId === undefined ? {} : { requestId }),
    message: { model: 'opus', usage: usage() },
  };
}

function user(content: unknown, extra: object = {}) {
  return { type: 'user', message: { role: 'user', content }, ...extra };
}

describe('usageByModel', () => {
  it('keeps one usage per message id, the last seen, and counts the id once', () => {
    const entries = [
      assistant('m1', 'opus', usage({ output_tokens: 5 })),
      assistant('m1', 'opus', usage({ output_tokens: 20 })),
      assistant('m1', 'opus', usage({ output_tokens: 20 })),
      assistant('m2', 'opus', usage()),
    ];
    expect(usageByModel(entries)['opus']).toMatchObject({ requests: 2, input: 20, output: 40 });
  });

  it('splits cache writes by lifetime when the transcript does, else counts them all as 5-minute', () => {
    const split = usage({
      cache_creation: { ephemeral_5m_input_tokens: 15, ephemeral_1h_input_tokens: 25 },
    });
    expect(usageByModel([assistant('m1', 'opus', split)])['opus']).toMatchObject({
      cache_write_5m: 15,
      cache_write_1h: 25,
    });
    expect(usageByModel([assistant('m1', 'opus', usage())])['opus']).toMatchObject({
      cache_write_5m: 40,
      cache_write_1h: 0,
    });
  });

  it('counts web searches and tallies each model on its own', () => {
    const entries = [
      assistant('m1', 'opus', usage({ server_tool_use: { web_search_requests: 3 } })),
      assistant('m2', 'haiku', usage()),
    ];
    const tally = usageByModel(entries);
    expect(Object.keys(tally)).toEqual(['opus', 'haiku']);
    expect(tally['opus']?.web_search).toBe(3);
    expect(tally['haiku']?.web_search).toBe(0);
  });

  it('degrades on entries it does not recognise instead of throwing', () => {
    const entries = [
      { type: 'assistant' },
      { type: 'assistant', message: 'nope' },
      assistant('m1', 'opus', 'not usage'),
      assistant('m2', '<synthetic>', usage()),
      { type: 'assistant', message: { id: 'm3', usage: usage() } },
      { type: 'user', message: { id: 'm4', model: 'opus', usage: usage() } },
      assistant('m5', 'opus', { input_tokens: 'many', output_tokens: null }),
    ];
    expect(usageByModel(entries)).toEqual({
      opus: {
        requests: 1,
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write_5m: 0,
        cache_write_1h: 0,
        web_search: 0,
      },
    });
  });

  it('falls back to the request id, then the line, when a message has no id', () => {
    expect(usageByModel([noId('r1'), noId('r1'), noId('r2')])['opus']?.requests).toBe(2);
    expect(usageByModel([noId(), noId()])['opus']?.requests).toBe(2);
  });
});

describe('mergeUsage / tokenTotals', () => {
  it('adds tallies model by model and totals every token class, cache writes of both lifetimes', () => {
    const a = usageByModel([assistant('m1', 'opus', usage())]);
    const b = usageByModel([assistant('m2', 'opus', usage()), assistant('m3', 'haiku', usage())]);
    const merged = mergeUsage(a, b);
    expect(merged['opus']).toMatchObject({ requests: 2, input: 20 });
    expect(merged['haiku']).toMatchObject({ requests: 1, input: 10 });
    expect(tokenTotals(a, b)).toEqual({
      input_tokens: 30,
      output_tokens: 60,
      cache_read_tokens: 90,
      cache_write_tokens: 120,
    });
  });
});

describe('promptOf', () => {
  it('is a string message verbatim', () => {
    expect(promptOf([user('  ALF-1: do it\n\nthen this  ')])).toBe('  ALF-1: do it\n\nthen this  ');
  });

  it('joins text blocks with a newline', () => {
    const blocks = [
      { type: 'text', text: 'first' },
      { type: 'image', source: {} },
      { type: 'text', text: 'second' },
    ];
    expect(promptOf([user(blocks)])).toBe('first\nsecond');
  });

  it('skips meta entries, tool results and sidechains, and non-user entries', () => {
    const entries = [
      user('caveat', { isMeta: true }),
      { type: 'assistant', message: { content: 'not a prompt' } },
      user([{ type: 'tool_result', tool_use_id: 't', content: 'out' }]),
      user([
        { type: 'text', text: 'mixed' },
        { type: 'tool_result', content: 'out' },
      ]),
      user('subagent brief', { isSidechain: true }),
      user(''),
      user([{ type: 'image' }]),
      user('the prompt'),
      user('a later message'),
    ];
    expect(promptOf(entries)).toBe('the prompt');
  });

  it('is null when there is none', () => {
    expect(promptOf([])).toBeNull();
    expect(promptOf([user(7)])).toBeNull();
  });
});

describe('mainFacts', () => {
  it('reads first and last model, the last effort and the first timestamp from the main thread', () => {
    const entries = [
      { type: 'file-history-snapshot' },
      { type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: { content: 'hi' } },
      assistant('m1', 'opus', usage(), { effort: 'low', timestamp: '2026-01-01T00:00:05.000Z' }),
      assistant('m2', 'sonnet', usage(), { effort: 'high' }),
      assistant('m3', 'haiku', usage(), { isSidechain: true, effort: 'max' }),
      assistant('m4', '<synthetic>', usage()),
    ];
    expect(mainFacts(entries)).toEqual({
      model: 'opus',
      servedModel: 'sonnet',
      effort: 'high',
      createdAt: '2026-01-01T00:00:00.000Z',
      prompt: 'hi',
    });
  });

  it('is all nulls for an empty or unrecognisable transcript', () => {
    const empty = { model: null, servedModel: null, effort: null, createdAt: null, prompt: null };
    expect(mainFacts([])).toEqual(empty);
    expect(mainFacts([{ foo: 'bar' }, { message: 7 }])).toEqual(empty);
  });
});
