import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Code module — story detail modal + the epic-header controls.
 *
 * Clicking a board card opens the Jira-style modal showing the ref, title, state chip, and
 * (for a story past `ready_for_dev` carrying `spec_markdown`) the rendered spec. The
 * manual controls move a story along the happy path, and the epic header archives an epic
 * off the active board.
 *
 * `/api/code` + `/api/epics` validate ids as strict UUIDs, and `v_code_stories` only
 * surfaces a story when its backing `items` row is ALSO seeded (the view's inner join) — so
 * each id below is a real UUID and each story is seeded as an item + a code_items sidecar.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EPIC_ID = '22222222-2222-4222-8222-222222222222';
const EPIC_TWO_ID = '33333333-3333-4333-8333-333333333333';
const STORY_ITEM_ID = '44444444-4444-4444-8444-444444444444';

const SPEC_MARKDOWN = [
  '# Allow-list parser spec',
  '',
  'Parse the firewall rules and classify each item.',
  '',
  '## Steps',
  '',
  '- Read the rules file',
  '- Default-deny anything unmatched',
].join('\n');

test('opens the detail modal from a card and shows the rendered spec', async ({ page, seed }) => {
  const project = makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const item = makeItem('Implement the allow-list parser', {
    id: STORY_ITEM_ID,
    item_type: 'code',
    notes: 'Default-deny; explain every rejection.',
  });
  const story = makeCodeStory({
    item_id: STORY_ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 5,
    ref: 'ALF-5',
    factory_state: 'ready_for_dev',
    spec_path: 'specs/ALF-5.md',
    spec_sha: 'abc123',
    spec_markdown: SPEC_MARKDOWN,
    implementation_pr_url: null,
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });
  await page.goto(`/code/${PROJECT_ID}`);

  // Open the card (its accessible name is "Open <ref> <title>").
  await page.getByRole('button', { name: /open ALF-5/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('ALF-5')).toBeVisible();
  await expect(dialog.getByText('Implement the allow-list parser')).toBeVisible();
  await expect(dialog.getByText('Ready for Dev')).toBeVisible();

  // The spec markdown renders to real HTML — a heading + a list (react-markdown + remark-gfm).
  await expect(dialog.getByRole('heading', { name: /allow-list parser spec/i })).toBeVisible();
  await expect(dialog.getByText('Default-deny anything unmatched')).toBeVisible();

  // The View-in-repo link is built from the recorded owner/name + sha + path.
  await expect(dialog.getByRole('link', { name: /view in repo/i })).toHaveAttribute(
    'href',
    'https://github.com/ac3charland/alfred/blob/abc123/specs/ALF-5.md',
  );

  // The phase-appropriate launch button shows (ready_for_dev → Implement).
  await expect(dialog.getByRole('button', { name: /implement in claude/i })).toBeVisible();
});

test('a manual Advance moves the story to the next swimlane', async ({ page, seed }) => {
  const project = makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const item = makeItem('Draft the inbound filter spec', {
    id: STORY_ITEM_ID,
    item_type: 'code',
  });
  const story = makeCodeStory({
    item_id: STORY_ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 3,
    ref: 'ALF-3',
    factory_state: 'needs_refinement',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });
  await page.goto(`/code/${PROJECT_ID}`);

  // The card starts in Needs Refinement.
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  await expect(needsRefinement.getByText('ALF-3')).toBeVisible();

  // Open the modal and advance one step (needs_refinement → in_refinement).
  await page.getByRole('button', { name: /open ALF-3/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /advance/i }).click();

  // The modal reflects the new state immediately.
  await expect(dialog.getByText('In Refinement')).toBeVisible();

  // Close the modal (its overlay covers the board) and confirm the card has moved lanes.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  const inRefinement = page.getByRole('region', { name: 'In Refinement' });
  await expect(inRefinement.getByText('ALF-3')).toBeVisible();
  await expect(needsRefinement.getByText('ALF-3')).toBeHidden();
});

test('archiving an epic from its header removes it from the active board', async ({
  page,
  seed,
}) => {
  const project = makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' });
  const epicOne = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const epicTwo = makeEpic('Capture Pipeline', {
    id: EPIC_TWO_ID,
    project_id: PROJECT_ID,
    ref_number: 2,
    ref: 'ALF-2',
  });

  await seed({ projects: [project], epics: [epicOne, epicTwo] });
  await page.goto(`/code/${PROJECT_ID}`);

  // Both epics are on the active board.
  const firewallHeader = page.getByRole('button', { name: /communication firewall/i });
  await expect(firewallHeader).toBeVisible();
  await expect(page.getByRole('button', { name: /capture pipeline/i })).toBeVisible();

  // Archive the first epic from its actions menu. Scope to its section so the right menu is hit.
  const firewallSection = page.locator('section', { has: firewallHeader });
  await firewallSection.getByRole('button', { name: /epic actions/i }).click();
  await page.getByRole('menuitem', { name: /^archive$/i }).click();

  // It leaves the active board.
  await expect(page.getByRole('button', { name: /communication firewall/i })).toBeHidden();

  // Show archived reveals it again.
  await page.getByRole('button', { name: /show archived/i }).click();
  await expect(page.getByRole('button', { name: /communication firewall/i })).toBeVisible();
});
