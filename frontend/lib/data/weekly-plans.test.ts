/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { getLatestWeeklyPlan, getWeeklyPlanIndex } from './weekly-plans';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const HTML = '<!DOCTYPE html><html></html>';
const NEWER = { id: 'p-2', html: HTML, uploaded_at: '2026-07-24T12:00:00Z' };
const OLDER = { id: 'p-1', html: HTML, uploaded_at: '2026-07-17T12:00:00Z' };

/** The index read ends at `.order()`. */
function mockIndexClient(result: { data: unknown }) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(result),
  };
  mockCreateClient.mockResolvedValue({ from: jest.fn().mockReturnValue(chain) } as never);
  return chain;
}

/** The latest read ends at `.limit()`, one step past `.order()`. */
function mockLatestClient(result: { data: unknown }) {
  const limit = jest.fn().mockResolvedValue(result);
  const chain = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnValue({ limit }),
    limit,
  };
  mockCreateClient.mockResolvedValue({ from: jest.fn().mockReturnValue(chain) } as never);
  return chain;
}

describe('getWeeklyPlanIndex', () => {
  it('reads the archive newest-first, without the documents', async () => {
    const chain = mockIndexClient({ data: [{ id: NEWER.id, uploaded_at: NEWER.uploaded_at }] });

    const result = await getWeeklyPlanIndex();

    // The index is the picker's list: shipping every document in it would defeat the point.
    expect(chain.select).toHaveBeenCalledWith('id, uploaded_at');
    expect(chain.order).toHaveBeenCalledWith('uploaded_at', { ascending: false });
    expect(result).toStrictEqual([{ id: NEWER.id, uploaded_at: NEWER.uploaded_at }]);
  });

  it('returns an empty index when nothing has been uploaded', async () => {
    mockIndexClient({ data: null });
    expect(await getWeeklyPlanIndex()).toStrictEqual([]);
  });
});

describe('getLatestWeeklyPlan', () => {
  it('returns the newest plan with its document', async () => {
    const chain = mockLatestClient({ data: [NEWER] });

    const result = await getLatestWeeklyPlan();

    expect(chain.select).toHaveBeenCalledWith('*');
    expect(chain.order).toHaveBeenCalledWith('uploaded_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(result).toStrictEqual(NEWER);
  });

  it('takes the head of the list rather than demanding exactly one row', async () => {
    // A cardinality-enforcing read (`.maybeSingle()`) errors the moment the archive holds
    // more than one plan and the limit fails to narrow it — that must not blank the view.
    mockLatestClient({ data: [NEWER, OLDER] });

    expect(await getLatestWeeklyPlan()).toStrictEqual(NEWER);
  });

  it('returns undefined when nothing has been uploaded', async () => {
    mockLatestClient({ data: [] });
    expect(await getLatestWeeklyPlan()).toBeUndefined();
  });
});
