import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { stableSorted } from '@/lib/sort';
import { CodeProvider, DEFAULT_BACKLOG_STATUSES, useBacklog } from '@/lib/stores/code-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { CodeItem, CodeStory, Epic, Project } from '@/lib/types';

import { BacklogList } from './backlog-list';

// ALF-250: a fuzz of the Backlog's single-chevron swaps (plus the project jumps) against a
// simulated server. The server is the real one's shape: each RPC lands after a network delay,
// runs atomically, answers after another delay, and echoes every row it wrote over realtime
// (in commit order, at its own pace). The user clicks at human speed; at every click the list
// they see must be the list their clicks so far describe, and once everything settles the
// server must hold that same order.
jest.mock('@/lib/api-client');
const mockReorderCode = jest.mocked(api.reorderCode);
const mockMoveCodeInProject = jest.mocked(api.moveCodeInProject);

let mockRealtimeHandler: ((payload: { new: CodeItem }) => void) | undefined;
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = {
      on: (_event: string, filter: { table?: string }, handler: (payload: never) => void) => {
        if (filter.table === 'code_items') {
          mockRealtimeHandler = handler as (payload: { new: CodeItem }) => void;
        }
        return channel;
      },
      subscribe: () => channel,
    };
    return {
      realtime: { setAuth: () => Promise.resolve() },
      channel: () => channel,
      removeChannel: () => Promise.resolve('ok'),
    };
  },
}));

const PROJECT: Project = {
  color: null,
  description: null,
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 5,
  created_at: '2025-01-01T00:00:00Z',
};
const OTHER_PROJECT: Project = { ...PROJECT, id: 'p2', key: 'RLP', name: 'Relay' };
const EPIC: Epic = {
  id: 'e1',
  project_id: 'p1',
  name: 'Epic',
  notes: null,
  ref_number: 1,
  ref: 'ALF-1',
  archived_at: null,
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  created_at: '2025-01-01T00:00:00Z',
};
const OTHER_EPIC: Epic = { ...EPIC, id: 'e2', project_id: 'p2', ref: 'RLP-1' };

/** One server row — just what the ranking reads. */
interface Row {
  itemId: string;
  ref: string;
  projectId: string;
  priority: number;
}

function toSidecar(row: Row): CodeItem {
  return {
    item_id: row.itemId,
    project_id: row.projectId,
    epic_id: row.projectId === 'p1' ? 'e1' : 'e2',
    ref_number: 1,
    ref: row.ref,
    factory_state: 'in_development',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    requires_refinement: true,
    done_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
    priority: row.priority,
  };
}

function toStory(row: Row): CodeStory {
  const sidecar = toSidecar(row);
  return {
    item_id: row.itemId,
    project_id: row.projectId,
    epic_id: sidecar.epic_id,
    ref_number: 1,
    ref: row.ref,
    factory_state: 'in_development',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    blocked_from: null,
    requires_refinement: true,
    code_created_at: sidecar.created_at,
    code_updated_at: sidecar.updated_at,
    title: `Story ${row.ref}`,
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: row.projectId === 'p1' ? 'ALF' : 'RLP',
    project_name: row.projectId === 'p1' ? 'Alfred' : 'Relay',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Epic',
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    epic_spec_path: null,
    priority: row.priority,
  };
}

/**
 * The ranking RPCs, over a plain row map: the `swap_code_priority` exchange and the
 * `move_code_priority_in_project` midpoint. Returns the rows it wrote, as the RPCs do.
 */
class Ranking {
  readonly rows: Map<string, Row>;

  constructor(rows: Row[]) {
    this.rows = new Map(rows.map((row) => [row.ref, { ...row }]));
  }

  private get(ref: string): Row {
    const row = this.rows.get(ref);
    if (row === undefined) throw new Error(`unknown ref ${ref}`);
    return row;
  }

  swap(a: string, b: string): Row[] {
    const rowA = this.get(a);
    const rowB = this.get(b);
    [rowA.priority, rowB.priority] = [rowB.priority, rowA.priority];
    return [{ ...rowA }, { ...rowB }];
  }

  moveInProject(ref: string, toTop: boolean): Row[] {
    const row = this.get(ref);
    const others = [...this.rows.values()].filter((other) => other.ref !== ref);
    const project = others.filter((o) => o.projectId === row.projectId).map((o) => o.priority);
    const all = others.map((o) => o.priority);
    if (project.length === 0) {
      row.priority = toTop ? Math.min(...all) - 1 : Math.max(...all) + 1;
    } else if (toTop) {
      const extreme = Math.min(...project);
      const above = all.filter((p) => p < extreme);
      row.priority = above.length === 0 ? extreme - 1 : (Math.max(...above) + extreme) / 2;
    } else {
      const extreme = Math.max(...project);
      const below = all.filter((p) => p > extreme);
      row.priority = below.length === 0 ? extreme + 1 : (Math.min(...below) + extreme) / 2;
    }
    return [{ ...row }];
  }

  /** The refs of `projectId`, best rank first — what the project-filtered Backlog lists. */
  order(projectId: string): string[] {
    return stableSorted(
      [...this.rows.values()].filter((row) => row.projectId === projectId),
      (x, y) => x.priority - y.priority,
    ).map((row) => row.ref);
  }
}

/** A small seeded PRNG (mulberry32), so a failing seed replays exactly. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * The server: each call reaches it after a random delay (so two calls in flight can land in
 * either order), runs atomically, answers after another delay, and echoes each row it wrote
 * over realtime — in commit order, but at a lag of its own that can trail the answer.
 */
function simulateServer(server: Ranking, random: () => number) {
  let lastEchoAt = 0;
  const delay = (max: number) => Math.floor(random() * max);

  function rpc(run: () => Row[]): Promise<CodeItem[]> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const written = run();
        lastEchoAt = Math.max(lastEchoAt, Date.now()) + delay(400);
        for (const row of written) {
          setTimeout(() => {
            act(() => {
              mockRealtimeHandler?.({ new: toSidecar(row) });
            });
          }, lastEchoAt - Date.now());
        }
        setTimeout(() => {
          resolve(written.map((row) => toSidecar(row)));
        }, delay(300));
      }, delay(300));
    });
  }

  mockReorderCode.mockImplementation((a, b) => rpc(() => server.swap(a, b)));
  mockMoveCodeInProject.mockImplementation((ref, toTop) =>
    rpc(() => server.moveInProject(ref, toTop)),
  );
}

/** The Backlog narrowed to project p1 — the filtered view the bug was reported from. */
function ProjectBacklog() {
  const stories = useBacklog({ statuses: DEFAULT_BACKLOG_STATUSES, projectIds: PROJECT_IDS });
  return <BacklogList stories={stories} emptyMessage="empty" />;
}
const PROJECT_IDS = ['p1'];
const SEEDS = Array.from({ length: 10 }, (_, index) => index + 1);

/** The rows on screen, top to bottom, read off each row's Up chevron label. */
function shownOrder(): string[] {
  return screen
    .getAllByLabelText(/^Move \S+ up$/)
    .map((button) => /^Move (\S+) up$/.exec(button.getAttribute('aria-label') ?? '')?.[1] ?? '');
}

/** p1's six stories interleaved with p2's, so a filtered neighbour is rarely a global one. */
function seedRows(): Row[] {
  return Array.from({ length: 10 }, (_, index) => ({
    itemId: `i${String(index)}`,
    ref: index % 5 === 2 || index % 5 === 4 ? `RLP-${String(index)}` : `ALF-${String(index)}`,
    projectId: index % 5 === 2 || index % 5 === 4 ? 'p2' : 'p1',
    priority: index + 1,
  }));
}

async function fuzz(seed: number) {
  const random = prng(seed);
  const server = new Ranking(seedRows());
  // What the user's clicks describe: every action applied, in click order, the instant it's made.
  const intended = new Ranking(seedRows());
  simulateServer(server, random);

  // Just the stores the Backlog reads — the full provider stack polls other modules' APIs.
  const { unmount } = render(
    <ToastProvider>
      <CodeProvider
        initialProjects={[PROJECT, OTHER_PROJECT]}
        initialEpics={[EPIC, OTHER_EPIC]}
        initialStories={seedRows().map((row) => toStory(row))}
      >
        <ProjectBacklog />
      </CodeProvider>
    </ToastProvider>,
  );
  // Let the realtime channel join (it waits on a resolved auth promise).
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });

  const log: string[] = [];
  let lastRef: string | null = null;
  for (let click = 0; click < 30; click += 1) {
    const shown = shownOrder();
    expect({ seed, log, shown }).toEqual({ seed, log, shown: intended.order('p1') });

    // Mostly nudge the same story again (a burst); sometimes pick another, or jump it.
    const ref: string =
      lastRef !== null && random() < 0.7
        ? lastRef
        : (shown[Math.floor(random() * shown.length)] ?? '');
    const index = shown.indexOf(ref);
    const roll = random();
    const jump = roll < 0.1;
    let gap = ref === lastRef && !jump ? 60 + Math.floor(random() * 400) : 250 + random() * 600;
    if (jump) {
      const toTop = random() < 0.5;
      log.push(`${ref} ${toTop ? 'top' : 'bottom'} of project`);
      fireEvent.click(
        screen.getByLabelText(`Move ${ref} to ${toTop ? 'top' : 'bottom'} of project`),
      );
      intended.moveInProject(ref, toTop);
      gap = Math.max(gap, 250);
    } else {
      const down = index === 0 || (index < shown.length - 1 && roll < 0.65);
      const neighbour = shown[down ? index + 1 : index - 1] ?? '';
      log.push(`${ref} ${down ? 'down' : 'up'}`);
      fireEvent.click(screen.getByLabelText(`Move ${ref} ${down ? 'down' : 'up'}`));
      intended.swap(ref, neighbour);
    }
    lastRef = jump ? null : ref;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(Math.floor(gap));
    });
  }

  // Let every debounce, request, answer and echo land.
  await act(async () => {
    await jest.runAllTimersAsync();
  });
  expect({ seed, log, shown: shownOrder() }).toEqual({ seed, log, shown: intended.order('p1') });
  expect({ seed, log, server: server.order('p1') }).toEqual({
    seed,
    log,
    server: intended.order('p1'),
  });
  unmount();
}

describe('BacklogList priority fuzz (ALF-250)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRealtimeHandler = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(SEEDS)(
    'seed %i: the shown order, and the server, stay on the order the clicks describe',
    async (seed) => {
      await fuzz(seed);
    },
  );
});
