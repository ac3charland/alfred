import { cn } from '@/lib/utils';

/**
 * The Inbox bulk action bar floats (ALF-91): a fixed, centred pill pinned to the bottom of the
 * viewport so it stays reachable no matter how far the inbox list is scrolled, rather than
 * sitting in flow below the list where a long selection would push it off-screen.
 *
 * The wrapper spans the content area and is `pointer-events-none` so the transparent gutter
 * around the pill stays click-through — only the bar itself (`pointer-events-auto`) intercepts
 * clicks. `md:pl-56` offsets past the desktop sidebar so the pill centres under the list, not
 * the whole viewport. Its `z-40` layer floats above page content but below dialogs (`z-50`, so
 * the Send-to-Code gate covers it) and toasts (`z-[60]`).
 */
export const bulkBarWrapperClass = cn(
  'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 md:pl-56',
);

/**
 * The pill itself: the same teal-bordered, flex-wrap action row as before, re-skinned as a
 * raised floating surface — an opaque blurred background and a deep shadow so it reads clearly
 * over whatever list rows sit beneath it.
 */
export const bulkBarClass = cn(
  'pointer-events-auto flex flex-wrap items-center gap-2',
  'w-full max-w-2xl rounded-xl border border-accent-teal px-3 py-2.5',
  'bg-surface/95 backdrop-blur-sm shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)]',
);
