import { navLinkClass } from './nav-link-class';

describe('navLinkClass', () => {
  it('includes the shared base layout + focus-ring classes regardless of active state', () => {
    for (const active of [true, false]) {
      const result = navLinkClass(active);
      expect(result).toContain('flex items-center gap-2.5');
      expect(result).toContain('focus-visible:ring-accent-blue');
    }
  });

  it('uses the active treatment when active', () => {
    const result = navLinkClass(true);
    expect(result).toContain('bg-secondary');
    expect(result).toContain('text-foreground');
    expect(result).toContain('font-medium');
    expect(result).not.toContain('text-muted-foreground');
  });

  it('uses the inactive treatment when inactive', () => {
    const result = navLinkClass(false);
    expect(result).toContain('text-muted-foreground');
    expect(result).toContain('hover:bg-secondary/50');
    expect(result).not.toContain('font-medium');
  });
});
