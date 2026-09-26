import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { makeReaderOverview, makeReaderPost } from '@/lib/reader/fixtures';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

import { PostOverview } from './post-overview';
import { renderReader } from './test-helpers';

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function post(overview: ReaderOverview, wikiSentIdeas: string[] = []): ReaderPostListItem {
  const { text: _text, ...row } = makeReaderPost(PUBLICATION_ID, {
    summary_state: 'done',
    overview,
    wiki_sent_ideas: wikiSentIdeas,
  });
  return row;
}

/** Not writable — the Work instance. No provider needed: nothing here reads a store. */
function renderPlain(overview: ReaderOverview) {
  return render(<PostOverview overview={overview} post={post(overview)} writable={false} />);
}

function renderWritable(overview: ReaderOverview, wikiSentIdeas: string[] = []) {
  const row = post(overview, wikiSentIdeas);
  return renderReader(<PostOverview overview={overview} post={row} writable />, [row], undefined, {
    wikiWritable: true,
  });
}

describe('PostOverview', () => {
  it('renders all four sections in order', () => {
    renderPlain(makeReaderOverview());

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Novel ideas', 'Evidence', 'The argument', 'Who should read it']);
  });

  it('renders each novel idea and each piece of evidence as its own bullet', () => {
    renderPlain(
      makeReaderOverview({
        novel_ideas: ['Idea one', 'Idea two'],
        evidence: ['Evidence one'],
      }),
    );

    expect(screen.getByText('Idea one')).toBeInTheDocument();
    expect(screen.getByText('Idea two')).toBeInTheDocument();
    expect(screen.getByText('Evidence one')).toBeInTheDocument();
  });

  it('states the honest empty answer when novel_ideas is empty', () => {
    renderPlain(makeReaderOverview({ novel_ideas: [] }));

    expect(
      screen.getByText('Nothing new — the post restates what a well-read reader already knows.'),
    ).toBeInTheDocument();
  });

  it('states the honest empty answer when evidence is empty', () => {
    renderPlain(makeReaderOverview({ evidence: [] }));

    expect(screen.getByText('None — the post rests on assertion alone.')).toBeInTheDocument();
  });

  it('renders the argument and who-should-read paragraphs', () => {
    renderPlain(
      makeReaderOverview({
        argument: 'The argument paragraph.',
        who_should_read: 'Everyone who cares.',
      }),
    );

    expect(screen.getByText('The argument paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Everyone who cares.')).toBeInTheDocument();
  });
});

describe('PostOverview — the wiki not connected', () => {
  it('keeps Novel ideas a plain bulleted list, with no send affordance and no taller heading row', () => {
    renderPlain(makeReaderOverview({ novel_ideas: ['Idea one', 'Idea two'] }));

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wiki/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('novel-ideas-heading-row')).not.toBeInTheDocument();
    expect(screen.getAllByRole('list')[0]).toHaveClass('list-disc');
  });
});

describe('PostOverview — the wiki connected', () => {
  it('turns Novel ideas into a checklist with Send all on a 32px heading row', () => {
    renderWritable(makeReaderOverview({ novel_ideas: ['Idea one', 'Idea two'] }));

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Send all to wiki' })).toBeInTheDocument();
    expect(screen.getByTestId('novel-ideas-heading-row')).toHaveClass('min-h-8');
    expect(screen.getByRole('heading', { level: 3, name: 'Novel ideas' })).toBeInTheDocument();
  });

  it('draws a bullet already in wiki_sent_ideas as sent', () => {
    renderWritable(makeReaderOverview({ novel_ideas: ['Idea one', 'Idea two'] }), ['Idea one']);

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Idea two' })).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('keeps the honest empty line, and offers nothing to send, when there are no ideas', () => {
    renderWritable(makeReaderOverview({ novel_ideas: [] }));

    expect(
      screen.getByText('Nothing new — the post restates what a well-read reader already knows.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wiki/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('novel-ideas-heading-row')).not.toBeInTheDocument();
  });

  it('leaves the other three sections exactly as they are', () => {
    renderWritable(makeReaderOverview({ evidence: ['Evidence one'] }));

    expect(screen.getByText('Evidence one')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Novel ideas', 'Evidence', 'The argument', 'Who should read it']);
  });
});
