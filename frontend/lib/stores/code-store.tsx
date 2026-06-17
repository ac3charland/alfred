'use client';

import * as React from 'react';

import * as api from '@/lib/api-client';
import { buildImplementationUrl, buildRefinementUrl } from '@/lib/code/links';
import { TEMP_ID_PREFIX } from '@/lib/tree';
import type { CodeFactoryState, CodeItem, CodeStory, Epic, Project } from '@/lib/types';

/**
 * Code store — the source of truth for the Software Factory module (projects, epics,
 * code stories). Mirrors `folders-store` / `tasks-store`: mounted once at the (code)
 * layout and seeded from server reads (`lib/data/code.ts`); the board reads via hooks and
 * never fetches (see the data-flow skill). Mutations edit the seeded slices instantly and
 * reconcile with the server row(s), rolling back on error.
 *
 * Cross-module note (the gate): the gate is also reachable from the Tasks view, which
 * is NOT wrapped by CodeProvider — so the gate dialog drives its OWN local project/epic
 * state and calls `lib/api-client` directly; it does not use these actions. These actions
 * exist for mutations made from WITHIN the Code view (ProjectNav's `+`, and conversions
 * surfaced on the board). The board re-seeds from the server on a real cross-group
 * navigation, so a gate-from-Tasks story shows up there without sharing this store (the
 * cross-group-navigation gotcha).
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
   * Edit a code story's notes from the detail modal. Notes live on the `items` row — PATCHes
   * via `lib/api-client.updateItem` and reflects via `patchStory`, rolling back on error.
   * Pass `null` to clear.
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
   * The human launch: show-spinner → AWAIT the state write → open the prefilled
   * Claude Code tab. Awaiting before `window.open` eliminates the "looks launched but didn't
   * persist" edge — the tab only opens once the transition is durable. The URL is derived
   * from the story + its project (`lib/code/links`), so the detail modal reuses this verbatim.
   */
  openClaudeSession: (ref: string, phase: 'refinement' | 'implementation') => Promise<void>;
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

function assertNever(value: never): never {
  throw new Error(`Unhandled code action: ${JSON.stringify(value)}`);
}

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
      return assertNever(action);
    }
  }
}

function tempId(): string {
  return `${TEMP_ID_PREFIX}${crypto.randomUUID()}`;
}

/** Build an optimistic project row (a temp id until the server row reconciles). */
function makeOptimisticProject(input: CreateProjectInput): Project {
  return {
    id: tempId(),
    name: input.name,
    key: input.key,
    // repo_owner/repo_name are derived server-side; show placeholders until reconcile.
    repo_owner: '',
    repo_name: '',
    github_url: input.github_url,
    ref_seq: 0,
    created_at: new Date().toISOString(),
  };
}

/** Build an optimistic epic row. The real ref/ref_number arrive from `create_epic`. */
function makeOptimisticEpic(projectId: string, name: string): Epic {
  return {
    id: tempId(),
    project_id: projectId,
    name,
    notes: null,
    ref_number: 0,
    ref: '',
    archived_at: null,
    created_at: new Date().toISOString(),
  };
}

/**
 * Build the optimistic flattened `CodeStory` (the board read shape) for an item entering
 * the factory, joining the known project + epic so the card renders immediately. The real
 * ref/ref_number arrive from `enter_code_module`.
 */
function makeOptimisticStory(
  item: { id: string; title: string; notes: string | null; source_url: string | null },
  project: Project,
  epic: Epic,
): CodeStory {
  const now = new Date().toISOString();
  return {
    item_id: item.id,
    project_id: project.id,
    epic_id: epic.id,
    ref_number: 0,
    ref: '',
    factory_state: 'needs_refinement',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    code_created_at: now,
    code_updated_at: now,
    title: item.title,
    notes: item.notes,
    source_url: item.source_url,
    item_created_at: now,
    project_key: project.key,
    project_name: project.name,
    repo_owner: project.repo_owner,
    repo_name: project.repo_name,
    epic_name: epic.name,
    epic_ref: epic.ref,
    epic_archived_at: epic.archived_at,
  };
}

/** Reconcile the optimistic story with the server sidecar (real ref/ref_number/state). */
function reconcileStory(optimistic: CodeStory, saved: CodeItem): CodeStory {
  return {
    ...optimistic,
    ref: saved.ref,
    ref_number: saved.ref_number,
    factory_state: saved.factory_state,
    lane: saved.lane,
    spec_path: saved.spec_path,
    spec_sha: saved.spec_sha,
    spec_markdown: saved.spec_markdown,
    refinement_pr_url: saved.refinement_pr_url,
    implementation_pr_url: saved.implementation_pr_url,
    blocked_reason: saved.blocked_reason,
    code_created_at: saved.created_at,
    code_updated_at: saved.updated_at,
  };
}

const CodeProjectsContext = React.createContext<Project[] | undefined>(undefined);
const CodeEpicsContext = React.createContext<Epic[] | undefined>(undefined);
const CodeStoriesContext = React.createContext<CodeStory[] | undefined>(undefined);
const CodeActionsContext = React.createContext<CodeActions | undefined>(undefined);

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
      dispatch({ type: 'insertStory', story: optimistic });
      try {
        const saved = await api.enterCodeModule(item.id, projectId, epicId);
        const reconciled = reconcileStory(optimistic, saved);
        dispatch({ type: 'replaceStory', itemId: item.id, story: reconciled });
        return reconciled;
      } catch (error) {
        dispatch({ type: 'removeStory', itemId: item.id });
        throw error;
      }
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
      dispatch({ type: 'patchStory', itemId, patch: optimistic });
      try {
        const saved = await api.updateCodeState(ref, factoryState, extra);
        dispatch({
          type: 'patchStory',
          itemId,
          patch: {
            factory_state: saved.factory_state,
            blocked_reason: saved.blocked_reason,
            code_updated_at: saved.updated_at,
          },
        });
      } catch (error) {
        dispatch({ type: 'patchStory', itemId, patch: rollback });
        throw error;
      }
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
      updateCodeState(ref, factoryState, extra = {}) {
        return transitionState(ref, factoryState, extra);
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
        dispatch({ type: 'patchEpic', id: epicId, patch: optimistic });
        try {
          const saved = await api.updateEpic(epicId, patch);
          dispatch({
            type: 'patchEpic',
            id: epicId,
            patch: { name: saved.name, notes: saved.notes, archived_at: saved.archived_at },
          });
        } catch (error) {
          dispatch({ type: 'patchEpic', id: epicId, patch: rollback });
          throw error;
        }
      },
      async updateStoryTitle(itemId, title) {
        const previous = stateRef.current.stories.find((s) => s.item_id === itemId);
        if (previous === undefined) {
          throw new Error(`Code story ${itemId} not found in the code store`);
        }
        const rollback: Partial<CodeStory> = { title: previous.title };
        dispatch({ type: 'patchStory', itemId, patch: { title } });
        try {
          const saved = await api.updateItem(itemId, { title });
          dispatch({ type: 'patchStory', itemId, patch: { title: saved.title } });
        } catch (error) {
          dispatch({ type: 'patchStory', itemId, patch: rollback });
          throw error;
        }
      },
      async updateStoryNotes(itemId, notes) {
        const previous = stateRef.current.stories.find((s) => s.item_id === itemId);
        if (previous === undefined) {
          throw new Error(`Code story ${itemId} not found in the code store`);
        }
        const rollback: Partial<CodeStory> = { notes: previous.notes };
        dispatch({ type: 'patchStory', itemId, patch: { notes } });
        try {
          const saved = await api.updateItem(itemId, { notes });
          dispatch({ type: 'patchStory', itemId, patch: { notes: saved.notes ?? null } });
        } catch (error) {
          dispatch({ type: 'patchStory', itemId, patch: rollback });
          throw error;
        }
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
        const url =
          phase === 'refinement'
            ? buildRefinementUrl(project, story)
            : buildImplementationUrl(project, story);
        const nextState: CodeFactoryState =
          phase === 'refinement' ? 'in_refinement' : 'in_development';
        await transitionState(ref, nextState, {});
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
  const context = React.useContext(CodeProjectsContext);
  if (context === undefined) {
    throw new Error('useProjects must be used within a CodeProvider');
  }
  return context;
}

function useCodeEpics(): Epic[] {
  const context = React.useContext(CodeEpicsContext);
  if (context === undefined) {
    throw new Error('useCodeEpics must be used within a CodeProvider');
  }
  return context;
}

function useCodeStories(): CodeStory[] {
  const context = React.useContext(CodeStoriesContext);
  if (context === undefined) {
    throw new Error('useCodeStories must be used within a CodeProvider');
  }
  return context;
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
  const context = React.useContext(CodeActionsContext);
  if (context === undefined) {
    throw new Error('useCodeActions must be used within a CodeProvider');
  }
  return context;
}
