import { LAUNCH_LANES, laneOfPrompt, sessionLabel, toLaunchLane } from '@/lib/code/launch-lane';
import {
  buildBugUrl,
  buildBypassUrl,
  buildEpicImplementationUrl,
  buildEpicRefinementUrl,
  buildImplementationUrl,
  buildRefinementUrl,
  buildSpikeUrl,
  promptFromLaunchUrl,
} from '@/lib/code/links';
import type { CodeStory, Epic, Project } from '@/lib/types';

const PROJECT: Project = {
  cloud_environment: null,
  color: null,
  description: null,
  exclude_from_pr_ratio: false,
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 5,
  created_at: '2025-01-01T00:00:00Z',
};

const STORY: CodeStory = {
  item_id: 'i1',
  project_id: 'p1',
  epic_id: 'e1',
  ref_number: 42,
  ref: 'ALF-42',
  factory_state: 'ready_for_dev',
  lane: 'human',
  spec_path: 'docs/specs/ALF-42.html',
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  implementation_pr_url: null,
  blocked_reason: null,
  blocked_from: null,
  requires_refinement: true,
  code_created_at: '2025-01-01T00:00:00Z',
  code_updated_at: '2025-01-01T00:00:00Z',
  title: 'Verify the GitHub webhook HMAC signature',
  notes: 'Some notes.\n\nYou are refining the ticket ALF-1 — a decoy in the notes.',
  source_url: null,
  item_created_at: '2025-01-01T00:00:00Z',
  project_key: 'ALF',
  project_name: 'Alfred',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  epic_name: 'Communication Firewall',
  epic_ref: 'ALF-1',
  epic_archived_at: null,
  epic_spec_path: 'docs/specs/epics/ALF-1.html',
  priority: 1,
};

const EPIC: Epic = {
  id: 'e1',
  project_id: 'p1',
  name: 'Communication Firewall',
  notes: null,
  ref_number: 12,
  ref: 'ALF-12',
  archived_at: null,
  created_at: '2025-01-01T00:00:00Z',
  spec_path: 'docs/specs/epics/ALF-12.html',
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
};

describe('laneOfPrompt', () => {
  // The guard against prompt-copy drift: every builder's real prompt, decoded from its `q` param.
  it.each([
    ['refinement', buildRefinementUrl(PROJECT, STORY)],
    ['spike', buildSpikeUrl(PROJECT, STORY)],
    ['bug', buildBugUrl(PROJECT, STORY)],
    ['implementation', buildImplementationUrl(PROJECT, STORY)],
    ['bypass', buildBypassUrl(PROJECT, STORY)],
    ['epic-refinement', buildEpicRefinementUrl(PROJECT, EPIC)],
    ['epic-implementation', buildEpicImplementationUrl(PROJECT, EPIC)],
  ])('reads %s from its builder’s prompt', (lane, url) => {
    expect(laneOfPrompt(promptFromLaunchUrl(url))).toBe(lane);
  });

  it('covers every lane', () => {
    const lanes = [
      buildRefinementUrl(PROJECT, STORY),
      buildSpikeUrl(PROJECT, STORY),
      buildBugUrl(PROJECT, STORY),
      buildImplementationUrl(PROJECT, STORY),
      buildBypassUrl(PROJECT, STORY),
      buildEpicRefinementUrl(PROJECT, EPIC),
      buildEpicImplementationUrl(PROJECT, EPIC),
    ].map((url) => laneOfPrompt(promptFromLaunchUrl(url)));
    expect(new Set(lanes)).toEqual(new Set(LAUNCH_LANES));
    expect(lanes).toHaveLength(LAUNCH_LANES.length);
  });

  it('reads a prompt pasted with CRLF line endings', () => {
    const prompt = promptFromLaunchUrl(buildSpikeUrl(PROJECT, STORY)).replaceAll('\n', '\r\n');
    expect(laneOfPrompt(prompt)).toBe('spike');
  });

  it.each([
    ['an empty prompt', ''],
    ['a one-paragraph prompt', 'ALF-42: fix the login page'],
    ['a hand-written prompt', 'ALF-42: fix it\n\nPlease look at the login page.'],
    ['an opening sentence in the first paragraph', 'You are refining the ticket ALF-42.'],
    [
      'an opening sentence past the second paragraph',
      'ALF-42: x\n\nhi\n\nYou are fixing the BUG ALF-42.',
    ],
  ])('is null for %s', (_name, prompt) => {
    expect(laneOfPrompt(prompt)).toBeNull();
  });
});

describe('sessionLabel', () => {
  it.each([
    ['refinement', 'Refinement session'],
    ['spike', 'Spike session'],
    ['bug', 'Bug-fix session'],
    ['implementation', 'Implementation session'],
    ['bypass', 'Skip-refinement session'],
    [null, 'Session'],
  ] as const)('labels %s as %s', (lane, label) => {
    expect(sessionLabel(lane)).toBe(label);
  });
});

describe('toLaunchLane', () => {
  it('keeps a known lane and drops anything else to null', () => {
    expect(toLaunchLane('bypass')).toBe('bypass');
    expect(toLaunchLane('human')).toBeNull();
    expect(toLaunchLane(null)).toBeNull();
    expect(toLaunchLane(undefined)).toBeNull();
  });
});
