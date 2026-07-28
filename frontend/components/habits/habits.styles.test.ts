import { CELL_PLATE, CELL_SHAPE } from '@/components/habits/habits.styles';
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
});

describe('the non-colour cue', () => {
  it('distinguishes met, partial and missed without any hue', () => {
    // Nothing over a met face; half a face for a partial one; an inner ring for a missed one.
    expect(CELL_SHAPE.met).toBe('');
    expect(CELL_SHAPE.partial).not.toBe(CELL_SHAPE.met);
    expect(CELL_SHAPE.missed).not.toBe(CELL_SHAPE.partial);
  });

  it('insets every cue with `inset-*`, never a margin', () => {
    // A margin-based inset on a `w-full` overlay measures the whole plate and THEN offsets
    // itself, so the cue hangs past two edges — which is exactly how the inner ring broke.
    for (const shape of Object.values(CELL_SHAPE)) {
      if (shape === '') continue;
      expect(shape).toMatch(/inset-/);
      expect(shape).not.toMatch(/\bm-\[/);
    }
  });

  it('keeps a full-bleed cue on the plate’s own radius so it cannot square off the corners', () => {
    expect(CELL_SHAPE.partial).toContain('inset-0');
    expect(CELL_SHAPE.partial).toContain('rounded-md');
  });
});
