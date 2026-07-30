'use client';

import * as React from 'react';

import { CheckboxField } from '@/components/atoms/checkbox-field';
import { useCodeActions } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

/**
 * The "Needs refinement" toggle in the detail-modal header — the way to declare, on a story that
 * already exists, that it is small and clear enough to build with no spec.
 *
 * Unchecking it on a `needs_refinement` story parks the card in Ready for Dev behind the modal
 * (swapping the primary button from *Refine* to *Implement*) and **opens nothing** — unlike the
 * "Skip to Development" chip, which drags a browser tab along with the same judgement. Re-checking
 * it on a spec-less `ready_for_dev` story undoes that. In every other state it is a plain
 * checkbox: the mark is recorded on the row, the card doesn't move.
 *
 * Deliberately NOT part of `ManualControls` ("Move this story"), which is the linear
 * advance/revert stepper — this is a property of the story, not a hop.
 */
export function RefinementMark({ story }: { story: CodeStory }) {
  const { setRefinementRequired } = useCodeActions();
  const [pending, setPending] = React.useState(false);
  const ref = story.ref;
  // The column is `not null` on the base table but nominally nullable on the view row; a story
  // with no recorded value predates nothing — treat it as needing refinement, the DB's default.
  const checked = story.requires_refinement ?? true;

  const toggle = async (next: boolean) => {
    if (ref === null) return;
    setPending(true);
    try {
      await setRefinementRequired(ref, next);
    } catch {
      // The store rolled both the flag and the state back and toasted.
    } finally {
      setPending(false);
    }
  };

  return (
    <CheckboxField
      label="Needs refinement"
      checked={checked}
      disabled={pending || ref === null}
      onCheckedChange={(next) => {
        void toggle(next);
      }}
    />
  );
}
