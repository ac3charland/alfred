/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { recordResearchFire } from '@/lib/data/reader';
import { pinClock } from '@/lib/pin-clock';

import type { ResearchConfig } from './config';
import { fireAndRecord } from './fire';
import { fireResearchRoutine } from './routine';

jest.mock('server-only', () => ({}));
jest.mock('./routine', () => ({ fireResearchRoutine: jest.fn() }));
jest.mock('@/lib/data/reader', () => ({ recordResearchFire: jest.fn() }));

const mockFire = jest.mocked(fireResearchRoutine);
const mockRecord = jest.mocked(recordResearchFire);

pinClock('2026-09-29T12:00:00.000Z');

const CONFIG: ResearchConfig = {
  fireUrl: 'https://api.anthropic.com/v1/claude_code/routines/trig_01/fire',
  fireToken: 'fire-token',
  deliveryKey: 'delivery-key',
};

const POST = {
  id: '6f1c2b3a-0000-4000-8000-00000000000a',
  research_brief: 'Is a heat pump worth it?',
  research_attempts: 2,
};

const SUPABASE = { from: jest.fn() };

describe('fireAndRecord', () => {
  it('fires the Routine for the post, with the brief and no more', async () => {
    mockFire.mockResolvedValue({ ok: true, sessionUrl: null });
    mockRecord.mockResolvedValue({ data: null, error: null });

    await fireAndRecord(SUPABASE as never, CONFIG, POST);

    expect(mockFire).toHaveBeenCalledTimes(1);
    expect(mockFire).toHaveBeenCalledWith(CONFIG, {
      id: POST.id,
      research_brief: POST.research_brief,
    });
  });

  it('then records the outcome against the post, with its attempts and the moment', async () => {
    const outcome = { ok: true, sessionUrl: 'https://claude.ai/code/session_01' } as const;
    mockFire.mockResolvedValue(outcome);
    mockRecord.mockResolvedValue({ data: null, error: null });

    await fireAndRecord(SUPABASE as never, CONFIG, POST);

    expect(mockRecord).toHaveBeenCalledWith(
      SUPABASE,
      POST.id,
      outcome,
      2,
      new Date('2026-09-29T12:00:00.000Z'),
    );
    const [fired] = mockFire.mock.invocationCallOrder;
    const [recorded] = mockRecord.mock.invocationCallOrder;
    expect(fired).toBeLessThan(recorded ?? 0);
  });

  it('records a refused fire too — the post is marked failed, not left as it was', async () => {
    const outcome = { ok: false, error: 'the research Routine answered HTTP 500' } as const;
    mockFire.mockResolvedValue(outcome);
    mockRecord.mockResolvedValue({ data: null, error: null });

    await fireAndRecord(SUPABASE as never, CONFIG, POST);

    expect(mockRecord).toHaveBeenCalledWith(SUPABASE, POST.id, outcome, 2, expect.any(Date));
  });

  it('hands back what recording answered — the row, or the error that stopped it', async () => {
    mockFire.mockResolvedValue({ ok: true, sessionUrl: null });
    const answer = { data: null, error: { message: 'boom', code: 'X' } } as never;
    mockRecord.mockResolvedValue(answer);

    await expect(fireAndRecord(SUPABASE as never, CONFIG, POST)).resolves.toBe(answer);
  });
});
