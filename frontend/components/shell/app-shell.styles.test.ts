import { shellRootClass } from './app-shell.styles';

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
