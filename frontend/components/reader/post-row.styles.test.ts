import { hintClass, rowShellClass } from './post-row.styles';

/** The resting row: nothing selected, nothing open, nothing dimmed. */
const AT_REST = { selected: false, expanded: false, dimmed: false };

describe('rowShellClass', () => {
  it('is transparent, unringed and unwashed at rest', () => {
    const className = rowShellClass(AT_REST);
    expect(className).toContain('border-transparent');
    // The wash is the tell — `border-accent-green/60` alone also appears in the always-on
    // `focus-within:` variant, so it isn't a reliable open/closed signal.
    expect(className).not.toContain('bg-secondary/40');
    expect(className).not.toContain('ring-1');
    expect(className).not.toContain('opacity-70');
  });

  it('wears the green border and wash once the overview is open', () => {
    const className = rowShellClass({ ...AT_REST, expanded: true });
    expect(className).toContain('border-accent-green/60');
    expect(className).toContain('bg-secondary/40');
    expect(className).not.toContain('ring-1');
  });

  it('rings the row the keyboard is pointing at, whether or not it is open', () => {
    expect(rowShellClass({ ...AT_REST, selected: true })).toContain('ring-1 ring-accent-green/60');
    const both = rowShellClass({ ...AT_REST, selected: true, expanded: true });
    expect(both).toContain('ring-1 ring-accent-green/60');
    expect(both).toContain('bg-secondary/40');
  });

  it('dims a failed/refused row', () => {
    const className = rowShellClass({ ...AT_REST, dimmed: true });
    expect(className).toContain('opacity-70');
    expect(className).toContain('hover:opacity-100');
  });

  it('stops dimming a floor-state row the owner has opened or selected', () => {
    expect(rowShellClass({ selected: false, expanded: true, dimmed: true })).not.toContain(
      'opacity-70',
    );
    expect(rowShellClass({ selected: true, expanded: false, dimmed: true })).not.toContain(
      'opacity-70',
    );
  });
});

describe('hintClass', () => {
  it('shows the key from desktop up and never below it', () => {
    expect(hintClass).toContain('hidden');
    expect(hintClass).toContain('md:inline-flex');
    // Not `sm:` — a phone in landscape clears that breakpoint and still has no keyboard.
    expect(hintClass).not.toContain('sm:inline-flex');
  });

  it('wears the search box’s hint treatment', () => {
    expect(hintClass).toContain('rounded border border-border bg-background');
    expect(hintClass).toContain('font-mono text-[10px] text-muted-foreground');
  });
});
