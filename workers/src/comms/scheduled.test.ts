import * as gmail from './gmail';
import * as retention from './retention';
import { type CommsTickEnv, runCommsJudge, runCommsPoll, runCommsRetention } from './scheduled';
import * as sweep from './sweep';

const env: CommsTickEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  CLASSIFIER_MODEL: 'claude-haiku-4-5',
  CLASSIFIER_TIMEZONE: 'America/Chicago',
};

const NOW = new Date('2026-09-15T00:00:00.000Z');

describe('runCommsPoll', () => {
  it('polls Gmail and touches nothing else, so the sweep is not on its budget', async () => {
    // The two used to share one invocation and therefore one 50-subrequest budget, which is how
    // each became the reason the other ran out. Keeping the sweep out of this tick is the fix, so
    // it is what the test pins.
    const polled = jest
      .spyOn(gmail, 'pollGmail')
      .mockResolvedValue({ accounts: [{ key: 'gmail-personal', polled: true, accepted: 3 }] });
    const swept = jest.spyOn(sweep, 'runCommsSweep');

    const summary = await runCommsPoll(env, NOW);

    expect(polled).toHaveBeenCalledTimes(1);
    expect(swept).not.toHaveBeenCalled();
    expect(summary).toEqual({
      gmail: { accounts: [{ key: 'gmail-personal', polled: true, accepted: 3 }] },
      sweep: undefined,
      failures: [],
    });
  });

  it('reports a poll that blew up rather than throwing out of the tick', async () => {
    jest.spyOn(gmail, 'pollGmail').mockRejectedValue(new Error('refresh token revoked'));

    const summary = await runCommsPoll(env, NOW);

    expect(summary.gmail).toBeUndefined();
    expect(summary.failures).toEqual(['gmail poll: refresh token revoked']);
  });
});

describe('runCommsJudge', () => {
  it('judges what is already stored and never polls, whatever the poll tick is doing', async () => {
    // Ingestion and judgment fail for different reasons and are fixed differently. A revoked Gmail
    // token must not stop the classifier from judging the mail that already arrived — which is now
    // structural rather than a matter of ordering, since they are separate invocations.
    const polled = jest.spyOn(gmail, 'pollGmail');
    const judged = jest
      .spyOn(sweep, 'runCommsSweep')
      .mockResolvedValue({ eligible: 2, classified: 2, failed: 0, parked: 0, aborted: false });

    const summary = await runCommsJudge(env, NOW);

    expect(judged).toHaveBeenCalledTimes(1);
    expect(polled).not.toHaveBeenCalled();
    expect(summary).toEqual({
      gmail: undefined,
      sweep: { eligible: 2, classified: 2, failed: 0, parked: 0, aborted: false },
      failures: [],
    });
  });

  it('reports a sweep that blew up rather than throwing out of the tick', async () => {
    jest.spyOn(sweep, 'runCommsSweep').mockRejectedValue(new Error('Supabase GET failed: 500'));

    const summary = await runCommsJudge(env, NOW);

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
