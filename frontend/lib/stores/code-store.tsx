'use client';

import type { RealtimePostgresUpdatePayload } from '@supabase/supabase-js';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { LAUNCH_TARGET_STATE, type LaunchPhase } from '@/lib/code/launch';
import { buildBypassUrl, buildImplementationUrl, buildRefinementUrl } from '@/lib/code/links';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import { useToastActions } from '@/lib/stores/toast-store';
import { createClient } from '@/lib/supabase/client';
import { makeOptimisticEpic, makeOptimisticProject, makeOptimisticStory, tempId } from '@/lib/tree';
import type { CodeFactoryState, CodeItem, CodeStory, Epic, Project } from '@/lib/types';

/**
 * Code store — the source of truth for the Software Factory module (projects, epics,
 * code stories). Mirrors `folders-store` / `tasks-store`: mounted once at the (code)
 * layout and seeded from server reads (`lib/data/code.ts`); the board reads via hooks and
 * never fetches (see the data-flow skill). Mutations edit the seeded slices instantly and
 * reconcile with the server row(s), rolling back on error.
 *
 * Cross-module note (the gate): since ALF-27 the CodeProvider is seeded once at the shared
 * shell layout, so it wraps the Tasks view too — and module switching no longer re-seeds the
 * board from the server. The gate therefore routes its creates and the gated story THROUGH
 * these actions (createProject / createEpic / convertTaskToCode) so a gate-from-Tasks story
 * appears on the board without a refetch, instead of relying on the old cross-group re-seed.
 */

// ── The happy-path swimlanes, in board order. ──
// blocked/abandoned are NOT columns — they surface via a card treatment + filter,
// so they're excluded from the lane list deliberately.
export const HAPPY_PATH_STATES = [
  'needs_refinement',
  'in_refinement',
  'ready_for_dev',
  'in_development',
  'ready_for_review',
  'done',
] as const satisfies readonly CodeFactoryState[];

export type HappyPathState = (typeof HAPPY_PATH_STATES)[number];

/** Human-readable swimlane heading per happy-path state. */
export const STATE_LABELS: Record<HappyPathState, string> = {
  needs_refinement: 'Needs Refinement',
  in_refinement: 'In Refinement',
  ready_for_dev: 'Ready for Dev',
  in_development: 'In Development',
  ready_for_review: 'Ready for Review',
  done: 'Done',
};

/** The off-board escape states — rendered via a card treatment + filter, never a column. */
export function isEscapeState(state: CodeFactoryState | null): boolean {
  return state === 'blocked' || state === 'abandoned';
}

/**
 * Display label for ANY factory state — the six happy-path lanes plus the off-board escape
 * states (Blocked / Abandoned, which have no lane). The realtime swimlane-move notification
 * needs a label for whatever state a transition lands in, so it can't use the lane-only
 * `STATE_LABELS`.
 */
export const FACTORY_STATE_LABELS: Record<CodeFactoryState, string> = {
  ...STATE_LABELS,
  blocked: 'Blocked',
  abandoned: 'Abandoned',
};

/** One swimlane: a happy-path state and the stories currently in it (ref order). */
export interface BoardLane {
  state: HappyPathState;
  label: string;
  stories: CodeStory[];
}

/** One epic on the board: its row plus its swimlanes and any escape-state stories. */
export interface BoardEpic {
  epic: Epic;
  /** The 6 happy-path swimlanes, always present and in board order (may be empty). */
  lanes: BoardLane[];
  /** Stories in `blocked`/`abandoned` — surfaced via the filter toggle, not a lane. */
  escapeStories: CodeStory[];
}

/** The derived board for one project: active epics (with lanes) + the archived ones. */
export interface ProjectBoard {
  project: Project | undefined;
  /** Non-archived epics, oldest first, each grouped into swimlanes. */
  activeEpics: BoardEpic[];
  /** Archived epics (hidden by default; revealed by the Show-archived toggle). */
  archivedEpics: BoardEpic[];
}

/** What the gate (or ProjectNav `+`) needs to optimistically create a project. */
export interface CreateProjectInput {
  name: string;
  github_url: string;
  key: string;
}

/**
 * Mutation actions for the code module — the optimistic + reconcile/rollback recipe
 * (data-flow skill), mirroring `tasks-store`.
 *
 * SEAM: `updateEpic` (notes + archive/un-archive) is a later addition. The reducer already
 * supports the moves it needs (`patchEpic`), so it slots in as a `useCodeActions` member without
 * further store surgery.
 */
export interface CodeActions {
  /** Optimistically add a project, then reconcile with the saved row. */
  createProject: (input: CreateProjectInput) => Promise<Project>;
  /** Optimistically add an epic (the `create_epic` RPC allocates its ref), then reconcile. */
  createEpic: (projectId: string, name: string) => Promise<Epic>;
  /**
   * The gate from within the Code view: admit an item already known here to the
   * factory. Inserts an optimistic story card and reconciles with the allocated ref.
   */
  enterCodeModule: (itemId: string, projectId: string, epicId: string) => Promise<CodeStory>;
  /**
   * Convert a task surfaced inside the Code view into a code story — same RPC + same
   * optimistic insert as `enterCodeModule`; distinct name so the call site reads as the
   * "Convert to Code Story" intent.
   */
  convertTaskToCode: (
    item: { id: string; title: string; notes: string | null; source_url: string | null },
    projectId: string,
    epicId: string,
  ) => Promise<CodeStory>;
  /**
   * Create a brand-new story directly into an epic from the board's `+` (no inbox item).
   * Mints a temporary item id for the optimistic card (the real `item_id` is server-allocated,
   * unlike the gate where the item already exists), then reconciles by swapping the temp row
   * for the saved one — replacing `item_id` (temp → server uuid) along with the allocated ref.
   * The target project is derived from the epic, so the caller passes only the epic.
   */
  createStory: (epicId: string, title: string, notes: string | null) => Promise<CodeStory>;
  /**
   * Edit an epic's header fields: `name` (inline rename), `notes` and `archived_at`
   * (set to archive, `null` to un-archive — archiving drops the epic off the active board).
   * Optimistically patches the epic via the reducer's `patchEpic`, then reconciles with the
   * saved row, rolling the touched fields back on error.
   */
  updateEpic: (
    epicId: string,
    patch: { name?: string; notes?: string | null; archived_at?: string | null },
  ) => Promise<void>;
  /**
   * Edit a code story's title (shown in the detail-modal header). The title lives on the `items` row, so this
   * PATCHes the item via `lib/api-client.updateItem` and reflects it on the board via the
   * reducer's `patchStory`, rolling back the prior title on error.
   */
  updateStoryTitle: (itemId: string, title: string) => Promise<void>;
  /**
   * Edit a code story's notes (shown in the detail-modal body). Notes live on the `items` row;
   * pass `null` to clear. PATCHes via `lib/api-client.updateItem` and optimistically reflects
   * the change via the reducer's `patchStory`, rolling back on error.
   */
  updateStoryNotes: (itemId: string, notes: string | null) => Promise<void>;
  /**
   * Transition a story to a new factory state, keyed by its `ref`. Optimistically
   * patches the card into its new swimlane, then reconciles with the saved row (rolling the
   * state back on error). Used by manual controls and as the write inside `openClaudeSession`.
   * `extra` carries companion fields like `blocked_reason` (the Block control).
   */
  updateCodeState: (
    ref: string,
    factoryState: CodeFactoryState,
    extra?: api.UpdateCodeStateExtra,
  ) => Promise<void>;
  /**
   * Move a code story to a different epic in the same project, keyed by its `ref`. The board
   * re-homes the card the instant `epic_id` changes (`buildEpicBoard` filters on it).
   * Optimistically patches `epic_id` + the denormalised `epic_name`/`epic_ref`/
   * `epic_archived_at` (the board read carries these but the saved sidecar does not, so they
   * come from the target epic already in the store), then reconciles with the saved row,
   * rolling all four fields back on error.
   */
  moveStoryToEpic: (ref: string, epicId: string) => Promise<void>;
  /**
   * The human launch: show-spinner → AWAIT the state write → open the prefilled
   * Claude Code tab. Awaiting before `window.open` eliminates the "looks launched but didn't
   * persist" edge — the tab only opens once the transition is durable. The URL is derived
   * from the story + its project (`lib/code/links`), so the detail modal reuses this verbatim.
   */
  openClaudeSession: (ref: string, phase: LaunchPhase) => Promise<void>;
}

interface CodeState {
  projects: Project[];
  epics: Epic[];
  stories: CodeStory[];
}

type CodeAction =
  | { type: 'insertProject'; project: Project }
  | { type: 'replaceProject'; id: string; project: Project }
  | { type: 'removeProject'; id: string }
  | { type: 'insertEpic'; epic: Epic }
  | { type: 'replaceEpic'; id: string; epic: Epic }
  | { type: 'patchEpic'; id: string; patch: Partial<Epic> }
  | { type: 'removeEpic'; id: string }
  | { type: 'insertStory'; story: CodeStory }
  | { type: 'replaceStory'; itemId: string; story: CodeStory }
  | { type: 'patchStory'; itemId: string; patch: Partial<CodeStory> }
  | { type: 'removeStory'; itemId: string };

/**
 * Pure reducer over the three code slices. Each `replace`/`patch`/`remove` is keyed by id
 * and is a no-op when the id is absent — the race rule: a reconcile for a row already
 * removed adds nothing back.
 */
export function codeReducer(state: CodeState, action: CodeAction): CodeState {
  switch (action.type) {
    case 'insertProject': {
      return { ...state, projects: [...state.projects, action.project] };
    }
    case 'replaceProject': {
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.id ? action.project : p)),
      };
    }
    case 'removeProject': {
      return { ...state, projects: state.projects.filter((p) => p.id !== action.id) };
    }
    case 'insertEpic': {
      return { ...state, epics: [...state.epics, action.epic] };
    }
    case 'replaceEpic': {
      return { ...state, epics: state.epics.map((e) => (e.id === action.id ? action.epic : e)) };
    }
    case 'patchEpic': {
      return {
        ...state,
        epics: state.epics.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e)),
      };
    }
    case 'removeEpic': {
      return { ...state, epics: state.epics.filter((e) => e.id !== action.id) };
    }
    case 'insertStory': {
      return { ...state, stories: [...state.stories, action.story] };
    }
    case 'replaceStory': {
      return {
        ...state,
        stories: state.stories.map((s) => (s.item_id === action.itemId ? action.story : s)),
      };
    }
    case 'patchStory': {
      return {
        ...state,
        stories: state.stories.map((s) =>
          s.item_id === action.itemId ? { ...s, ...action.patch } : s,
        ),
      };
    }
    case 'removeStory': {
      return { ...state, stories: state.stories.filter((s) => s.item_id !== action.itemId) };
    }
    default: {
      return assertNever(action, 'code action');
    }
  }
}

/**
 * The sidecar fields a `code_items` row contributes to its flattened `CodeStory`. The single
 * source of truth for the sidecar→story projection: both `reconcileStory` (the optimistic
 * write path) and the realtime subscription (out-of-band Worker writes) patch a story through
 * this one mapping. Pure and exported so it's unit-testable on its own.
 */
export function codeItemToStoryPatch(row: CodeItem): Partial<CodeStory> {
  return {
    ref: row.ref,
    ref_number: row.ref_number,
    factory_state: row.factory_state,
    lane: row.lane,
    spec_path: row.spec_path,
    spec_sha: row.spec_sha,
    spec_markdown: row.spec_markdown,
    refinement_pr_url: row.refinement_pr_url,
    implementation_pr_url: row.implementation_pr_url,
    blocked_reason: row.blocked_reason,
    code_created_at: row.created_at,
    code_updated_at: row.updated_at,
  };
}

/** Reconcile the optimistic story with the server sidecar (real ref/ref_number/state). */
function reconcileStory(optimistic: CodeStory, saved: CodeItem): CodeStory {
  return { ...optimistic, ...codeItemToStoryPatch(saved) };
}

// The board reads the three slices through SEPARATE contexts (a deliberate re-render
// optimization: a projects-only consumer doesn't re-render when stories change), so each
// slice gets its own state context via the factory. The factory always pairs a state +
// actions context; we take the actions half from the projects pair and ignore the unused
// state halves of the epics/stories pairs.
const {
  StateContext: CodeProjectsContext,
  ActionsContext: CodeActionsContext,
  useStateValue: useProjectsValue,
  useActions: useCodeActionsValue,
} = createContextPair<Project[], CodeActions>('a CodeProvider');
const { StateContext: CodeEpicsContext, useStateValue: useEpicsValue } = createContextPair<
  Epic[],
  never
>('a CodeProvider');
const { StateContext: CodeStoriesContext, useStateValue: useStoriesValue } = createContextPair<
  CodeStory[],
  never
>('a CodeProvider');

export function CodeProvider({
  initialProjects,
  initialEpics,
  initialStories,
  children,
}: {
  initialProjects: Project[];
  initialEpics: Epic[];
  initialStories: CodeStory[];
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(codeReducer, {
    projects: initialProjects,
    epics: initialEpics,
    stories: initialStories,
  });

  // Latest state, readable inside the stable action closures so they can capture
  // pre-mutation rows for rollback without going stale (synced via an effect, not a
  // render-body write — actions fire from user events after commit, so it's current).
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const { showToast } = useToastActions();

  // Live swimlane updates. The webhook Worker (and any other device/tab) writes a story's
  // factory_state out of band, never touching this tab's store — so subscribe to the base
  // `code_items` table (you can't subscribe to the `v_code_stories` view the board reads)
  // and feed each UPDATE through the SAME sidecar→story projection the reconcile uses.
  // `patchStory` is keyed by `item_id` and a no-op when absent (the race rule), so a change
  // for a story this tab doesn't hold — or one already removed — is harmlessly ignored, and
  // an echo of the user's own optimistic write re-applies identical values (idempotent).
  React.useEffect(() => {
    const supabase = createClient();

    // Tab-title marker state for transitions that land while the tab is backgrounded.
    // Capture the original title once so the restore is exact and doesn't fight a route title.
    let savedTitle: string | null = null;
    let hiddenUpdates = 0;
    const restoreTitle = () => {
      if (savedTitle !== null) {
        document.title = savedTitle;
        savedTitle = null;
        hiddenUpdates = 0;
      }
    };
    const handleVisible = () => {
      if (!document.hidden) restoreTitle();
    };

    const handleUpdate = (payload: RealtimePostgresUpdatePayload<CodeItem>) => {
      const row = payload.new;
      // Compute the prior state BEFORE dispatching: a real external move is one whose stored
      // state differs from the incoming row. A self-write echo already set the new state
      // optimistically, so `previous === next` and nothing fires — the same idempotent-echo
      // reasoning that keeps the board stable (no flicker, no double notification).
      const previous = stateRef.current.stories.find((story) => story.item_id === row.item_id);
      const changedState = previous !== undefined && previous.factory_state !== row.factory_state;
      dispatch({ type: 'patchStory', itemId: row.item_id, patch: codeItemToStoryPatch(row) });
      if (!changedState) return;

      const label = FACTORY_STATE_LABELS[row.factory_state];
      showToast(`${row.ref} moved to ${label}`, 'emphasis');
      // A glanceable marker for moves that arrive while the user is on another tab.
      if (document.hidden) {
        savedTitle ??= document.title;
        hiddenUpdates += 1;
        document.title =
          hiddenUpdates === 1
            ? `● ${row.ref} → ${label}`
            : `(${String(hiddenUpdates)}) updates · ${row.ref} → ${label}`;
      }
    };

    const channel = supabase
      .channel('code_items')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'code_items' },
        handleUpdate,
      )
      .subscribe();

    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);

    return () => {
      void supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
      restoreTitle();
    };
  }, [showToast]);

  const actions = React.useMemo<CodeActions>(() => {
    // Shared insert-optimistic-then-reconcile path for both gate entry points (the
    // "Send to Code module" and "Convert to Code Story"), so neither relies on `this`.
    async function admitToFactory(
      item: { id: string; title: string; notes: string | null; source_url: string | null },
      projectId: string,
      epicId: string,
    ): Promise<CodeStory> {
      const { projects, epics } = stateRef.current;
      const project = projects.find((p) => p.id === projectId);
      const epic = epics.find((e) => e.id === epicId);
      if (project === undefined || epic === undefined) {
        // Can't build the optimistic card without its project/epic — should not happen
        // from the Code view, where both are seeded. Surface as an error.
        throw new Error('Project or epic missing from the code store');
      }
      const optimistic = makeOptimisticStory(item, project, epic);
      let reconciled: CodeStory = optimistic;
      await runOptimisticMutation({
        optimistic: () => {
          dispatch({ type: 'insertStory', story: optimistic });
        },
        apiCall: () => api.enterCodeModule(item.id, projectId, epicId),
        reconcile: (saved) => {
          reconciled = reconcileStory(optimistic, saved);
          dispatch({ type: 'replaceStory', itemId: item.id, story: reconciled });
        },
        rollback: () => {
          dispatch({ type: 'removeStory', itemId: item.id });
        },
      });
      return reconciled;
    }

    // Shared optimistic state transition, so `openClaudeSession` reuses it without
    // relying on `this` (matching `admitToFactory`'s extraction rationale above).
    async function transitionState(
      ref: string,
      factoryState: CodeFactoryState,
      extra: api.UpdateCodeStateExtra,
    ): Promise<void> {
      const previous = stateRef.current.stories.find((s) => s.ref === ref);
      if (previous === undefined) {
        throw new Error(`Code story ${ref} not found in the code store`);
      }
      // `v_code_stories` is a view, so its generated row type is all-nullable; a seeded story
      // always has a real item_id (the inner-join guarantee), but narrow it for the dispatch
      // key the reducer expects.
      const itemId = previous.item_id;
      if (itemId === null) {
        throw new Error(`Code story ${ref} has no item_id`);
      }
      // Capture the fields a transition touches so a failure restores exactly them.
      const rollback: Partial<CodeStory> = {
        factory_state: previous.factory_state,
        blocked_reason: previous.blocked_reason,
      };
      const optimistic: Partial<CodeStory> = { factory_state: factoryState };
      if (extra.blocked_reason !== undefined) optimistic.blocked_reason = extra.blocked_reason;
      await runOptimisticMutation({
        optimistic: () => {
          dispatch({ type: 'patchStory', itemId, patch: optimistic });
        },
        apiCall: () => api.updateCodeState(ref, factoryState, extra),
        reconcile: (saved) => {
          dispatch({
            type: 'patchStory',
            itemId,
            patch: {
              factory_state: saved.factory_state,
              blocked_reason: saved.blocked_reason,
              code_updated_at: saved.updated_at,
            },
          });
        },
        rollback: () => {
          dispatch({ type: 'patchStory', itemId, patch: rollback });
        },
      });
    }

    return {
      async createProject(input) {
        const optimistic = makeOptimisticProject(input);
        dispatch({ type: 'insertProject', project: optimistic });
        try {
          const saved = await api.createProject(input);
          dispatch({ type: 'replaceProject', id: optimistic.id, project: saved });
          return saved;
        } catch (error) {
          dispatch({ type: 'removeProject', id: optimistic.id });
          throw error;
        }
      },
      async createEpic(projectId, name) {
        const optimistic = makeOptimisticEpic(projectId, name);
        dispatch({ type: 'insertEpic', epic: optimistic });
        try {
          const saved = await api.createEpic(projectId, name);
          dispatch({ type: 'replaceEpic', id: optimistic.id, epic: saved });
          return saved;
        } catch (error) {
          dispatch({ type: 'removeEpic', id: optimistic.id });
          throw error;
        }
      },
      enterCodeModule(itemId, projectId, epicId) {
        const story = stateRef.current.stories.find((s) => s.item_id === itemId);
        const item = {
          id: itemId,
          title: story?.title ?? '',
          notes: story?.notes ?? null,
          source_url: story?.source_url ?? null,
        };
        return admitToFactory(item, projectId, epicId);
      },
      convertTaskToCode(item, projectId, epicId) {
        return admitToFactory(item, projectId, epicId);
      },
      async createStory(epicId, title, notes) {
        const { projects, epics } = stateRef.current;
        const epic = epics.find((e) => e.id === epicId);
        if (epic === undefined) {
          throw new Error(`Epic ${epicId} not found in the code store`);
        }
        const project = projects.find((p) => p.id === epic.project_id);
        if (project === undefined) {
          throw new Error(`Project ${epic.project_id} not found in the code store`);
        }
        // The item is server-allocated, so the optimistic card carries a TEMP item id that
        // the reconcile swaps for the real uuid (unlike the gate, where the item exists).
        const tempItemId = tempId();
        const optimistic = makeOptimisticStory(
          { id: tempItemId, title, notes, source_url: null },
          project,
          epic,
        );
        let reconciled: CodeStory = optimistic;
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'insertStory', story: optimistic });
          },
          apiCall: () => api.createCodeStory(epic.project_id, epicId, title, notes),
          reconcile: (saved) => {
            // Reconcile the sidecar fields AND replace the temp item_id with the server uuid
            // (the temp-id row is keyed out via `replaceStory`'s itemId).
            reconciled = { ...reconcileStory(optimistic, saved), item_id: saved.item_id };
            dispatch({ type: 'replaceStory', itemId: tempItemId, story: reconciled });
          },
          rollback: () => {
            dispatch({ type: 'removeStory', itemId: tempItemId });
          },
        });
        return reconciled;
      },
      updateCodeState(ref, factoryState, extra = {}) {
        return transitionState(ref, factoryState, extra);
      },
      async moveStoryToEpic(ref, epicId) {
        const story = stateRef.current.stories.find((s) => s.ref === ref);
        if (story === undefined) {
          throw new Error(`Code story ${ref} not found in the code store`);
        }
        // `v_code_stories` is a view (all-nullable row type); a seeded story always has a real
        // item_id (the inner-join guarantee), but narrow it for the dispatch key.
        const itemId = story.item_id;
        if (itemId === null) {
          throw new Error(`Code story ${ref} has no item_id`);
        }
        const target = stateRef.current.epics.find((e) => e.id === epicId);
        if (target === undefined) {
          throw new Error(`Epic ${epicId} not found in the code store`);
        }
        // The board read carries denormalised epic fields the saved sidecar does NOT return,
        // so source them from the target epic in the store and capture the prior values for
        // rollback.
        const rollback: Partial<CodeStory> = {
          epic_id: story.epic_id,
          epic_name: story.epic_name,
          epic_ref: story.epic_ref,
          epic_archived_at: story.epic_archived_at,
        };
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({
              type: 'patchStory',
              itemId,
              patch: {
                epic_id: target.id,
                epic_name: target.name,
                epic_ref: target.ref,
                epic_archived_at: target.archived_at,
              },
            });
          },
          apiCall: () => api.moveCodeEpic(ref, epicId),
          reconcile: (saved) => {
            // The saved sidecar confirms only epic_id (+ the timestamp); the denormalised
            // name/ref/archived_at were already applied from the store's epic.
            dispatch({
              type: 'patchStory',
              itemId,
              patch: { epic_id: saved.epic_id, code_updated_at: saved.updated_at },
            });
          },
          rollback: () => {
            dispatch({ type: 'patchStory', itemId, patch: rollback });
          },
        });
      },
      async updateEpic(epicId, patch) {
        const previous = stateRef.current.epics.find((e) => e.id === epicId);
        if (previous === undefined) {
          throw new Error(`Epic ${epicId} not found in the code store`);
        }
        // Capture exactly the fields this patch touches so a failure restores only them.
        const rollback: Partial<Epic> = {};
        const optimistic: Partial<Epic> = {};
        if (patch.name !== undefined) {
          rollback.name = previous.name;
          optimistic.name = patch.name;
        }
        if (patch.notes !== undefined) {
          rollback.notes = previous.notes;
          optimistic.notes = patch.notes;
        }
        if (patch.archived_at !== undefined) {
          rollback.archived_at = previous.archived_at;
          optimistic.archived_at = patch.archived_at;
        }
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'patchEpic', id: epicId, patch: optimistic });
          },
          apiCall: () => api.updateEpic(epicId, patch),
          reconcile: (saved) => {
            dispatch({
              type: 'patchEpic',
              id: epicId,
              patch: { name: saved.name, notes: saved.notes, archived_at: saved.archived_at },
            });
          },
          rollback: () => {
            dispatch({ type: 'patchEpic', id: epicId, patch: rollback });
          },
        });
      },
      async updateStoryTitle(itemId, title) {
        const previous = stateRef.current.stories.find((s) => s.item_id === itemId);
        if (previous === undefined) {
          throw new Error(`Code story ${itemId} not found in the code store`);
        }
        const rollback: Partial<CodeStory> = { title: previous.title };
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'patchStory', itemId, patch: { title } });
          },
          apiCall: () => api.updateItem(itemId, { title }),
          reconcile: (saved) => {
            dispatch({ type: 'patchStory', itemId, patch: { title: saved.title } });
          },
          rollback: () => {
            dispatch({ type: 'patchStory', itemId, patch: rollback });
          },
        });
      },
      async updateStoryNotes(itemId, notes) {
        const previous = stateRef.current.stories.find((s) => s.item_id === itemId);
        if (previous === undefined) {
          throw new Error(`Code story ${itemId} not found in the code store`);
        }
        const rollback: Partial<CodeStory> = { notes: previous.notes };
        await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'patchStory', itemId, patch: { notes } });
          },
          apiCall: () => api.updateItem(itemId, { notes }),
          reconcile: (saved) => {
            dispatch({ type: 'patchStory', itemId, patch: { notes: saved.notes } });
          },
          rollback: () => {
            dispatch({ type: 'patchStory', itemId, patch: rollback });
          },
        });
      },
      async openClaudeSession(ref, phase) {
        const story = stateRef.current.stories.find((s) => s.ref === ref);
        if (story === undefined) {
          throw new Error(`Code story ${ref} not found in the code store`);
        }
        const project = stateRef.current.projects.find((p) => p.id === story.project_id);
        if (project === undefined) {
          throw new Error(`Project for story ${ref} missing from the code store`);
        }
        // Build the prefill URL up front (pure, from stored data) so a write failure leaves
        // nothing half-done. Await the transition BEFORE opening — the tab only appears once
        // the move is durable.
        const buildUrlForPhase: Record<LaunchPhase, () => string> = {
          refinement: () => buildRefinementUrl(project, story),
          implementation: () => buildImplementationUrl(project, story),
          bypass: () => buildBypassUrl(project, story),
        };
        const url = buildUrlForPhase[phase]();
        await transitionState(ref, LAUNCH_TARGET_STATE[phase], {});
        window.open(url, '_blank');
      },
    };
  }, []);

  return (
    <CodeActionsContext.Provider value={actions}>
      <CodeProjectsContext.Provider value={state.projects}>
        <CodeEpicsContext.Provider value={state.epics}>
          <CodeStoriesContext.Provider value={state.stories}>
            {children}
          </CodeStoriesContext.Provider>
        </CodeEpicsContext.Provider>
      </CodeProjectsContext.Provider>
    </CodeActionsContext.Provider>
  );
}

/** Read the project list (ProjectNav). Throws outside a CodeProvider. */
export function useProjects(): Project[] {
  return useProjectsValue('useProjects');
}

function useCodeEpics(): Epic[] {
  return useEpicsValue('useCodeEpics');
}

/** Read the epic list (the gate's epic picker filters it by project). Throws outside a CodeProvider. */
export function useEpics(): Epic[] {
  return useCodeEpics();
}

function useCodeStories(): CodeStory[] {
  return useStoriesValue('useCodeStories');
}

/** Group one epic's stories into the 6 happy-path swimlanes + the escape-state bucket. */
function buildEpicBoard(epic: Epic, stories: CodeStory[]): BoardEpic {
  const forEpic = stories.filter((story) => story.epic_id === epic.id);
  const lanes = HAPPY_PATH_STATES.map<BoardLane>((state) => ({
    state,
    label: STATE_LABELS[state],
    stories: forEpic.filter((story) => story.factory_state === state),
  }));
  const escapeStories = forEpic.filter((story) => isEscapeState(story.factory_state));
  return { epic, lanes, escapeStories };
}

/**
 * Derive the board for one project: its active epics grouped into swimlanes, plus its
 * archived epics (for the Show-archived toggle). Memoized on the store slices + projectId
 * so it only recomputes when the data or the selected project changes.
 */
export function useProjectBoard(projectId: string): ProjectBoard {
  const projects = useProjects();
  const epics = useCodeEpics();
  const stories = useCodeStories();

  return React.useMemo<ProjectBoard>(() => {
    const project = projects.find((candidate) => candidate.id === projectId);
    const projectEpics = epics.filter((epic) => epic.project_id === projectId);
    const activeEpics = projectEpics
      .filter((epic) => epic.archived_at === null)
      .map((epic) => buildEpicBoard(epic, stories));
    const archivedEpics = projectEpics
      .filter((epic) => epic.archived_at !== null)
      .map((epic) => buildEpicBoard(epic, stories));
    return { project, activeEpics, archivedEpics };
  }, [projects, epics, stories, projectId]);
}

/** Read the code mutation actions (the gate / ProjectNav `+`). Throws outside a CodeProvider. */
export function useCodeActions(): CodeActions {
  return useCodeActionsValue('useCodeActions');
}
