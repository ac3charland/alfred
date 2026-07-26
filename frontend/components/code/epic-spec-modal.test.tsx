import { render, screen } from '@testing-library/react';

import { CodeProvider } from '@/lib/stores/code-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { Epic, Project } from '@/lib/types';

import { EpicSpecModal } from './epic-spec-modal';

// react-markdown / remark-gfm are pure ESM and jest's transform ignores node_modules — mock the
// seam so the markdown branch is assertable here. The faithful markdown→HTML rendering is covered
// by the Storybook stories and the e2e, which run a real bundler/browser.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => <div data-testid="markdown">{children}</div>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }));

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

function makeEpic(overrides: Partial<Epic> = {}): Epic {
  return {
    id: 'e1',
    project_id: 'p1',
    name: 'Communication Firewall',
    notes: null,
    ref_number: 12,
    ref: 'ALF-12',
    archived_at: null,
    created_at: '2025-01-01T00:00:00Z',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    ...overrides,
  };
}

function renderModal(epic: Epic | null, projects: Project[] = [PROJECT]) {
  return render(
    <ToastProvider>
      <CodeProvider
        initialProjects={projects}
        initialEpics={epic === null ? [] : [epic]}
        initialStories={[]}
      >
        <EpicSpecModal epic={epic} open onOpenChange={jest.fn()} />
      </CodeProvider>
    </ToastProvider>,
  );
}

const HTML_SPEC = '<!doctype html><html><body><h1>ALF-12 — Epic plan</h1></body></html>';

describe('EpicSpecModal', () => {
  it('titles the modal with the epic ref and name', () => {
    renderModal(makeEpic({ spec_path: 'docs/specs/epics/ALF-12.html', spec_markdown: HTML_SPEC }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('ALF-12');
    expect(dialog).toHaveTextContent('Communication Firewall');
  });

  it('renders an HTML epic spec in the sandboxed frame (scripts inert)', () => {
    renderModal(makeEpic({ spec_path: 'docs/specs/epics/ALF-12.html', spec_markdown: HTML_SPEC }));

    const frame = screen.getByTestId('spec-html');
    expect(frame).toHaveAttribute('srcdoc', HTML_SPEC);
    // Empty sandbox: no allow-scripts, so a <script> in the committed spec can never run.
    expect(frame).toHaveAttribute('sandbox', '');
    expect(screen.queryByTestId('spec-markdown')).not.toBeInTheDocument();
  });

  it('renders a markdown epic spec as prose', () => {
    renderModal(
      makeEpic({
        spec_path: 'docs/specs/epics/ALF-12.md',
        spec_markdown: '# Epic plan\n\nThe decisions.',
      }),
    );

    expect(screen.getByTestId('spec-markdown')).toHaveTextContent('Epic plan');
    expect(screen.queryByTestId('spec-html')).not.toBeInTheDocument();
  });

  it('shows the epic-specific empty state when there is no spec at all', () => {
    renderModal(makeEpic());

    expect(
      screen.getByText(/no epic spec yet\. refine the epic in claude code to write one\./i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view in repo/i })).not.toBeInTheDocument();
  });

  it('links "View in repo" at the recorded spec sha', () => {
    renderModal(
      makeEpic({
        spec_path: 'docs/specs/epics/ALF-12.html',
        spec_sha: 'blobsha123',
        spec_markdown: HTML_SPEC,
      }),
    );

    expect(screen.getByRole('link', { name: /view in repo/i })).toHaveAttribute(
      'href',
      'https://github.com/ac3charland/alfred/blob/blobsha123/docs/specs/epics/ALF-12.html',
    );
  });

  it('falls back to HEAD when the path is recorded but the sha is not', () => {
    renderModal(makeEpic({ spec_path: 'docs/specs/epics/ALF-12.html', spec_sha: null }));

    expect(screen.getByRole('link', { name: /view in repo/i })).toHaveAttribute(
      'href',
      'https://github.com/ac3charland/alfred/blob/HEAD/docs/specs/epics/ALF-12.html',
    );
    // Path recorded but nothing snapshotted yet — point the reader at the repo link instead.
    expect(screen.getByText(/no spec snapshot yet/i)).toBeInTheDocument();
  });

  it('closes via a ≥44px close target on mobile, dense at md+ (ALF-138)', () => {
    // Same shared DialogCloseButton as the story detail modal — the two close buttons are one
    // control now, so this modal can't drift back to the old dense-only box.
    renderModal(makeEpic());

    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
      'h-11',
      'w-11',
      'md:h-auto',
      'md:w-auto',
      'md:p-1',
    );
  });

  it('omits the repo link when the epic’s project is not in the store', () => {
    renderModal(makeEpic({ spec_path: 'docs/specs/epics/ALF-12.html' }), []);

    expect(screen.queryByRole('link', { name: /view in repo/i })).not.toBeInTheDocument();
  });
});
