import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

import { buildWikiWeb } from './graph';

const page = (path: string, links: string[] = [], title?: string) =>
  toWikiIndexRow(makeWikiPage(path, { links, ...(title === undefined ? {} : { title }) }));

describe('buildWikiWeb', () => {
  it('draws only the concept and entity pages, in index order', () => {
    const { nodes } = buildWikiWeb([
      page('wiki/sources/brain-rules.md'),
      page('wiki/entities/john-medina.md', [], 'John Medina'),
      page('wiki/questions/why.md'),
      page('wiki/concepts/working-memory.md', [], 'Working memory'),
      page('wiki/concepts/attention.md', [], 'Attention'),
    ]);

    expect(nodes.map((node) => node.path)).toEqual([
      'wiki/concepts/attention.md',
      'wiki/concepts/working-memory.md',
      'wiki/entities/john-medina.md',
    ]);
    expect(nodes[2]).toEqual({
      path: 'wiki/entities/john-medina.md',
      title: 'John Medina',
      section: 'entities',
      degree: 0,
    });
  });

  it('draws a link and its reverse as one undirected edge, its ends in path order', () => {
    const { edges } = buildWikiWeb([
      page('wiki/entities/john-medina.md', ['wiki/concepts/working-memory.md']),
      page('wiki/concepts/working-memory.md', ['wiki/entities/john-medina.md']),
    ]);

    expect(edges).toEqual([
      { a: 'wiki/concepts/working-memory.md', b: 'wiki/entities/john-medina.md' },
    ]);
  });

  it('drops links to sources, questions, missing pages and the page itself', () => {
    const { nodes, edges } = buildWikiWeb([
      page('wiki/concepts/a.md', [
        'wiki/sources/s.md',
        'wiki/questions/q.md',
        'wiki/concepts/not-yet.md',
        'wiki/concepts/a.md',
      ]),
      page('wiki/sources/s.md', ['wiki/concepts/a.md']),
      page('wiki/questions/q.md', ['wiki/concepts/a.md']),
    ]);

    expect(edges).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.degree).toBe(0);
  });

  it("counts a node's degree as its distinct neighbours", () => {
    const { nodes } = buildWikiWeb([
      page('wiki/concepts/hub.md', [
        'wiki/concepts/b.md',
        'wiki/concepts/c.md',
        'wiki/concepts/b.md',
      ]),
      page('wiki/concepts/b.md', ['wiki/concepts/hub.md']),
      page('wiki/concepts/c.md'),
    ]);

    const degree = new Map(nodes.map((node) => [node.path, node.degree]));
    expect(degree.get('wiki/concepts/hub.md')).toBe(2);
    expect(degree.get('wiki/concepts/b.md')).toBe(1);
    expect(degree.get('wiki/concepts/c.md')).toBe(1);
  });

  it('lists edges in one order whatever order the links were written in', () => {
    const forward = buildWikiWeb([
      page('wiki/concepts/a.md', ['wiki/concepts/b.md', 'wiki/concepts/c.md']),
      page('wiki/concepts/b.md'),
      page('wiki/concepts/c.md'),
    ]);
    const reversed = buildWikiWeb([
      page('wiki/concepts/c.md', ['wiki/concepts/a.md']),
      page('wiki/concepts/b.md', ['wiki/concepts/a.md']),
      page('wiki/concepts/a.md'),
    ]);

    expect(reversed.edges).toEqual(forward.edges);
  });

  it('is empty for a wiki with no concepts or entities', () => {
    expect(buildWikiWeb([page('wiki/sources/s.md')])).toEqual({ nodes: [], edges: [] });
  });
});
