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
