import { BookOpen, Code2, Library, ListTodo, type LucideIcon, MessagesSquare } from 'lucide-react';

import type { ModuleId } from '@/lib/modules';

/**
 * Each module's icon — the switcher's icon-only segments and the ⌘K palette's `ICONS` table
 * both read from here, so the two can't disagree (ALF-270). Kept out of `lib/modules.ts` so
 * that file stays free of a React/lucide dependency.
 */
export const MODULE_ICON: Record<ModuleId, LucideIcon> = {
  tasks: ListTodo,
  code: Code2,
  comms: MessagesSquare,
  reader: BookOpen,
  wiki: Library,
};
