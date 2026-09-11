'use client';

import { BookMarked } from 'lucide-react';
import * as React from 'react';

import { EmptyState } from '@/components/atoms/empty-state';
import { ViewHeading } from '@/components/atoms/view-heading';
import { ExampleCard } from '@/components/comms/example-card';
import { PurgePanel } from '@/components/comms/purge-panel';
import { exampleSetVersion } from '@/components/comms/settings-format';
import { useCommsExamples } from '@/lib/stores/comms-settings-store';

/**
 * The example set (`/comms/examples`) — every correction the owner has made, which is also what
 * the prompt shows the model. Pruning one takes it out of the prompt without destroying the
 * record of the correction.
 *
 * The set's version is stated at the top because every verdict is stamped with it: "why did it
 * say that" is answered by reading the rubric version and the set version together, and neither
 * is useful if the current value is invisible.
 *
 * The purge sits at the foot of THIS page rather than on its own: it is the one action that
 * reaches into these rows, blanking the text of every example it touches.
 */
export function CommsExamplesView() {
  const corrections = useCommsExamples();
  const version = exampleSetVersion(corrections);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ViewHeading
        icon={BookMarked}
        title="Examples"
        description="Every correction you make becomes a few-shot example. Prune one that steers badly; the record stays."
        accent="comms"
      />

      {corrections.length === 0 ? (
        <EmptyState
          title="No corrections yet."
          description="Change a message's tier, or say there was nothing to answer, and it lands here."
        />
      ) : (
        <>
          {/* Not the uppercase caption: `v4` is a version number and shouting it reads wrong. */}
          <p className="text-xs text-muted-foreground/70">Example set v{version}</p>
          <ul className="flex flex-col gap-3">
            {corrections.map((correction) => (
              <ExampleCard key={correction.id} correction={correction} />
            ))}
          </ul>
        </>
      )}

      <PurgePanel />
    </div>
  );
}
