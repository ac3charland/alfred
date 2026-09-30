/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { claimResearchFire, recordResearchFire } from '@/lib/data/reader';
import { pinClock } from '@/lib/pin-clock';

import type { ResearchConfig } from './config';
import { fireAndRecord } from './fire';
import { fireResearchRoutine } from './routine';

jest.mock('server-only', () => ({}));
jest.mock('./routine', () => ({ fireResearchRoutine: jest.fn() }));
jest.mock('@/lib/data/reader', () => ({
  claimResearchFire: jest.fn(),
  recordResearchFire: jest.fn(),
}));

const mockFire = jest.mocked(fireResearchRoutine);
const mockClaim = jest.mocked(claimResearchFire);
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
  research_state: 'failed',
};

const SUPABASE = { from: jest.fn() };

beforeEach(() => {
  mockClaim.mockResolvedValue({ data: { id: POST.id }, error: null });
});

describe('fireAndRecord', () => {
  it('claims the post against the attempts and state it was read with, before anything fires', async () => {
    mockFire.mockResolvedValue({ ok: true, sessionUrl: null });
    mockRecord.mockResolvedValue({ data: null, error: null });

    await fireAndRecord(SUPABASE as never, CONFIG, POST);

    expect(mockClaim).toHaveBeenCalledWith(SUPABASE, POST.id, { attempts: 2, state: 'failed' });
    const [claimed] = mockClaim.mock.invocationCallOrder;
    const [fired] = mockFire.mock.invocationCallOrder;
    expect(claimed).toBeLessThan(fired ?? 0);
  });

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

  it('then records the outcome against the post, at the moment', async () => {
    const outcome = { ok: true, sessionUrl: 'https://claude.ai/code/session_01' } as const;
    mockFire.mockResolvedValue(outcome);
    mockRecord.mockResolvedValue({ data: null, error: null });

    await fireAndRecord(SUPABASE as never, CONFIG, POST);

    expect(mockRecord).toHaveBeenCalledWith(
      SUPABASE,
      POST.id,
      outcome,
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

    expect(mockRecord).toHaveBeenCalledWith(SUPABASE, POST.id, outcome, expect.any(Date));
  });

  it('hands back what recording answered — the row, or the error that stopped it', async () => {
    mockFire.mockResolvedValue({ ok: true, sessionUrl: null });
    const answer = { data: null, error: { message: 'boom', code: 'X' } } as never;
    mockRecord.mockResolvedValue(answer);

    await expect(fireAndRecord(SUPABASE as never, CONFIG, POST)).resolves.toEqual({
      claimed: true,
      ...(answer as object),
    });
  });

  it('fires nothing when another request claimed the post first', async () => {
    mockClaim.mockResolvedValue({ data: null, error: null });

    await expect(fireAndRecord(SUPABASE as never, CONFIG, POST)).resolves.toEqual({
      claimed: false,
      data: null,
      error: null,
    });
    expect(mockFire).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('fires nothing when the claim itself fails, and hands back that error', async () => {
    const error = { message: 'connection reset', code: 'XX000' } as never;
    mockClaim.mockResolvedValue({ data: null, error });

    await expect(fireAndRecord(SUPABASE as never, CONFIG, POST)).resolves.toEqual({
      claimed: false,
      data: null,
      error,
    });
    expect(mockFire).not.toHaveBeenCalled();
  });
});
