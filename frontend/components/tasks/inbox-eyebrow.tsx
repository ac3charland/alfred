'use client';

import { useScopedTasks } from '@/lib/stores/tasks-store';

/**
 * The Inbox list's header label, carrying how many items are waiting (ALF-175): "Inbox (3)".
 *
 * The tally is read from the shared store through the very selector the list below it renders
 * from, so the header can't disagree with what's on screen: it counts the ACTIVE, UNDISPATCHED
 * ROOTS — not the subtasks nested under them, and not items already filed into a folder.
 *
 * At zero the label stays a bare "Inbox". An empty inbox already says so in its own empty state,
 * and a "(0)" would only add noise — the same "nothing at zero" rule the folder count badges follow.
 */
export function InboxEyebrow() {
  const count = useScopedTasks({ type: 'inbox' }).length;

  return (
    <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
      {count > 0 ? `Inbox (${String(count)})` : 'Inbox'}
    </span>
  );
}
