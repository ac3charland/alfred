import { spyOnFetch } from '../fetch-stub';
import { digestFacts, factsProblem } from './facts';

const WIRE_NULL = JSON.parse('null') as null;
const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };

function valid(): Record<string, unknown> {
  return {
    tasks: [
      {
        id: 't1',
        parent_id: WIRE_NULL,
        title: 'Call the dentist',
        status: 'active',
        priority: 'high',
        due_date: '2026-11-07',
        due_time: '15:00:00',
        created_at: '2026-11-01T00:00:00Z',
      },
    ],
    comms: {
      counts: { asap: 1, today: 0, whenever: 2 },
      asks: [
        {
          tier: 'asap',
          sender: 'Dana',
          account: 'iMessage',
          ask: WIRE_NULL,
          received_at: '2026-11-07T12:00:00Z',
        },
      ],
    },
    reader_waiting: 0,
    plan: WIRE_NULL,
  };
}

describe('factsProblem', () => {
  it('accepts the RPC’s shape, with or without a plan', () => {
    expect(factsProblem(valid())).toBeUndefined();
    expect(
      factsProblem({ ...valid(), plan: { id: 'p', uploaded_at: '2026-11-06', html: '<html>' } }),
    ).toBeUndefined();
  });

  it.each([
    ['not an object', WIRE_NULL, 'not an object'],
    ['tasks missing', { ...valid(), tasks: undefined }, 'bad tasks'],
    [
      'a task with an unknown priority',
      { ...valid(), tasks: [{ ...(valid()['tasks'] as object[])[0], priority: 'urgent' }] },
      'bad tasks',
    ],
    [
      'a negative count',
      { ...valid(), comms: { counts: { asap: -1, today: 0, whenever: 0 }, asks: [] } },
      'bad comms counts',
    ],
    [
      'an FYI ask',
      {
        ...valid(),
        comms: {
          counts: { asap: 0, today: 0, whenever: 0 },
          asks: [{ tier: 'fyi', sender: 'x', account: 'x', ask: 'x', received_at: 'x' }],
        },
      },
      'bad comms asks',
    ],
    ['a fractional reader count', { ...valid(), reader_waiting: 1.5 }, 'bad reader_waiting'],
    ['a plan without html', { ...valid(), plan: { id: 'p', uploaded_at: 'x' } }, 'bad plan'],
  ])('rejects %s', (_what, value, problem) => {
    expect(factsProblem(value)).toBe(problem);
  });
});

describe('digestFacts', () => {
  it('posts the instant and zone to the RPC and returns its answer', async () => {
    const spy = spyOnFetch().mockResolvedValue(Response.json(valid()));
    const now = new Date('2026-11-07T13:00:00Z');

    await expect(digestFacts(env, now, 'America/Chicago')).resolves.toEqual(valid());

    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe('https://proj.supabase.co/rest/v1/rpc/digest_facts');
    expect(JSON.parse(init?.body as string)).toEqual({
      p_now: '2026-11-07T13:00:00.000Z',
      p_zone: 'America/Chicago',
    });
  });

  it('throws on an off-shape answer, naming the problem', async () => {
    spyOnFetch().mockResolvedValue(Response.json({ ...valid(), reader_waiting: '3' }));
    await expect(digestFacts(env, new Date(), 'America/Chicago')).rejects.toThrow(
      'digest_facts answered off-shape: bad reader_waiting',
    );
  });
});
