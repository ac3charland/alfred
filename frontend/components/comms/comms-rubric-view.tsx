'use client';

import { ScrollText } from 'lucide-react';
import * as React from 'react';

import { ViewHeading } from '@/components/atoms/view-heading';
import { RubricEditor } from '@/components/comms/rubric-editor';
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

  // One ticking instant for the whole view — see `comms-format.ts`'s "one now" convention —
  // rather than each child starting its own interval subscription for the same job.
  const now = useNow();

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
