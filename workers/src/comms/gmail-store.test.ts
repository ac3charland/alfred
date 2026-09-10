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
});
