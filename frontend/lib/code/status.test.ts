import type { CodeStory } from '@/lib/types';

import { codeStoryStatusPatch } from './status';

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 1,
    ref: 'ALF-1',
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
    code_created_at: '2025-01-01T00:00:00Z',
    code_updated_at: '2025-01-01T00:00:00Z',
    title: 'Story i1',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Epic e1',
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    epic_spec_path: null,
    priority: 1,
    ...overrides,
  };
}

describe('codeStoryStatusPatch', () => {
  it('projects the status fields (factory_state, lane, blocked_reason, blocked_from, requires_refinement)', () => {
    const story = makeStory({
      factory_state: 'blocked',
      lane: 'local',
      blocked_reason: 'checks failing',
      blocked_from: 'in_development',
      requires_refinement: false,
    });

    expect(codeStoryStatusPatch(story)).toEqual({
      factory_state: 'blocked',
      lane: 'local',
      blocked_reason: 'checks failing',
      blocked_from: 'in_development',
      requires_refinement: false,
    });
  });

  it('omits non-status fields (title, priority, notes, spec, prs)', () => {
    // Exact-equality on the whole patch: any leaked non-status field would fail this.
    const patch = codeStoryStatusPatch(
      makeStory({ title: 'x', priority: 42, spec_path: '/s', refinement_pr_url: 'http://pr' }),
    );

    expect(patch).toEqual({
      factory_state: 'in_development',
      lane: 'human',
      blocked_reason: null,
      blocked_from: null,
      requires_refinement: true,
    });
  });

  // The navigation refetch (ALF-69) is how a mark set on another device reaches a story this
  // tab already holds — the flag has to survive that projection or the toggle reads stale.
  it('carries a cleared refinement mark through the refetch projection', () => {
    const patch = codeStoryStatusPatch(
      makeStory({ factory_state: 'ready_for_dev', requires_refinement: false }),
    );

    expect(patch.requires_refinement).toBe(false);
  });
});
