'use client';

import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import { ToggleButton } from '@/components/atoms/toggle-button';
import { ViewHeading } from '@/components/atoms/view-heading';
import { TriageRow } from '@/components/tasks/triage-row';
import { useFolders } from '@/lib/stores/folders-store';
import { residentFolderId } from '@/lib/tasks/residency';
import type { ItemNode } from '@/lib/tree';

interface TriageListProperties {
  /** The view's glyph, title, and one-line description — see {@link ViewHeading}. */
  icon: LucideIcon;
  title: string;
  description: string;
  /** The list's accessible name, e.g. "Tasks by priority" — each view names its own ordering. */
  listLabel: string;
  /** What to say when the ranking selects nothing. */
  emptyMessage: string;
  /** The already-ranked top-level tasks, each carrying its subtree. */
  tasks: readonly ItemNode[];
  showCompleted: boolean;
  onToggleCompleted: () => void;
}

/**
 * The shared scaffold of a **triage list** — the cross-cutting views (By Priority, Today) that
 * pull top-level tasks out of every folder into one ranked list. It owns everything the two have
 * in common: the heading + Show-completed toggle row, the ranked `<ul>` of {@link TriageRow}s
 * each labelled with the bucket it lives in, and the empty state.
 *
 * What it deliberately does NOT own is the ranking. Each view runs its own selector and hands the
 * result down, so the one thing that actually distinguishes them — By Priority ranks by level,
 * Today by deadline — stays visible in the view rather than hidden behind a flag here.
 *
 * Must be mounted under a `FoldersProvider` / `TasksProvider` (the shell-seeded stores).
 */
export function TriageList({
  icon,
  title,
  description,
  listLabel,
  emptyMessage,
  tasks,
  showCompleted,
  onToggleCompleted,
}: TriageListProperties) {
  const folders = useFolders();

  // Takes a RESIDENT folder id (see `residentFolderId`), so a task still awaiting triage reads
  // "Inbox" even when it already carries a folder — the view it actually renders in.
  const folderName = (folderId: string | null): string =>
    folderId === null
      ? 'Inbox'
      : (folders.find((folder) => folder.id === folderId)?.name ?? 'Unknown');

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <ViewHeading icon={icon} title={title} description={description} />
        <ToggleButton pressed={showCompleted} onToggle={onToggleCompleted}>
          Show completed
        </ToggleButton>
      </div>

      {tasks.length > 0 ? (
        <ul aria-label={listLabel} className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TriageRow
              key={task.id}
              node={task}
              depth={0}
              folderName={folderName(residentFolderId(task))}
              showCompleted={showCompleted}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-10">
          <p className="max-w-sm text-center text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      )}
    </>
  );
}
