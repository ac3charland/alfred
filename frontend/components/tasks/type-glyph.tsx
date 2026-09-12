import { Code, type LucideIcon, SquareCheckBig } from 'lucide-react';
import * as React from 'react';

import type { ItemType } from '@/lib/types';

/** Icon + accessible name per type. Only types with an entry render a glyph. */
const TYPE_GLYPH: Partial<Record<ItemType, LucideIcon>> = {
  task: SquareCheckBig,
  code: Code,
};

const TYPE_LABEL: Partial<Record<ItemType, string>> = {
  task: 'Task',
  code: 'Code',
};

interface TypeGlyphProperties {
  itemType: ItemType;
  className?: string;
}

/**
 * A small icon naming an item's type — `code` for a code row, `square-check-big` for a task —
 * replacing the row's old "Task"/"Code" text pill (ALF-224). One component, two mount sites in
 * TaskRow: the ordinary row's checkbox column (a code row has no completion checkbox to show
 * there) and, in select mode, beside the selection tick box every row already carries (so the
 * type still needs its own mark once the tick box stops implying it). `unclassified` and
 * `knowledge` render nothing — an untriaged or reserved row stays the quiet "nothing to say yet"
 * it always was.
 *
 * Always `role="img"` + `aria-label`, like `ClassificationMark`: the glyph alone carries no text,
 * so without it the type would be legible to sighted users only.
 */
export function TypeGlyph({ itemType, className }: TypeGlyphProperties) {
  const Glyph = TYPE_GLYPH[itemType];
  const label = TYPE_LABEL[itemType];
  if (Glyph === undefined || label === undefined) return null;
  return (
    <span role="img" aria-label={label} className="inline-flex shrink-0 items-center">
      <Glyph aria-hidden="true" className={className} />
    </span>
  );
}
