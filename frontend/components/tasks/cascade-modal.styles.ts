import { cn } from '@/lib/utils';

/**
 * Visual styling for the cascade-confirm dialog surface, extracted so the static appearance
 * classes are locked by a unit test. The dialog's behaviour (confirm/cancel, pending, count)
 * is covered by cascade-modal.test; this is purely its chrome.
 */
export const cascadeContentClass = cn(
  'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
  'w-full max-w-md rounded-2xl border border-border bg-surface p-6',
  'shadow-[0_0_40px_0_rgba(79,209,224,0.08)]',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
  'motion-reduce:animate-none',
);
