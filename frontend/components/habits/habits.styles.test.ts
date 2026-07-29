import { CELL_PLATE } from '@/components/habits/habits.styles';
import type { CellStatus } from '@/lib/habits';

const STATUSES: CellStatus[] = ['met', 'partial', 'missed', 'skipped', 'unknown', 'not_applicable'];

describe('the cell plate', () => {
  it('gives every state a treatment', () => {
    for (const status of STATUSES) expect(CELL_PLATE[status]).not.toBe('');
  });

  it('separates a skipped day from an unlogged one — the pair most easily conflated', () => {
    // Both are neutral plates, but only the excused one carries a rim.
    expect(CELL_PLATE.skipped).toContain('ring-1');
    expect(CELL_PLATE.unknown).not.toContain('ring');
  });

  it('gives each outcome its own plate, so nothing has to be drawn on the face', () => {
    // Once met / partial / missed each look different on their own, a mark layered on top is
    // one more thing to decode for a distinction the plate has already made.
    const outcomes = [CELL_PLATE.met, CELL_PLATE.partial, CELL_PLATE.missed];
    expect(new Set(outcomes).size).toBe(outcomes.length);
  });
});
