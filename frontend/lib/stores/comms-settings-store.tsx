'use client';

import * as React from 'react';

import {
  type AddHandleInput,
  type CreatePersonInput,
  type UpdatePersonInput,
  addCommHandle,
  createCommPerson,
  createCommRubricVersion,
  deleteCommHandle,
  deleteCommPerson,
  pruneCommExample,
  updateCommPerson,
} from '@/lib/api-client';
import { toUpdatePayload } from '@/lib/api/updates';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import {
  type SimpleAction,
  capturedFields,
  insertAt,
  simpleReducer,
} from '@/lib/stores/reducer-actions';
import { useToastActions } from '@/lib/stores/toast-store';
import type { CommCorrection, CommHandle, CommPersonWithHandles, CommRubric } from '@/lib/types';

/**
 * Comms settings store — the three things the owner writes by hand: the roster of people whose
 * messages matter, the versioned rubric, and the example set the corrections double as.
 *
 * Kept apart from the queue store because the two change on entirely different clocks. Messages
 * and account health move every few minutes and arrive over a push channel; the roster and the
 * rubric change only when a human edits them, so this store is pure seed-once with optimistic
 * writes — no subscription.
 */

export interface CommsSettingsState {
  /** The roster, each person carrying the handles that resolve to them. */
  people: CommPersonWithHandles[];
  /** Every rubric version, NEWEST FIRST — so the current rubric is simply the head. */
  rubrics: CommRubric[];
  /** Every recorded correction, newest first. These are the prompt's example set. */
  corrections: CommCorrection[];
}

export interface CommsSettingsActions {
  /** Apply a roster edit in this tab only, with no server write. */
  patchPersonLocally: (id: string, patch: Partial<CommPersonWithHandles>) => void;
  /** Add roster rows, replacing any already held by id — the local half of a create. */
  upsertPeopleLocally: (people: CommPersonWithHandles[]) => void;
  /** Drop a roster row locally — the local half of a delete. */
  removePersonLocally: (id: string) => void;
  /**
   * Put a saved rubric version at the head of the list, which makes it the current rubric.
   * The table is append-only, so a save never replaces the version it followed.
   */
  addRubricVersion: (rubric: CommRubric) => void;
  /** Apply an example-set change in this tab only. */
  patchExampleLocally: (id: string, patch: Partial<CommCorrection>) => void;
  /**
   * The optimistic write the roster's edits share: patch the person now, call the API,
   * reconcile with the row the server returns — or restore the captured row, toast, re-throw.
   */
  writePerson: (
    id: string,
    patch: Partial<CommPersonWithHandles>,
    apiCall: () => Promise<CommPersonWithHandles>,
    errorMessage: string,
  ) => Promise<CommPersonWithHandles>;
  /** The same dance for one example — the prune toggle's whole mechanism. */
  writeExample: (
    id: string,
    patch: Partial<CommCorrection>,
    apiCall: () => Promise<CommCorrection>,
    errorMessage: string,
  ) => Promise<CommCorrection>;
  /**
   * Add someone to the roster. Deliberately NOT optimistic: the server assigns the person's id
   * and one id per handle, so an optimistic row would have to invent five ids and then swap all
   * of them — for a form the owner has already decided to submit and is watching close.
   */
  createPerson: (input: CreatePersonInput) => Promise<CommPersonWithHandles>;
  /** Rename someone, change their priority, or edit the note. Handles are untouched. */
  updatePerson: (id: string, patch: UpdatePersonInput) => Promise<CommPersonWithHandles>;
  /** Drop someone from the roster; their handles cascade with them. */
  deletePerson: (id: string) => Promise<void>;
  /** Give a person one more address or number. */
  addHandle: (personId: string, input: AddHandleInput) => Promise<CommHandle>;
  /** Take one address or number off a person. */
  removeHandle: (personId: string, handleId: string) => Promise<void>;
  /**
   * Save the rubric. Like a create, this waits on the server — the VERSION NUMBER is assigned
   * there, and a version the UI guessed would be the one thing about a saved rubric that has to
   * be right. Saving sweeps nothing: everything already judged keeps its judgment.
   */
  saveRubric: (body: string) => Promise<CommRubric>;
  /** Take a correction out of the example set, or put it back. */
  setExamplePruned: (id: string, pruned: boolean) => Promise<CommCorrection>;
}

type CommsSettingsAction =
  | { type: 'people'; action: SimpleAction<CommPersonWithHandles> }
  | { type: 'addRubric'; rubric: CommRubric }
  | { type: 'corrections'; action: SimpleAction<CommCorrection> };

/**
 * Pure reducer. The people and correction lists delegate to the shared flat-list reducer, so a
 * patch for an id the store no longer holds is a no-op — the race rule, for free.
 */
export function commsSettingsReducer(
  state: CommsSettingsState,
  action: CommsSettingsAction,
): CommsSettingsState {
  switch (action.type) {
    case 'people': {
      return { ...state, people: simpleReducer(state.people, action.action, 'comms person') };
    }
    case 'addRubric': {
      // Position-aware on purpose: `rubrics` is the one list whose ORDER is meaning, so a saved
      // version goes to the HEAD (becoming the current rubric) rather than being appended.
      const without = state.rubrics.filter((rubric) => rubric.id !== action.rubric.id);
      return { ...state, rubrics: insertAt(without, action.rubric, 0) };
    }
    case 'corrections': {
      return {
        ...state,
        corrections: simpleReducer(state.corrections, action.action, 'comms correction'),
      };
    }
    default: {
      return assertNever(action, 'comms settings action');
    }
  }
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  CommsSettingsState,
  CommsSettingsActions
>('a CommsSettingsProvider');

export function CommsSettingsProvider({
  initialPeople,
  initialRubrics,
  initialCorrections,
  children,
}: {
  initialPeople: CommPersonWithHandles[];
  /** Newest first — the seed reader already orders them that way. */
  initialRubrics: CommRubric[];
  initialCorrections: CommCorrection[];
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(commsSettingsReducer, {
    people: initialPeople,
    rubrics: initialRubrics,
    corrections: initialCorrections,
  });

  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const { showToast } = useToastActions();
  const showToastRef = React.useRef(showToast);
  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const actions = React.useMemo<CommsSettingsActions>(() => {
    /**
     * The optimistic write the roster's edits share: patch the person now, call the API,
     * reconcile with the row the server returns — or restore the captured fields, toast,
     * re-throw. Declared before the actions object so the roster's own actions can reuse it
     * without going through `this`.
     */
    const writePerson = async (
      id: string,
      patch: Partial<CommPersonWithHandles>,
      apiCall: () => Promise<CommPersonWithHandles>,
      errorMessage: string,
    ): Promise<CommPersonWithHandles> => {
      const current = stateRef.current.people.find((person) => person.id === id);
      const captured = current === undefined ? {} : capturedFields(current, patch);
      return runOptimisticMutation({
        optimistic: () => {
          dispatch({ type: 'people', action: { type: 'patch', ids: [id], patch } });
        },
        apiCall,
        reconcile: (saved) => {
          dispatch({ type: 'people', action: { type: 'patch', ids: [id], patch: saved } });
        },
        rollback: () => {
          dispatch({ type: 'people', action: { type: 'patch', ids: [id], patch: captured } });
        },
        onError: () => {
          showToastRef.current(errorMessage);
        },
      });
    };

    /** The same dance for one example — the prune toggle's whole mechanism. */
    const writeExample = async (
      id: string,
      patch: Partial<CommCorrection>,
      apiCall: () => Promise<CommCorrection>,
      errorMessage: string,
    ): Promise<CommCorrection> => {
      const current = stateRef.current.corrections.find((row) => row.id === id);
      const captured = current === undefined ? {} : capturedFields(current, patch);
      return runOptimisticMutation({
        optimistic: () => {
          dispatch({ type: 'corrections', action: { type: 'patch', ids: [id], patch } });
        },
        apiCall,
        reconcile: (saved) => {
          dispatch({ type: 'corrections', action: { type: 'patch', ids: [id], patch: saved } });
        },
        rollback: () => {
          dispatch({ type: 'corrections', action: { type: 'patch', ids: [id], patch: captured } });
        },
        onError: () => {
          showToastRef.current(errorMessage);
        },
      });
    };

    return {
      writePerson,
      writeExample,
      patchPersonLocally(id, patch) {
        dispatch({ type: 'people', action: { type: 'patch', ids: [id], patch } });
      },
      upsertPeopleLocally(people) {
        dispatch({ type: 'people', action: { type: 'upsert', items: people } });
      },
      removePersonLocally(id) {
        dispatch({ type: 'people', action: { type: 'remove', ids: [id] } });
      },
      addRubricVersion(rubric) {
        dispatch({ type: 'addRubric', rubric });
      },
      patchExampleLocally(id, patch) {
        dispatch({ type: 'corrections', action: { type: 'patch', ids: [id], patch } });
      },
      async createPerson(input) {
        try {
          const saved = await createCommPerson(input);
          dispatch({ type: 'people', action: { type: 'upsert', items: [saved] } });
          return saved;
        } catch (error) {
          // The likeliest failure is a handle another person already claims, which the roster's
          // one-address-one-human rule refuses — say so without echoing the server's wording.
          showToastRef.current("Couldn't add that person — is a handle already listed?");
          throw error;
        }
      },
      async updatePerson(id, patch) {
        // The wire shape's optional fields can't be a `Partial<row>` under
        // exactOptionalPropertyTypes, so the same helper the route uses builds the sparse patch.
        const optimistic = toUpdatePayload<CommPersonWithHandles>(patch, [
          'name',
          'priority',
          'notes',
        ]);
        return writePerson(
          id,
          optimistic,
          () => updateCommPerson(id, patch),
          "Couldn't save that person",
        );
      },
      async deletePerson(id) {
        const previous = stateRef.current.people.find((person) => person.id === id);
        // No reconcile: on success the row is gone and there is nothing left to swap. Rollback
        // re-adds the WHOLE captured person, handles included, since the delete took them too.
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'people', action: { type: 'remove', ids: [id] } });
          },
          apiCall: () => deleteCommPerson(id),
          rollback: () => {
            if (previous !== undefined) {
              dispatch({ type: 'people', action: { type: 'upsert', items: [previous] } });
            }
          },
          onError: () => {
            showToastRef.current("Couldn't remove that person");
          },
        });
      },
      async addHandle(personId, input) {
        let saved: CommHandle;
        try {
          saved = await addCommHandle(personId, input);
        } catch (error) {
          showToastRef.current("Couldn't add that handle — is it already listed?");
          throw error;
        }
        const person = stateRef.current.people.find((row) => row.id === personId);
        // A handle for a person this tab no longer holds is dropped, like every other patch.
        if (person !== undefined) {
          dispatch({
            type: 'people',
            action: {
              type: 'patch',
              ids: [personId],
              patch: { comm_handles: [...person.comm_handles, saved] },
            },
          });
        }
        return saved;
      },
      async removeHandle(personId, handleId) {
        const captured = stateRef.current.people.find((row) => row.id === personId)?.comm_handles;
        await runOptimisticMutation({
          optimistic: () => {
            if (captured !== undefined) {
              dispatch({
                type: 'people',
                action: {
                  type: 'patch',
                  ids: [personId],
                  patch: { comm_handles: captured.filter((row) => row.id !== handleId) },
                },
              });
            }
          },
          apiCall: () => deleteCommHandle(handleId),
          rollback: () => {
            if (captured !== undefined) {
              dispatch({
                type: 'people',
                action: { type: 'patch', ids: [personId], patch: { comm_handles: captured } },
              });
            }
          },
          onError: () => {
            showToastRef.current("Couldn't remove that handle");
          },
        });
      },
      async saveRubric(body) {
        try {
          const saved = await createCommRubricVersion({ body });
          dispatch({ type: 'addRubric', rubric: saved });
          return saved;
        } catch (error) {
          showToastRef.current("Couldn't save the rubric");
          throw error;
        }
      },
      async setExamplePruned(id, pruned) {
        // Both prune columns move together, matching the route: the restore has to clear the
        // stamp the trigger wrote, or the card would read as pruned-but-still-in-the-set.
        const patch: Partial<CommCorrection> = pruned
          ? { pruned_at: new Date().toISOString() }
          : { pruned_at: null, pruned_version: null };
        return writeExample(
          id,
          patch,
          () => pruneCommExample(id, pruned),
          pruned ? "Couldn't prune that example" : "Couldn't restore that example",
        );
      },
    };
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — a non-empty literal dep array holds a constant string that is Object.is-equal every render, so React never recomputes this memo; identical to [].
  }, []);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** The roster, each person carrying their handles. Throws outside a CommsSettingsProvider. */
export function useCommsPeople(): CommPersonWithHandles[] {
  return useStateValue('useCommsPeople').people;
}

/** Every rubric version, newest first — the history a stamped verdict version resolves against. */
export function useCommsRubrics(): CommRubric[] {
  return useStateValue('useCommsRubrics').rubrics;
}

/** The rubric in force: the newest version, or `undefined` before one has ever been written. */
export function useCurrentRubric(): CommRubric | undefined {
  return useStateValue('useCurrentRubric').rubrics[0];
}

/** Every recorded correction, newest first — the prompt's example set, as the owner sees it. */
export function useCommsExamples(): CommCorrection[] {
  return useStateValue('useCommsExamples').corrections;
}

/** The settings mutation actions. Throws outside a CommsSettingsProvider. */
export function useCommsSettingsActions(): CommsSettingsActions {
  return useActions('useCommsSettingsActions');
}
