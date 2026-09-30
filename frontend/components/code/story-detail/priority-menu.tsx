'use client';

import { ArrowUpDown, ChevronDown } from 'lucide-react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { usePriorityJumps } from '@/components/code/story-detail/priority-controls';
import type { CodeStory } from '@/lib/types';

/**
 * The phone's priority control: one icon-only trigger in the action bar that opens the same four
 * jumps the desktop shows as buttons (`usePriorityJumps`), with their icons, titles and
 * already-there disabled states. Four labelled buttons wrap to two rows on a phone; a menu costs
 * one tap more and none of the room.
 *
 * Must be mounted under a `CodeProvider`.
 */
export function PriorityMenu({ story }: { story: CodeStory }) {
  const jumps = usePriorityJumps(story);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Priority" className="shrink-0 gap-1">
          <ArrowUpDown size={14} />
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {jumps.map((jump) => (
          <DropdownMenuItem
            key={jump.label}
            title={jump.title}
            disabled={jump.disabled}
            onSelect={jump.onClick}
          >
            {jump.icon}
            {jump.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
