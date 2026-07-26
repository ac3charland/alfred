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
const STORY_TWO_ITEM_ID = '55555555-5555-4555-8555-555555555555';
const PROJECT_TWO_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_STORY_ITEM_ID = '77777777-7777-4777-8777-777777777777';

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
    spec_path: 'docs/specs/ALF-5.md',
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
  // The state chip specifically — the status dropdown's trigger shows the same label.
  await expect(dialog.locator('[data-factory-state="ready_for_dev"]')).toHaveText('Ready for Dev');

  // The spec markdown renders to real HTML — a heading + a list (react-markdown + remark-gfm).
  await expect(dialog.getByRole('heading', { name: /allow-list parser spec/i })).toBeVisible();
  await expect(dialog.getByText('Default-deny anything unmatched')).toBeVisible();

  // The View-in-repo link is built from the recorded owner/name + sha + path.
  await expect(dialog.getByRole('link', { name: /view in repo/i })).toHaveAttribute(
    'href',
    'https://github.com/ac3charland/alfred/blob/abc123/docs/specs/ALF-5.md',
  );

  // The phase-appropriate launch button shows (ready_for_dev → Implement).
  await expect(dialog.getByRole('button', { name: /implement in claude/i })).toBeVisible();
});

test('a status picked from the dropdown moves the story to that swimlane', async ({
  page,
  seed,
}) => {
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

  // Open the modal and pick a status two lanes ahead (needs_refinement → ready_for_dev),
  // which the old one-step Advance button could not do in a single move.
  await page.getByRole('button', { name: /open ALF-3/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /change status/i }).click();
  await page.getByRole('menuitem', { name: 'Ready for Dev' }).click();

  // The modal reflects the new state immediately (the header chip carries the raw state).
  await expect(dialog.locator('[data-factory-state="ready_for_dev"]')).toBeVisible();

  // Close the modal (its overlay covers the board) and confirm the card has moved lanes.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  const readyForDev = page.getByRole('region', { name: 'Ready for Dev' });
  await expect(readyForDev.getByText('ALF-3')).toBeVisible();
  await expect(needsRefinement.getByText('ALF-3')).toBeHidden();
});

test('moves a story to a different epic via the breadcrumb dropdown', async ({ page, seed }) => {
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
  const item = makeItem('Draft the inbound filter spec', {
    id: STORY_ITEM_ID,
    item_type: 'code',
  });
  const story = makeCodeStory({
    item_id: STORY_ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 5,
    ref: 'ALF-5',
    factory_state: 'needs_refinement',
  });

  await seed({ projects: [project], epics: [epicOne, epicTwo], items: [item], codeItems: [story] });
  await page.goto(`/code/${PROJECT_ID}`);

  // The card starts under epic one's block.
  const epicOneSection = page.locator('section', {
    has: page.getByRole('button', { name: /^communication firewall/i }),
  });
  await expect(epicOneSection.getByText('ALF-5')).toBeVisible();

  // Open the modal and move the story to epic two from the Project › Epic breadcrumb.
  await page.getByRole('button', { name: /open ALF-5/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /change epic/i }).click();
  await page.getByRole('menuitem', { name: /capture pipeline/i }).click();

  // The breadcrumb updates live to the new epic — no manual refresh.
  await expect(dialog.getByRole('button', { name: /change epic/i })).toContainText(
    'Capture Pipeline',
  );

  // Close the modal; the card now lives under epic two's block, not epic one's.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  const epicTwoSection = page.locator('section', {
    has: page.getByRole('button', { name: /^capture pipeline/i }),
  });
  await expect(epicTwoSection.getByText('ALF-5')).toBeVisible();
  await expect(epicOneSection.getByText('ALF-5')).toBeHidden();
});

test('saves story notes with ⌘/Ctrl+Enter from the modal editor', async ({ page, seed }) => {
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

  await page.getByRole('button', { name: /open ALF-3/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Add notes…').click();

  const notes = dialog.getByRole('textbox', { name: /edit notes/i });
  await notes.fill('Default-deny; explain every rejection.');
  await notes.press('ControlOrMeta+Enter');

  // The chord commits and leaves edit mode, exactly as the Save button does.
  await expect(notes).toBeHidden();
  await expect(dialog.getByText('Default-deny; explain every rejection.')).toBeVisible();

  // Reload from the backend: the notes were persisted, not just held in the client store.
  await page.reload();
  await page.getByRole('button', { name: /open ALF-3/i }).click();
  await expect(
    page.getByRole('dialog').getByText('Default-deny; explain every rejection.'),
  ).toBeVisible();
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
  const firewallHeader = page.getByRole('button', { name: /^communication firewall/i });
  await expect(firewallHeader).toBeVisible();
  await expect(page.getByRole('button', { name: /^capture pipeline/i })).toBeVisible();

  // Archive the first epic from its actions menu. Scope to its section so the right menu is hit.
  const firewallSection = page.locator('section', { has: firewallHeader });
  await firewallSection.getByRole('button', { name: /epic actions/i }).click();
  await page.getByRole('menuitem', { name: /^archive$/i }).click();

  // It leaves the active board.
  await expect(page.getByRole('button', { name: /^communication firewall/i })).toBeHidden();

  // Show archived reveals it again.
  await page.getByRole('button', { name: /show archived/i }).click();
  await expect(page.getByRole('button', { name: /^communication firewall/i })).toBeVisible();
});

test('re-ranks a story from the modal, in its project and across the whole Backlog', async ({
  page,
  seed,
}) => {
  const project = makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' });
  const otherProject = makeProject('Relay', { id: PROJECT_TWO_ID, key: 'RLP' });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const otherEpic = makeEpic('Routing', {
    id: EPIC_TWO_ID,
    project_id: PROJECT_TWO_ID,
    ref_number: 1,
    ref: 'RLP-1',
  });
  const items = [
    makeItem('Draft the inbound filter spec', { id: STORY_ITEM_ID, item_type: 'code' }),
    makeItem('Implement the allow-list parser', { id: STORY_TWO_ITEM_ID, item_type: 'code' }),
    makeItem('Other project story', { id: OTHER_STORY_ITEM_ID, item_type: 'code' }),
  ];
  const codeItems = [
    makeCodeStory({
      item_id: STORY_ITEM_ID,
      project_id: PROJECT_ID,
      epic_id: EPIC_ID,
      ref_number: 3,
      ref: 'ALF-3',
      priority: 1,
    }),
    makeCodeStory({
      item_id: STORY_TWO_ITEM_ID,
      project_id: PROJECT_ID,
      epic_id: EPIC_ID,
      ref_number: 5,
      ref: 'ALF-5',
      priority: 2,
    }),
    // Ranked BETTER than every Alfred story, so a project-scoped jump must stop short of it.
    makeCodeStory({
      item_id: OTHER_STORY_ITEM_ID,
      project_id: PROJECT_TWO_ID,
      epic_id: EPIC_TWO_ID,
      ref_number: 1,
      ref: 'RLP-1',
      priority: 0.5,
    }),
  ];

  await seed({ projects: [project, otherProject], epics: [epic, otherEpic], items, codeItems });

  // Open ALF-5's modal through the Backlog row's deep link and take it to the top of ITS PROJECT.
  await page.goto(`/code/${PROJECT_ID}?story=ALF-5`);
  const dialog = page.getByRole('dialog');
  const toTopOfProject = dialog.getByRole('button', { name: /top of project/i });
  await expect(toTopOfProject).toBeEnabled();

  const moveInProjectSynced = page.waitForResponse(
    (response) =>
      response.url().includes('/api/code/move-project') && response.request().method() === 'POST',
  );
  await toTopOfProject.click();
  // The optimistic re-rank lands instantly, so the jump it just satisfied disables.
  await expect(toTopOfProject).toBeDisabled();
  await moveInProjectSynced;

  // It persisted: ALF-5 now leads Alfred's stories but stays BEHIND the other project's.
  await page.goto('/code/backlog');
  const rows = page.getByRole('listitem');
  await expect(rows.nth(0)).toContainText('RLP-1');
  await expect(rows.nth(1)).toContainText('ALF-5');
  await expect(rows.nth(2)).toContainText('ALF-3');

  // Now take it to the top of the WHOLE Backlog, past the other project.
  await page.goto(`/code/${PROJECT_ID}?story=ALF-5`);
  const toTopOfBacklog = dialog.getByRole('button', { name: /top of backlog/i });
  const moveSynced = page.waitForResponse(
    (response) =>
      response.url().includes('/api/code/move') && response.request().method() === 'POST',
  );
  await toTopOfBacklog.click();
  await expect(toTopOfBacklog).toBeDisabled();
  await moveSynced;

  await page.goto('/code/backlog');
  await expect(page.getByRole('listitem').nth(0)).toContainText('ALF-5');
  await expect(page.getByRole('listitem').nth(1)).toContainText('RLP-1');
});
