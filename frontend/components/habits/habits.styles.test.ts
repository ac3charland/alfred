import {
  CELL_BOX,
  CELL_GAP_PX,
  CELL_HIT_AREA,
  CELL_PLATE,
  CONNECTOR_WIDTH,
  GRID_ROWS,
  SKIP_DASH,
  TOUCH_CELL_PITCH_PX,
  TOUCH_CELL_SIZE_PX,
  TOUCH_HIT_OUTSET_PX,
  WEEKDAY_LINE,
} from '@/components/habits/habits.styles';
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

describe('the touch geometry', () => {
  it('grows the square to 38px and keeps the 6px gap, for a 44px thumb-sized pitch', () => {
    expect(TOUCH_CELL_SIZE_PX).toBe(38);
    expect(CELL_GAP_PX).toBe(6);
    expect(TOUCH_CELL_PITCH_PX).toBe(44);
  });

  it('extends each square’s hit area by half the gap, so neighbouring targets meet', () => {
    expect(TOUCH_HIT_OUTSET_PX * 2).toBe(CELL_GAP_PX);
    expect(TOUCH_CELL_SIZE_PX + TOUCH_HIT_OUTSET_PX * 2).toBe(TOUCH_CELL_PITCH_PX);
  });

  it('carries both sizes in every class string, the desktop one first', () => {
    expect(CELL_BOX).toBe('h-[26px] w-[26px] touch:h-[38px] touch:w-[38px]');
    expect(GRID_ROWS).toBe('grid-rows-[repeat(7,26px)] touch:grid-rows-[repeat(7,38px)]');
    expect(WEEKDAY_LINE).toBe('leading-[26px] touch:leading-[38px]');
    expect(CONNECTOR_WIDTH).toBe('w-[10px] touch:w-[14px]');
    expect(SKIP_DASH).toBe('text-[13px] touch:text-[16px]');
  });

  it('tiles the hit area only in touch mode', () => {
    expect(CELL_HIT_AREA).toContain("touch:before:content-['']");
    expect(CELL_HIT_AREA).toContain('touch:before:-inset-[3px]');
    expect(
      CELL_HIT_AREA.split(' ').every((part) => part === 'relative' || part.startsWith('touch:')),
    ).toBe(true);
  });
});
