import { activeEpicsForProject } from '@/lib/code/epics';
import type { Epic } from '@/lib/types';

function epic(id: string, projectId: string, archivedAt: string | null = null): Epic {
  return {
    id,
    project_id: projectId,
    name: `Epic ${id}`,
    notes: null,
    ref_number: 1,
    ref: `ALF-${id}`,
    archived_at: archivedAt,
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    created_at: '2025-01-01T00:00:00Z',
  };
}

describe('activeEpicsForProject', () => {
  it("keeps the project's epics in store order", () => {
    const epics = [epic('a', 'p1'), epic('b', 'p1')];

    expect(activeEpicsForProject(epics, 'p1')).toEqual(epics);
  });

  it("drops other projects' epics", () => {
    expect(
      activeEpicsForProject([epic('a', 'p1'), epic('b', 'p2')], 'p1').map((e) => e.id),
    ).toEqual(['a']);
  });

  it('drops archived epics — an archived epic is off the board, so nothing new belongs in it', () => {
    const epics = [epic('a', 'p1'), epic('b', 'p1', '2025-06-01T00:00:00Z')];

    expect(activeEpicsForProject(epics, 'p1').map((e) => e.id)).toEqual(['a']);
  });

  it('is empty while no project is chosen', () => {
    expect(activeEpicsForProject([epic('a', 'p1')], null)).toEqual([]);
  });
});
