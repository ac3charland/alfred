import * as React from 'react';

import { cn } from '@/lib/utils';

export type InputProperties = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProperties>(
  ({ className, type, ...properties }, reference) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-sm border border-border bg-input px-3 py-2',
          'text-sm text-foreground placeholder:text-muted-foreground',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={reference}
        {...properties}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
