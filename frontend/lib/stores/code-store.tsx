'use client';

import * as React from 'react';

import type { CodeFactoryState, CodeStory, Epic, Project } from '@/lib/types';

/**
 * Code store — the source of truth for the Software Factory module (projects, epics,
 * code stories). Mirrors `folders-store` / `tasks-store`: mounted once at the (code)
 * layout and seeded from server reads (`lib/data/code.ts`); the board reads via hooks and
 * never fetches (see the data-flow skill).
 *
 * READ-only this milestone (M3): the store holds the data and exposes `useProjects` /
 * `useProjectBoard`. The mutation seam is wired but inert — see `useCodeActions` and the
 * SEAM note on `CodeActions` for what lands in M4–M6.
 */

// ── The happy-path swimlanes, in board order (§9.2). ──
// blocked/abandoned are NOT columns — they surface via a card treatment + filter (§9.2),
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

/**
 * Mutation actions for the code module.
 *
 * SEAM (M4–M6): the optimistic actions land here, each following the `tasks-store` recipe
 * (optimistic dispatch → `lib/api-client` → reconcile/rollback):
 *   - createProject / createEpic           (M4 — the New-project / New-epic dialogs)
 *   - enterCodeModule / convertTaskToCode  (M4 — the gate)
 *   - updateEpic                           (M4 — notes + archive/un-archive)
 *   - updateCodeState                      (M5/M6 — link-click write + manual controls)
 *   - openClaudeSession                    (M5 — await-write-then-open)
 * Add the reducer + dispatch alongside them then (mirror `tasksReducer`), swap the seeds
 * in `CodeProvider` for `useReducer` state, and populate the `value` below. The read hooks
 * (`useProjects` / `useProjectBoard`) don't change.
 */
export interface CodeActions {
  /**
   * Placeholder so the actions context has a non-empty contract until M4. It is never set
   * to `true` in M3 (no mutations exist yet); the real actions replace it. Reading it lets
   * a future descendant feature-detect that the actions layer is wired before M4 fills it.
   */
  readonly ready: boolean;
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
  // M3 is read-only, so the seeds are the session state as-is. M4 swaps these for
  // useReducer state (see the CodeActions SEAM note) without changing the read hooks.
  const projects = initialProjects;
  const epics = initialEpics;
  const stories = initialStories;

  // Inert until M4: no mutations are wired yet, so `ready` stays false (see CodeActions).
  const actions = React.useMemo<CodeActions>(() => ({ ready: false }), []);

  return (
    <CodeActionsContext.Provider value={actions}>
      <CodeProjectsContext.Provider value={projects}>
        <CodeEpicsContext.Provider value={epics}>
          <CodeStoriesContext.Provider value={stories}>{children}</CodeStoriesContext.Provider>
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

/**
 * Read the code mutation actions (the M4–M6 seam). Throws outside a CodeProvider. Inert
 * this milestone (`ready: false`); see the `CodeActions` doc comment for what lands here.
 */
export function useCodeActions(): CodeActions {
  const context = React.useContext(CodeActionsContext);
  if (context === undefined) {
    throw new Error('useCodeActions must be used within a CodeProvider');
  }
  return context;
}
