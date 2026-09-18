import { rowShellClass } from './post-row.styles';

describe('rowShellClass', () => {
  it('is transparent and unselected by default', () => {
    const className = rowShellClass(false, false);
    expect(className).toContain('border-transparent');
    // Selection's wash is the tell — `border-accent-green/60` alone also appears in the
    // always-on `focus-within:` variant, so it isn't a reliable unselected/selected signal.
    expect(className).not.toContain('bg-secondary/40');
    expect(className).not.toContain('opacity-70');
  });

  it('wears the green border and wash when selected', () => {
    const className = rowShellClass(true, false);
    expect(className).toContain('border-accent-green/60');
    expect(className).toContain('bg-secondary/40');
  });

  it('dims a failed/refused row', () => {
    const className = rowShellClass(false, true);
    expect(className).toContain('opacity-70');
    expect(className).toContain('hover:opacity-100');
  });

  it('does not dim a selected row even when it is also a floor state', () => {
    const className = rowShellClass(true, true);
    expect(className).not.toContain('opacity-70');
  });
});
