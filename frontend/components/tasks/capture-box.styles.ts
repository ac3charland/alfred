import { cn } from '@/lib/utils';

/**
 * Visual styling for the full-mode capture surface and its textarea, extracted so the static
 * appearance classes are locked by a unit test. The capture *behaviour* (submit, optimistic
 * clear, spinner, error restore) is covered by capture-box.test; this is its chrome.
 */
export const captureSurfaceClass = cn(
  'rounded-2xl border border-border bg-surface',
  'transition-[box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none',
  'focus-within:border-accent-teal focus-within:shadow-[0_0_24px_0_rgba(79,209,224,0.12)]',
);
export const captureTextareaClass = cn('rounded-2xl bg-transparent px-4 pt-4 pb-12', 'text-base');

/**
 * The capture "ghost": a transient copy of the just-captured text that fades and slides to the
 * right, confirming the thought was sent off to the inbox. Positioned to overlap the textarea's
 * first line (`left-4 top-4` mirrors the serif prompt and the textarea's `px-4 pt-4`). The exit
 * is a compound fade+slide via tw-animate-css; `fill-mode-forwards` holds it hidden through the
 * one-frame gap between `animationend` and React unmounting it (see the motion skill's flash
 * pitfall). Only ever rendered when motion is allowed, so `motion-reduce:animate-none` is the
 * belt-and-suspenders guard the convention requires.
 */
export const captureGhostClass = cn(
  'pointer-events-none absolute left-4 top-4 max-w-[calc(100%-2rem)] select-none',
  'whitespace-pre-wrap break-words text-base text-foreground',
  'animate-out fade-out-0 slide-out-to-right-8 fill-mode-forwards duration-300 ease-out',
  'motion-reduce:animate-none',
);
