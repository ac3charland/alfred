import { spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import { fetchMessageIdsBySourceIds } from './gmail-store';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

describe('fetchMessageIdsBySourceIds', () => {
  it('maps the source ids that were stored to their row ids', async () => {
    const urls: string[] = [];
    spyOnFetch().mockImplementation((input) => {
      urls.push(input as string);
      return Promise.resolve(Response.json([{ id: 'row-1', source_id: 'm1' }]));
    });

    await expect(fetchMessageIdsBySourceIds(env, 'account-1', ['m1', 'm2'])).resolves.toEqual(
      new Map([['m1', 'row-1']]),
    );

    const params = new URL(urls[0] ?? '').searchParams;
    expect(params.get('account_id')).toBe('eq.account-1');
    expect(params.get('source_id')).toBe('in.("m1","m2")');
    expect(params.get('select')).toBe('id,source_id');
  });

  it('asks nothing of the database when there is nothing to look up', async () => {
    const fetchStub = spyOnFetch();

    await expect(fetchMessageIdsBySourceIds(env, 'account-1', [])).resolves.toEqual(new Map());
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('escapes a double quote inside a source id rather than letting it break out of the list literal', async () => {
    const urls: string[] = [];
    spyOnFetch().mockImplementation((input) => {
      urls.push(input as string);
      return Promise.resolve(Response.json([]));
    });

    await fetchMessageIdsBySourceIds(env, 'account-1', ['weird"id']);

    const params = new URL(urls[0] ?? '').searchParams;
    // PostgREST's list-literal escape is `\"` — an unescaped quote would end the element early
    // and corrupt the filter (either a syntax error or an unintended extra list literal).
    expect(params.get('source_id')).toBe(String.raw`in.("weird\"id")`);
  });

  it('escapes a backslash inside a source id so it is not read as the start of an escape', async () => {
    const urls: string[] = [];
    spyOnFetch().mockImplementation((input) => {
      urls.push(input as string);
      return Promise.resolve(Response.json([]));
    });

    await fetchMessageIdsBySourceIds(env, 'account-1', [String.raw`back\slash`]);

    const params = new URL(urls[0] ?? '').searchParams;
    expect(params.get('source_id')).toBe(String.raw`in.("back\\slash")`);
  });
});
