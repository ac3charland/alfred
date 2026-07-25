import type { Meta, StoryObj } from '@storybook/nextjs';

import { CodeProvider } from '@/lib/stores/code-store';
import type { Epic, Project } from '@/lib/types';

import { EpicSpecModal } from './epic-spec-modal';

const PROJECT: Project = {
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 12,
  created_at: '2025-01-01T00:00:00Z',
};

/** A self-contained HTML epic spec — the format an epic-refinement session writes. */
const HTML_SPEC = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>ALF-12 — Communication Firewall</title>
<style>
  body { margin: 0; padding: 1.25rem; font: 15px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b1f24; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  h2 { font-size: 1.05rem; margin: 1.4rem 0 .4rem; border-bottom: 2px solid #e4e8ee; padding-bottom: .25rem; }
  dt { font-weight: 600; color: #0d7d7d; }
  dd { margin: 0 0 .6rem; }
</style>
</head>
<body>
  <h1>ALF-12 — Communication Firewall</h1>
  <h2>Problem space</h2>
  <p>Everything about how alfred talks to me — notifications, Siri capture, the morning brief —
     shares one question: what earns an interruption?</p>
  <h2>Decisions</h2>
  <dl>
    <dt>Default-deny</dt>
    <dd>Nothing reaches me unless a rule admits it, and every rejection records a reason.</dd>
    <dt>One digest, not a stream</dt>
    <dd>Filtered items surface in a daily digest rather than as individual notifications.</dd>
  </dl>
  <h2>Non-goals</h2>
  <ul><li>Per-sender rate limiting.</li><li>A local-LLM review lane.</li></ul>
</body>
</html>`;

const MARKDOWN_SPEC = `# Communication Firewall

Durable context for the epic.

## Decisions

- **Default-deny** — nothing reaches me unless a rule admits it.
- **One digest** — filtered items surface daily, not as a stream.

## Open questions

1. Where do Siri captures sit relative to the allow-list?
`;

const EPIC: Epic = {
  id: 'e1',
  project_id: 'p1',
  name: 'Communication Firewall',
  notes: 'Everything about how alfred talks to me: notifications, Siri capture, the morning brief.',
  ref_number: 12,
  ref: 'ALF-12',
  archived_at: null,
  created_at: '2025-01-01T00:00:00Z',
  spec_path: 'docs/specs/epics/ALF-12.html',
  spec_sha: 'a1b2c3d4',
  spec_markdown: HTML_SPEC,
  refinement_pr_url: 'https://github.com/ac3charland/alfred/pull/12',
};

const meta = {
  title: 'Code/EpicSpecModal',
  component: EpicSpecModal,
  parameters: {
    layout: 'fullscreen',
    // No `visualTest` opt-in: capturing this dialog hangs the test-runner's postVisit
    // screenshot until the 30 s test timeout (every state, desktop and mobile alike), while the
    // same capture takes ~0.4 s driving Playwright directly. The stories still smoke-test each
    // render state here; the rendered HTML/markdown branches are asserted in
    // `epic-spec-modal.test.tsx` and exercised in a real browser by `e2e/code-links.spec.ts`.
  },
  decorators: [
    (Story) => (
      <CodeProvider initialProjects={[PROJECT]} initialEpics={[EPIC]} initialStories={[]}>
        <Story />
      </CodeProvider>
    ),
  ],
  args: { open: true, onOpenChange: () => {} },
} satisfies Meta<typeof EpicSpecModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The usual case: a self-contained HTML epic spec, rendered in the sandboxed frame so its own
 * CSS can't leak into the app, with the sha-pinned View-in-repo link beside the heading.
 */
export const HtmlSpec: Story = {
  args: { epic: EPIC },
};

/** A legacy markdown epic spec, rendered as prose rather than in a frame. */
export const MarkdownSpec: Story = {
  args: {
    epic: { ...EPIC, spec_path: 'docs/specs/epics/ALF-12.md', spec_markdown: MARKDOWN_SPEC },
  },
};

/**
 * An epic that has never been refined: no path and no snapshot, so the body is the epic-specific
 * empty state pointing at the menu's refine action, and there is no repo link.
 */
export const NoSpecYet: Story = {
  args: {
    epic: { ...EPIC, spec_path: null, spec_sha: null, spec_markdown: null },
  },
};
