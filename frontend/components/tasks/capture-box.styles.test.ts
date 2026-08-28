import { captureGhostClass, captureSurfaceClass, captureTextareaClass } from './capture-box.styles';
import { sendOffClass } from './task-row.styles';

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

  it('ghost fades and slides right out of the box, on the shared send-off token', () => {
    // Overlaps the textarea's first line and is decorative (no pointer events).
    expect(captureGhostClass).toContain('absolute');
    expect(captureGhostClass).toContain('left-4');
    expect(captureGhostClass).toContain('top-4');
    expect(captureGhostClass).toContain('pointer-events-none');
    // The fade+slide-right exit, shared verbatim with a dispatched Inbox row (sendOffClass):
    // one token, so the two can never drift. Its `forwards` fill-mode lives inside the token's
    // shorthand, holding the ghost hidden through the animationend→unmount gap (no flash).
    expect(captureGhostClass).toContain('animate-send-off');
    expect(captureGhostClass).toContain('motion-reduce:animate-none');
  });

  it('the ghost and a dispatched row leave on the very same animation', () => {
    // The literal expression of "dispatch with the same slide-out as inbox capture": if one
    // side ever swaps its motion, this fails rather than silently drifting.
    expect(captureGhostClass).toContain(sendOffClass);
  });
});
