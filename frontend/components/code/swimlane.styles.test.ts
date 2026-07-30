import { laneBaseClass, laneDropActiveClass } from './swimlane.styles';

describe('swimlane styles', () => {
  it('base lane styling is the fixed-width column with a colour transition', () => {
    expect(laneBaseClass).toContain('w-60');
    expect(laneBaseClass).toContain('shrink-0');
    expect(laneBaseClass).toContain('transition-colors');
    expect(laneBaseClass).toContain('motion-reduce:transition-none');
  });

  it('drop-target styling adds the teal wash + ring', () => {
    expect(laneDropActiveClass).toContain('bg-accent-teal/15');
    expect(laneDropActiveClass).toContain('ring-accent-teal/50');
  });
});
