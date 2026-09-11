'use client';

import { ScrollText } from 'lucide-react';
import * as React from 'react';

import { ViewHeading } from '@/components/atoms/view-heading';
import { RubricEditor, isRubricDirty } from '@/components/comms/rubric-editor';
import { RubricHistory } from '@/components/comms/rubric-history';
import { useNow } from '@/lib/hooks/use-now';
import {
  useCommsRubrics,
  useCommsSettingsActions,
  useCurrentRubric,
} from '@/lib/stores/comms-settings-store';

/**
 * The rubric (`/comms/rubric`) — the hand-written policy every verdict is judged against. It is
 * versioned and append-only, so a verdict months old still names the text that produced it, and
 * saving an edit re-judges nothing.
 *
 * The draft lives here rather than inside the editor, because Restore has to reach it: picking
 * an old version loads its text into the field, and saving from there is an ordinary new
 * version. That keeps "restore" honest — the history is a record, not a stack.
 */
export function CommsRubricView() {
  const rubrics = useCommsRubrics();
  const current = useCurrentRubric();
  const { saveRubric } = useCommsSettingsActions();
  const [draft, setDraft] = React.useState(current?.body ?? '');
  const isDirty = isRubricDirty(draft, current);

  // One ticking instant for the whole view — see `comms-format.ts`'s "one now" convention —
  // rather than each child starting its own interval subscription for the same job.
  const now = useNow();

  // The draft lives only in this component's state, so a hard reload or tab close would
  // otherwise discard it with no warning. This covers that half of the loss.
  //
  // In-app navigation (e.g. clicking "People" in the nav) is a different story: `CommsView`
  // swaps this component out purely by re-deriving from `pathname`, so by the time an unmount
  // effect here could run, the URL has already changed — there is no seam left to intercept or
  // undo it from this component alone. A real guard needs the navigation to ask FIRST, which
  // means plumbing through `ViewLink` / `CommsNav` / `CommsView` — outside this module's
  // ownership. Left outstanding; the visible "Unsaved changes" line in `RubricEditor` is the
  // mitigation available without it.
  React.useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // `preventDefault()` alone is enough to trigger the browser's native confirmation prompt.
      // The legacy `event.returnValue = '…'` companion is deprecated — see MDN — and every
      // browser still supported here honours preventDefault() on its own.
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  // Everything behind the head. A saved version lands at the head, so the version it followed
  // joins this list on the same render.
  const previous = rubrics.slice(1);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ViewHeading
        icon={ScrollText}
        title="Rubric"
        description="Plain-language policy the classifier follows. Saving makes a new version; nothing already judged is re-judged."
        accent="comms"
      />
      <RubricEditor
        current={current}
        draft={draft}
        onDraftChange={setDraft}
        onSave={async () => {
          await saveRubric(draft.trim());
        }}
        now={now}
      />
      <RubricHistory
        versions={previous}
        onRestore={(rubric) => {
          setDraft(rubric.body);
        }}
        now={now}
      />
    </div>
  );
}
