'use client';

import { Plus, Users } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { ViewHeading } from '@/components/atoms/view-heading';
import { DeletePersonDialog } from '@/components/comms/delete-person-dialog';
import { PersonCard } from '@/components/comms/person-card';
import { PersonDialog } from '@/components/comms/person-dialog';
import { stableSorted } from '@/lib/sort';
import { useCommsPeople, useCommsSettingsActions } from '@/lib/stores/comms-settings-store';
import type { CommPersonWithHandles } from '@/lib/types';

/**
 * The people list (`/comms/people`) — the roster the classifier weighs a sender against. It is
 * keyed on the person, never the address: the same human is a phone number in iMessage and an
 * email address in three mailboxes, so one row carries many handles.
 *
 * Sorted by name here rather than trusted from the seed, so a person added in this session sits
 * where they will still be after a reload instead of at the bottom until then.
 *
 * The delete confirm is hosted at the view, not per card: it is a single modal that names the
 * person it is acting on, so one mounted instance beats one per row — and a card leaving the
 * list can't unmount the dialog mid-write.
 */
export function CommsPeopleView() {
  const people = useCommsPeople();
  const { createPerson, deletePerson } = useCommsSettingsActions();
  const [isCreating, setIsCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<CommPersonWithHandles | undefined>();

  const sorted = React.useMemo(
    () => stableSorted(people, (a, b) => a.name.localeCompare(b.name)),
    [people],
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <ViewHeading
          icon={Users}
          title="People"
          description="Who matters, and how to reach them. The classifier reads this list before it reads the rubric."
          accent="comms"
        />
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            setIsCreating(true);
          }}
        >
          <Plus size={14} />
          New person
        </Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="No people yet."
          description="Add the people whose messages should never wait."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {sorted.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              onDelete={() => {
                setDeleting(person);
              }}
            />
          ))}
        </ul>
      )}

      <PersonDialog open={isCreating} onOpenChange={setIsCreating} onCreate={createPerson} />
      <DeletePersonDialog
        person={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        onDelete={deletePerson}
      />
    </div>
  );
}
