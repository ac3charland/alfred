import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

interface SpinnerProperties {
  /** Icon size in pixels. */
  size?: number;
  /** Accessible label announced to assistive technology. */
  label?: string;
  className?: string;
}

/**
 * A spinning loading indicator with an accessible status role — the inline "in flight"
 * affordance (e.g. the capture box while a save is still pending). Exposes `role="status"`
 * with an `aria-label` so screen readers announce it and tests can find it by role.
 */
export function Spinner({ size = 14, label = 'Loading', className }: SpinnerProperties) {
  return (
    <Loader2
      size={size}
      role="status"
      aria-label={label}
      className={cn('animate-spin', className)}
    />
  );
}
