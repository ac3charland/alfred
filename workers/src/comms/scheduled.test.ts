import * as gmail from './gmail';
import * as retention from './retention';
import { type CommsTickEnv, runCommsRetention, runCommsTick } from './scheduled';
import * as sweep from './sweep';

const env: CommsTickEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  CLASSIFIER_MODEL: 'claude-haiku-4-5',
  CLASSIFIER_TIMEZONE: 'America/Chicago',
};

const NOW = new Date('2026-09-15T00:00:00.000Z');

describe('runCommsTick', () => {
  it('polls before it judges, so a message can be judged in the tick that captured it', async () => {
    const order: string[] = [];
    jest.spyOn(gmail, 'pollGmail').mockImplementation(() => {
      order.push('poll');
      return Promise.resolve({ accounts: [{ key: 'gmail-personal', polled: true, accepted: 3 }] });
    });
    jest.spyOn(sweep, 'runCommsSweep').mockImplementation(() => {
      order.push('sweep');
      return Promise.resolve({ eligible: 3, classified: 3, failed: 0, parked: 0, aborted: false });
    });

    const summary = await runCommsTick(env, NOW);

    expect(order).toEqual(['poll', 'sweep']);
    expect(summary).toEqual({
      gmail: { accounts: [{ key: 'gmail-personal', polled: true, accepted: 3 }] },
      sweep: { eligible: 3, classified: 3, failed: 0, parked: 0, aborted: false },
      failures: [],
    });
  });

  it('still judges what is already stored when the poll blows up', async () => {
    // Ingestion and judgment fail for different reasons and are fixed differently. A revoked
    // Gmail token must not stop the classifier from judging the mail that already arrived.
    jest.spyOn(gmail, 'pollGmail').mockRejectedValue(new Error('refresh token revoked'));
    const judged = jest
      .spyOn(sweep, 'runCommsSweep')
      .mockResolvedValue({ eligible: 2, classified: 2, failed: 0, parked: 0, aborted: false });

    const summary = await runCommsTick(env, NOW);

    expect(judged).toHaveBeenCalledTimes(1);
    expect(summary.gmail).toBeUndefined();
    expect(summary.sweep).toEqual({
      eligible: 2,
      classified: 2,
      failed: 0,
      parked: 0,
      aborted: false,
    });
    expect(summary.failures).toEqual(['gmail poll: refresh token revoked']);
  });

  it('reports a sweep that blew up without losing what the poll did', async () => {
    jest
      .spyOn(gmail, 'pollGmail')
      .mockResolvedValue({ accounts: [{ key: 'gmail-personal', polled: true, accepted: 1 }] });
    jest.spyOn(sweep, 'runCommsSweep').mockRejectedValue(new Error('Supabase GET failed: 500'));

    const summary = await runCommsTick(env, NOW);

    expect(summary.gmail?.accounts).toHaveLength(1);
    expect(summary.sweep).toBeUndefined();
    expect(summary.failures).toEqual(['comms sweep: Supabase GET failed: 500']);
  });
});

describe('runCommsRetention', () => {
  it('reports what the sweep deleted', async () => {
    jest.spyOn(retention, 'runRetention').mockResolvedValue({ deleted: 41 });

    await expect(runCommsRetention(env, NOW)).resolves.toEqual({ deleted: 41, failures: [] });
  });

  it('reports a failed sweep rather than taking the invocation down with it', async () => {
    jest.spyOn(retention, 'runRetention').mockRejectedValue(new Error('permission denied'));

    await expect(runCommsRetention(env, NOW)).resolves.toEqual({
      deleted: undefined,
      failures: ['comms retention: permission denied'],
    });
  });
});
