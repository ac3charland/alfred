import { CircleHelp, FileText, type LucideIcon, Shapes, Users } from 'lucide-react';

import type { WikiSection } from '@/lib/wiki/sections';

/** Each wiki section's glyph — one map, so the Wiki nav and the ⌘K palette draw the same icon. */
export const WIKI_SECTION_ICONS: Record<WikiSection, LucideIcon> = {
  concepts: Shapes,
  entities: Users,
  sources: FileText,
  questions: CircleHelp,
};
