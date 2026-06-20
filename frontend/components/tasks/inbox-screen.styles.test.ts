import { revealStaticClass, spacerBaseClass, toggleLinkClass } from './inbox-screen.styles';

describe('inbox-screen styles', () => {
  it('toggle link is a pill with hover + focus-ring treatment', () => {
    expect(toggleLinkClass).toContain('rounded-full');
    expect(toggleLinkClass).toContain('text-muted-foreground');
    expect(toggleLinkClass).toContain('hover:text-foreground');
    expect(toggleLinkClass).toContain('focus-visible:ring-accent-blue');
  });

  it('spacer animates its flex-grow with a reduced-motion opt-out', () => {
    expect(spacerBaseClass).toContain('transition-[flex-grow]');
    expect(spacerBaseClass).toContain('motion-reduce:transition-none');
  });

  it('reveal container is a grid that disables animation under reduced motion', () => {
    expect(revealStaticClass).toContain('grid');
    expect(revealStaticClass).toContain('motion-reduce:animate-none');
  });
});
