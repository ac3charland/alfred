import type { Meta, StoryObj } from '@storybook/nextjs';
import * as React from 'react';

import { MobileSearch } from '@/components/shell/mobile-search';
import { CodeProvider } from '@/lib/stores/code-store';
import { SearchProvider, useSearchActions } from '@/lib/stores/search-store';
import type { CodeStory, Folder, Item, WikiPageIndexRow } from '@/lib/types';
import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

const FOLDERS: Folder[] = [
  {
    description: null,
    id: 'f1',
    name: 'Software',
    created_at: '2025-01-01T00:00:00Z',
    sort_order: 1,
  },
];

/** Fixed residency stamp for a seeded FILED item — fixtures pin the clock, never read it. */
const DISPATCHED_AT = '2025-01-02T00:00:00Z';

const task = (overrides: Partial<Item>): Item => ({
  id: 'i1',
  title: 'Task',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T00:00:00Z',
  raw_capture: null,
  due_date: null,
  due_time: null,
  status: 'active',
  completed_at: null,
  folder_id: 'f1',
  dispatched_at: DISPATCHED_AT,
  parent_id: null,
  occurrence_index: null,
  priority: null,
  recurrence: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
  classified_at: null,
  classified_provider: null,
  classified_model: null,
  classified_prompt_version: null,
  classified_guess: null,
  classify_attempts: 0,
  weekly_plan_id: null,
  ...overrides,
});

// Ten active "firewall" tasks overflow the per-group cap of 8, so the "+N more" line shows; the
// completed one only appears with "Show completed" on.
const FIREWALL_TITLES = [
  'Firewall triage workflow',
  'Firewall audit checklist',
  'Fix the firewall logging gap',
  'Review firewall rules doc',
  'Firewall alert thresholds',
  'Document the firewall exceptions',
  'Firewall vendor renewal',
  'Rotate firewall admin keys',
  'Firewall change freeze plan',
  'Firewall dashboard cleanup',
];

const TASKS: Item[] = [
  ...FIREWALL_TITLES.map((title, index) =>
    task({ id: `t${String(index)}`, title, sort_order: index }),
  ),
  task({ id: 'done', title: 'Firewall migration (done)', status: 'completed', sort_order: 99 }),
];

const STORY: CodeStory = {
  item_id: 's1',
  project_id: 'p1',
  epic_id: 'e1',
  ref_number: 31,
  ref: 'ALF-31',
  factory_state: 'ready_for_dev',
  lane: 'human',
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  implementation_pr_url: null,
  blocked_reason: null,
  blocked_from: null,
  requires_refinement: true,
  code_created_at: '2025-01-01T00:00:00Z',
  code_updated_at: '2025-01-01T00:00:00Z',
  title: 'Communication Firewall — message triage',
  notes: null,
  source_url: null,
  item_created_at: '2025-01-01T00:00:00Z',
  project_key: 'ALF',
  project_name: 'Alfred',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  epic_name: 'Firewall',
  epic_ref: 'ALF-1',
  epic_archived_at: null,
  epic_spec_path: null,
  priority: 1,
};

const WIKI_PAGES: WikiPageIndexRow[] = [
  toWikiIndexRow(
    makeWikiPage('wiki/concepts/firewall-triage.md', {
      title: 'Firewall triage',
      summary: 'How incoming messages are screened before they reach the Inbox.',
    }),
  ),
];

/** Seed the live query (which also opens the sheet) and, optionally, "Show completed". */
function SeedSearch({ query, showCompleted }: { query: string; showCompleted: boolean }) {
  const { setQuery, setShowCompleted } = useSearchActions();
  React.useEffect(() => {
    setQuery(query);
    setShowCompleted(showCompleted);
  }, [setQuery, setShowCompleted, query, showCompleted]);
  return null;
}

/** The sheet with its search state seeded, so each story opens straight onto a result set. */
function SeededMobileSearch({ query, showCompleted }: { query: string; showCompleted: boolean }) {
  return (
    <SearchProvider>
      <SeedSearch query={query} showCompleted={showCompleted} />
      <MobileSearch />
    </SearchProvider>
  );
}

const meta = {
  title: 'Shell/MobileSearch',
  component: SeededMobileSearch,
  parameters: {
    layout: 'fullscreen',
    // The sheet only opens below `md`, and it's a full-screen dialog portalled to <body> — so
    // capture the whole page at a phone viewport.
    visualTest: { target: 'body', viewport: { width: 390, height: 844 } },
    store: { folders: FOLDERS, tasks: TASKS, wiki: { pages: WIKI_PAGES } },
  },
  args: { query: 'firewall', showCompleted: false },
  decorators: [
    (Story) => (
      <CodeProvider initialProjects={[]} initialEpics={[]} initialStories={[STORY]}>
        <Story />
      </CodeProvider>
    ),
  ],
} satisfies Meta<typeof SeededMobileSearch>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Grouped, full-width, touch-sized results — ten task matches overflow the cap of 8. */
export const OpenWithResults: Story = {};

/** "Show completed" on: the completed task joins the list, de-emphasised. */
export const ShowCompleted: Story = { args: { showCompleted: true } };
