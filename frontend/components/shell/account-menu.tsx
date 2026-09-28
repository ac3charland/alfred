'use client';

import { CircleUser, LogOut } from 'lucide-react';
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

export interface AccountMenuProperties {
  /** The signed-in user's email, shown in the menu header (null if unavailable). */
  email: string | null;
}

/**
 * Top-right account menu: an icon trigger revealing the signed-in email and the Sign out server
 * action. Sign out sits one deliberate step behind the trigger so a stray header tap can't end
 * the session.
 *
 * A client molecule because the Radix dropdown needs a client boundary; the enclosing Server
 * Component reads the session and hands the email in as a prop.
 */
export function AccountMenu({ email }: AccountMenuProperties) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu" className="rounded-full">
          <CircleUser className="h-5 w-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56 motion-reduce:animate-none">
        {email ? (
          <>
            {/* Non-interactive header: who's signed in. */}
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{email}</div>
            <DropdownMenuSeparator />
          </>
        ) : null}

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
