import { captureGhostClass, captureSurfaceClass, captureTextareaClass } from './capture-box.styles';

describe('capture-box styles', () => {
  it('surface is a rounded, bordered card that lifts on focus-within', () => {
    expect(captureSurfaceClass).toContain('rounded-2xl');
    expect(captureSurfaceClass).toContain('bg-surface');
    expect(captureSurfaceClass).toContain('transition-[box-shadow,border-color]');
    expect(captureSurfaceClass).toContain('focus-within:border-accent-teal');
  });

  it('textarea is transparent with the serif-prompt padding', () => {
    expect(captureTextareaClass).toContain('bg-transparent');
    expect(captureTextareaClass).toContain('pb-12');
    expect(captureTextareaClass).toContain('text-base');
  });

  it('ghost fades and slides right out of the box, holding hidden and respecting reduced motion', () => {
    // Overlaps the textarea's first line and is decorative (no pointer events).
    expect(captureGhostClass).toContain('absolute');
    expect(captureGhostClass).toContain('left-4');
    expect(captureGhostClass).toContain('top-4');
    expect(captureGhostClass).toContain('pointer-events-none');
    // The compound fade+slide-right exit.
    expect(captureGhostClass).toContain('animate-out');
    expect(captureGhostClass).toContain('fade-out-0');
    expect(captureGhostClass).toContain('slide-out-to-right-8');
    // Holds hidden through the animationend→unmount gap (no flash) and disables under reduced motion.
    expect(captureGhostClass).toContain('fill-mode-forwards');
    expect(captureGhostClass).toContain('motion-reduce:animate-none');
  });
});
