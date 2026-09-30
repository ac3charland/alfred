import { shellHeaderClass, shellRootClass, sidebarClass } from './app-shell.styles';

describe('app-shell root sizing', () => {
  it('sizes to the dynamic viewport so the landing screen fits the visible area on mobile', () => {
    // dvh tracks the currently-visible viewport; 100vh (min-h-screen) is the address-bar-
    // retracted height and overflows the visible area on mobile, scrolling the landing screen
    // before there is anything to scroll to. Regressing to min-h-screen reintroduces that bug.
    expect(shellRootClass).toContain('min-h-dvh');
    expect(shellRootClass).not.toContain('min-h-screen');
  });

  it('stays growable (min-height, not a fixed height) so the document scrolls once the inbox opens', () => {
    // A fixed h-dvh would clip the page and force an inner pane to scroll instead, breaking the
    // swipe-to-scroll gesture over the task list (which reads document.scrollingElement). Check
    // for a *standalone* height utility token so `min-h-dvh` (which contains "h-dvh") passes.
    const tokens = shellRootClass.split(/\s+/);
    expect(tokens).not.toContain('h-dvh');
    expect(tokens).not.toContain('h-screen');
    expect(tokens).not.toContain('h-full');
  });
});

describe('stationary chrome (ALF-304)', () => {
  it('pins the top bar to the viewport top above scrolling content', () => {
    // The document scrolls (see `shellRootClass`), so only `sticky` keeps the bar on screen; the
    // z-layer lifts it over the `z-10` drop gaps in the task list yet under dialogs (`z-50`).
    const tokens = shellHeaderClass.split(/\s+/);
    expect(tokens).toContain('sticky');
    expect(tokens).toContain('top-0');
    expect(tokens).toContain('z-20');
    expect(tokens).toContain('bg-surface');
  });

  it('pins the desktop sidebar to one viewport tall so its nav scrolls on its own', () => {
    // A stretched sidebar would scroll away with the page; sticky + one dynamic viewport tall keeps
    // it put, and `self-start` stops the flex row stretching it back to the page's height.
    const tokens = sidebarClass.split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining(['md:sticky', 'md:top-0', 'md:h-dvh', 'md:self-start']),
    );
  });
});
