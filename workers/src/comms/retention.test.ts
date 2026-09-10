import { spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import { RETENTION_DAYS, runRetention } from './retention';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

describe('runRetention', () => {
  it('asks the database to delete everything past the window and reports the count', async () => {
    const spy = spyOnFetch().mockResolvedValue(Response.json(128));

    await expect(runRetention(env, new Date('2026-09-15T09:17:00.000Z'))).resolves.toEqual({
      deleted: 128,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/rest/v1/rpc/comm_sweep_expired');
    expect(JSON.parse(init.body as string)).toEqual({ p_days: RETENTION_DAYS });
  });

  it('keeps the window at sixty days', () => {
    // Nothing in the design depends on the exact number, but changing it changes how much of the
    // owner's mail exists at any moment — so it moves deliberately or not at all.
    expect(RETENTION_DAYS).toBe(60);
  });
});
