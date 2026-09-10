'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Button } from '@/components/atoms/button';
import { DisclosureToggle } from '@/components/atoms/disclosure-toggle';
import { formatSavedAt, rubricFirstLine } from '@/components/comms/settings-format';
import { VERSION_STAMP } from '@/components/comms/settings.styles';
import { useNow } from '@/lib/hooks/use-now';
import type { CommRubric } from '@/lib/types';

/**
 * The versions behind the current one, collapsed.
 *
 * They are kept — and readable — because a verdict names the version that produced it, so an old
 * version is the only answer to "why did it say that" months later. Collapsed, because that is a
 * question asked rarely and never while writing the next one.
 *
 * Restore loads the old text into the editor rather than writing anything. Coming back to an
 * earlier policy is still an edit, so it still makes a new version: the table never loses a row,
 * and the history stays a record of what was in force when, not a stack that can be popped.
 */
export function RubricHistory({
  versions,
  onRestore,
}: {
  /** The versions BEHIND the current one, newest first. */
  versions: CommRubric[];
  onRestore: (rubric: CommRubric) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const regionId = React.useId();
  const now = useNow();

  if (versions.length === 0) return null;

  return (
    <section className="flex flex-col gap-1">
      <DisclosureToggle
        aria-expanded={open}
        aria-controls={regionId}
        className="self-start gap-1"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        Previous versions ({versions.length})
      </DisclosureToggle>
      <AnimatedHeightCollapse open={open}>
        <ul id={regionId} className="flex flex-col gap-1.5 pt-1">
          {versions.map((rubric) => (
            <li
              key={rubric.id}
              className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
            >
              <span className={VERSION_STAMP}>v{rubric.version}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatSavedAt(rubric.created_at, now)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
                {rubricFirstLine(rubric.body)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onRestore(rubric);
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </AnimatedHeightCollapse>
    </section>
  );
}
