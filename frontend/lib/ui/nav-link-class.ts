import { cn } from '@/lib/utils';

/** Shared styling for a sidebar nav link, highlighted when it points at the active route. */
export const navLinkClass = (active: boolean) =>
  cn(
    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
    'flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors duration-100 motion-reduce:transition-none',
    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    active
      ? 'bg-secondary text-foreground font-medium'
      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
  );
