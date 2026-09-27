import { render, screen, within } from '@testing-library/react';
import * as React from 'react';

import { makeReaderOverview, makeReaderPost } from '@/lib/reader/fixtures';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

import { PostOverview } from './post-overview';
import { renderReader } from './test-helpers';

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function post(
  overview: ReaderOverview,
  wikiSentIdeas: string[] = [],
  wikiSentEvidence: string[] = [],
): ReaderPostListItem {
  const { text: _text, ...row } = makeReaderPost(PUBLICATION_ID, {
    summary_state: 'done',
    overview,
    wiki_sent_ideas: wikiSentIdeas,
    wiki_sent_evidence: wikiSentEvidence,
  });
  return row;
}

/** Not writable — the Work instance. No provider needed: nothing here reads a store. */
function renderPlain(overview: ReaderOverview) {
  return render(<PostOverview overview={overview} post={post(overview)} writable={false} />);
}

function renderWritable(
  overview: ReaderOverview,
  wikiSentIdeas: string[] = [],
  wikiSentEvidence: string[] = [],
) {
  const row = post(overview, wikiSentIdeas, wikiSentEvidence);
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
  it('states the honest empty line, not blank bullets, when every bullet is blank', () => {
    renderPlain(makeReaderOverview({ novel_ideas: ['', '  '] }));

    expect(
      screen.getByText('Nothing new — the post restates what a well-read reader already knows.'),
    ).toBeInTheDocument();
  });

  it('draws only the real bullets when blank ones are mixed in', () => {
    renderPlain(makeReaderOverview({ novel_ideas: ['Idea one', '', ' '.repeat(2), 'Idea two'] }));

    const list = screen.getAllByRole('list')[0];
    if (list === undefined) throw new Error('no Novel ideas list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Idea one', 'Idea two']);
  });

  it('keeps both Novel ideas and Evidence plain bulleted lists, with no send affordance and no taller heading row', () => {
    renderPlain(
      makeReaderOverview({ novel_ideas: ['Idea one', 'Idea two'], evidence: ['Evidence one'] }),
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('novel-ideas-heading-row')).not.toBeInTheDocument();
    expect(screen.queryByTestId('evidence-heading-row')).not.toBeInTheDocument();
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(list).toHaveClass('list-disc');
  });

  it('draws only the real evidence bullets when blank ones are mixed in', () => {
    renderPlain(
      makeReaderOverview({ evidence: ['Evidence one', '', ' '.repeat(2), 'Evidence two'] }),
    );

    const list = screen.getAllByRole('list')[1];
    if (list === undefined) throw new Error('no Evidence list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Evidence one', 'Evidence two']);
  });

  it('states the honest empty line, not blank bullets, when every evidence bullet is blank', () => {
    renderPlain(makeReaderOverview({ evidence: ['', '  ', '\n'] }));

    expect(screen.getByText('None — the post rests on assertion alone.')).toBeInTheDocument();
    expect(screen.getAllByRole('list')).toHaveLength(1);
  });
});

describe('PostOverview — the wiki connected', () => {
  it('turns Novel ideas and Evidence into checklists, each with Select all on a 32px heading row', () => {
    renderWritable(
      makeReaderOverview({ novel_ideas: ['Idea one', 'Idea two'], evidence: ['Evidence one'] }),
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'Evidence one' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all Novel ideas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send all/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('novel-ideas-heading-row')).toHaveClass('min-h-8');
    expect(screen.getByTestId('evidence-heading-row')).toHaveClass('min-h-8');
    expect(screen.getByRole('heading', { level: 3, name: 'Novel ideas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Evidence' })).toBeInTheDocument();
  });

  it('draws an evidence bullet already in wiki_sent_evidence as sent — and not one in wiki_sent_ideas', () => {
    renderWritable(
      makeReaderOverview({
        novel_ideas: ['Shared text'],
        evidence: ['Shared text', 'Evidence two'],
      }),
      [],
      ['Evidence two'],
    );

    const checkboxes = screen.getAllByRole('checkbox', { name: 'Shared text' });
    expect(checkboxes).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: 'Evidence two' })).not.toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('makes Evidence alone a checklist when there are no novel ideas', () => {
    renderWritable(makeReaderOverview({ novel_ideas: [], evidence: ['Evidence one'] }));

    expect(
      screen.getByText('Nothing new — the post restates what a well-read reader already knows.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('novel-ideas-heading-row')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Evidence one' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all Evidence' })).toBeInTheDocument();
  });

  it('drops blank evidence from the checklist, and states the empty line when nothing else is left', () => {
    renderWritable(
      makeReaderOverview({ novel_ideas: ['Idea one'], evidence: ['', ' '.repeat(3)] }),
    );

    expect(screen.getByText('None — the post rests on assertion alone.')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByTestId('evidence-heading-row')).not.toBeInTheDocument();
    expect(screen.queryByText('All sent to wiki')).not.toBeInTheDocument();
  });

  it('draws a bullet already in wiki_sent_ideas as sent', () => {
    renderWritable(makeReaderOverview({ novel_ideas: ['Idea one', 'Idea two'], evidence: [] }), [
      'Idea one',
    ]);

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Idea two' })).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('keeps both honest empty lines, and offers nothing to send, when neither section has a bullet', () => {
    renderWritable(makeReaderOverview({ novel_ideas: [], evidence: [] }));

    expect(screen.getByText('None — the post rests on assertion alone.')).toBeInTheDocument();

    expect(
      screen.getByText('Nothing new — the post restates what a well-read reader already knows.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wiki/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('novel-ideas-heading-row')).not.toBeInTheDocument();
  });

  it('mounts no checklist when every bullet in both sections is blank, and states the honest empty lines', () => {
    renderWritable(
      makeReaderOverview({ novel_ideas: ['', ' '.repeat(3), '\n'], evidence: [' ', ''] }),
    );

    expect(
      screen.getByText('Nothing new — the post restates what a well-read reader already knows.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('All sent to wiki')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('novel-ideas-heading-row')).not.toBeInTheDocument();
  });

  it('leaves the other two sections exactly as they are, and keeps the four in order', () => {
    renderWritable(
      makeReaderOverview({ argument: 'The argument paragraph.', who_should_read: 'Everyone.' }),
    );

    expect(screen.getByText('The argument paragraph.')).toHaveClass('mt-1', 'text-sm');
    expect(screen.getByText('Everyone.')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Novel ideas', 'Evidence', 'The argument', 'Who should read it']);
  });
});
