import { cn } from '@/lib/utils';

/**
 * Visual styling for the inbox screen's toggle link, vertical-centering spacers, and the
 * list-reveal container, extracted so the static appearance classes are locked by a unit
 * test. The screen's own test covers the toggle + reveal *logic* (the conditional
 * grow/grow-0 and animate-expand/collapse classes stay inline there); this is the chrome.
 */
export const toggleLinkClass = cn(
  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground',
  'transition-colors duration-150 hover:text-foreground motion-reduce:transition-none',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
);
export const spacerBaseClass =
  'transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none';
export const revealStaticClass = 'grid motion-reduce:animate-none';
