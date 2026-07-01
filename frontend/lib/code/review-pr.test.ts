import type { CodeStory } from '@/lib/types';

import { reviewPrUrlFor } from './review-pr';

const REFINEMENT_PR = 'https://github.com/ac3charland/alfred/pull/1';
const IMPLEMENTATION_PR = 'https://github.com/ac3charland/alfred/pull/2';

function makeStory(overrides: Partial<CodeStory> = {}): CodeStory {
  return {
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 42,
    ref: 'ALF-42',
    factory_state: 'in_refinement',
    lane: 'human',
    spec_path: null,
    spec_sha: null,
    spec_markdown: null,
    refinement_pr_url: null,
    implementation_pr_url: null,
    blocked_reason: null,
    code_created_at: '2025-01-01T00:00:00Z',
    code_updated_at: '2025-01-01T00:00:00Z',
    title: 'Wire up the webhook',
    notes: null,
    source_url: null,
    item_created_at: '2025-01-01T00:00:00Z',
    project_key: 'ALF',
    project_name: 'Alfred',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    epic_name: 'Plumbing',
    epic_ref: 'ALF-1',
    epic_archived_at: null,
    priority: 1,
    ...overrides,
  };
}

describe('reviewPrUrlFor', () => {
  it('returns the refinement PR url for an in_refinement story', () => {
    const story = makeStory({
      factory_state: 'in_refinement',
      refinement_pr_url: REFINEMENT_PR,
      // The implementation url must be ignored in this state, even when populated.
      implementation_pr_url: IMPLEMENTATION_PR,
    });

    expect(reviewPrUrlFor(story)).toBe(REFINEMENT_PR);
  });

  it('returns the implementation PR url for a ready_for_review story', () => {
    const story = makeStory({
      factory_state: 'ready_for_review',
      implementation_pr_url: IMPLEMENTATION_PR,
      // The refinement url must be ignored in this state, even when populated.
      refinement_pr_url: REFINEMENT_PR,
    });

    expect(reviewPrUrlFor(story)).toBe(IMPLEMENTATION_PR);
  });

  it('returns null for an in_refinement story whose refinement PR is not recorded yet', () => {
    const story = makeStory({ factory_state: 'in_refinement', refinement_pr_url: null });

    expect(reviewPrUrlFor(story)).toBeNull();
  });

  it('returns null for a ready_for_review story whose implementation PR is not recorded yet', () => {
    const story = makeStory({ factory_state: 'ready_for_review', implementation_pr_url: null });

    expect(reviewPrUrlFor(story)).toBeNull();
  });

  it.each([
    'needs_refinement',
    'ready_for_dev',
    'in_development',
    'done',
    'blocked',
    'abandoned',
  ] as const)('returns null in the %s state even when both PR urls are populated', (state) => {
    const story = makeStory({
      factory_state: state,
      refinement_pr_url: REFINEMENT_PR,
      implementation_pr_url: IMPLEMENTATION_PR,
    });

    expect(reviewPrUrlFor(story)).toBeNull();
  });

  it('returns null when the factory state is null', () => {
    const story = makeStory({ factory_state: null });

    expect(reviewPrUrlFor(story)).toBeNull();
  });
});
