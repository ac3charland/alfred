'use client';

import { ArrowUpRight, ChevronDown, LogOut } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { signOut } from '@/lib/auth/actions';
import type { AccentToken, InstanceConfig } from '@/lib/instance';
import { cn } from '@/lib/utils';

// Static per-accent class strings — written out in full (never interpolated) so the Tailwind v4
// scanner keeps every `accent-<token>` utility in the build (same rule as project-color.ts).

/** The pill tint (border + faint fill + text) — shared by the trigger and the menu header. */
const ACCENT_PILL_CLASS: Record<AccentToken, string> = {
  teal: 'border-accent-teal/40 bg-accent-teal/15 text-accent-teal',
  amber: 'border-accent-amber/40 bg-accent-amber/15 text-accent-amber',
  blue: 'border-accent-blue/40 bg-accent-blue/15 text-accent-blue',
  green: 'border-accent-green/40 bg-accent-green/15 text-accent-green',
};

const ACCENT_DOT_CLASS: Record<AccentToken, string> = {
  teal: 'bg-accent-teal',
  amber: 'bg-accent-amber',
  blue: 'bg-accent-blue',
  green: 'bg-accent-green',
};

/** Trigger-only hover + accent focus ring — overrides the ghost Button's secondary hover/ring. */
const ACCENT_TRIGGER_CLASS: Record<AccentToken, string> = {
  teal: 'hover:bg-accent-teal/25 hover:text-accent-teal focus-visible:ring-accent-teal',
  amber: 'hover:bg-accent-amber/25 hover:text-accent-amber focus-visible:ring-accent-amber',
  blue: 'hover:bg-accent-blue/25 hover:text-accent-blue focus-visible:ring-accent-blue',
  green: 'hover:bg-accent-green/25 hover:text-accent-green focus-visible:ring-accent-green',
};

/** An accent-tinted pill (dot + label) reused by the trigger and the menu header. */
function InstancePill({
  accent,
  label,
  className,
}: {
  accent: AccentToken;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium',
        ACCENT_PILL_CLASS[accent],
        className,
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', ACCENT_DOT_CLASS[accent])} aria-hidden />
      {label}
    </span>
  );
}

export interface InstanceMenuProperties {
  /** The signed-in user's email, shown in the menu header (null if unavailable). */
  email: string | null;
  /** This instance's identity — label, accent, and the other instance (or null). */
  instance: InstanceConfig;
}

/**
 * Top-right account/instance menu, replacing the bare Sign out button. The trigger is an
 * accent pill showing which brain you're in (Personal/Work); the menu reveals the signed-in
 * email, an "Open <other>" link (a full navigation to the other, session-less origin — only
 * when a second instance is configured), and the unchanged Sign out server action.
 *
 * A client molecule because the Radix dropdown needs a client boundary; it's handed its
 * identity as props so the enclosing Server Component owns the `getInstanceConfig()` read.
 */
export function InstanceMenu({ email, instance }: InstanceMenuProperties) {
  const { label, accent, other } = instance;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Account menu"
          className={cn(
            'gap-1.5 rounded-full border px-2.5 text-sm font-medium focus-visible:ring-offset-1',
            ACCENT_PILL_CLASS[accent],
            ACCENT_TRIGGER_CLASS[accent],
          )}
        >
          <span className={cn('h-2 w-2 rounded-full', ACCENT_DOT_CLASS[accent])} aria-hidden />
          {label}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56 motion-reduce:animate-none">
        {/* Non-interactive header: which instance, and who's signed in. */}
        <div className="flex flex-col items-start gap-1.5 px-2 py-1.5">
          <InstancePill accent={accent} label={label} />
          {email ? <span className="text-xs text-muted-foreground">{email}</span> : null}
        </div>

        {other ? (
          <>
            <DropdownMenuSeparator />
            {/* A plain cross-origin anchor: a full navigation to the other instance, which shares
                no session — so the owner logs in there separately. */}
            <DropdownMenuItem asChild>
              <a href={other.url} rel="noreferrer">
                <ArrowUpRight className="h-4 w-4" aria-hidden />
                Open {other.label}
              </a>
            </DropdownMenuItem>
          </>
        ) : null}

        <DropdownMenuSeparator />
        {/* Sign out — the existing server action (redirects to /login), invoked on select. The
            whole menu already requires JS to open, so a form's progressive enhancement adds nothing. */}
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void signOut();
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
