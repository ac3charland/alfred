import { CircleDashed, type LucideIcon, Pencil, Sparkle } from 'lucide-react';
import * as React from 'react';

import {
  classificationMarkClass,
  classificationMarkGlyphClass,
} from '@/components/tasks/task-row.styles';
import type { ClassificationOrigin } from '@/lib/tasks/classification';
import { CLASSIFICATION_ORIGIN_LABEL } from '@/lib/tasks/classification';

/** The shape that names each origin — a machine's flourish, a human's hand, an empty outline. */
const ORIGIN_GLYPH: Record<ClassificationOrigin, LucideIcon> = {
  model: Sparkle,
  claimed: Pencil,
  unjudged: CircleDashed,
};

interface ClassificationMarkProperties {
  origin: ClassificationOrigin;
}

/**
 * The provenance mark: a small grey glyph beside an Inbox row's title saying where the row's
 * labels came from — the classifier, the owner, or nothing yet.
 *
 * It is **inert by construction**, a `<span>` in every mode. Anything clickable here would be an
 * affordance, and the only actions it could offer (accept, reject, re-run) are precisely the
 * second job this mark exists to avoid: it answers "where did these labels come from?", which is
 * a fact about the past, never "do you accept these?", which would be a task in the present.
 * Being always-inert also means it needs no non-interactive variant the way the row's chips do —
 * nesting it in the select-mode row's single `<button>` stays valid HTML.
 *
 * One component, two mount sites (the ordinary row's title and the select-mode row's), so the
 * two placements can't drift apart. The repo has no tooltip primitive, so the hover text is a
 * native `title` carrying the same words as the accessible name.
 */
export function ClassificationMark({ origin }: ClassificationMarkProperties) {
  const Glyph = ORIGIN_GLYPH[origin];
  const label = CLASSIFICATION_ORIGIN_LABEL[origin];
  return (
    <span
      // `role="img"` is what makes the label a real accessible name: on a bare generic span
      // `aria-label` is not exposed, and the glyph inside carries no text to name it.
      role="img"
      aria-label={label}
      title={label}
      className={classificationMarkClass}
    >
      <Glyph aria-hidden="true" className={classificationMarkGlyphClass[origin]} />
    </span>
  );
}
