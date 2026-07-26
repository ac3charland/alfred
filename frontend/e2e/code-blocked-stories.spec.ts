import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Code module — blocked stories on the board (ALF-136).
 *
 * Blocking is a flag on work in flight, not a destination: a blocked story keeps its card in the
 * swimlane it was blocked from, always visible (there is no *Show blocked* toggle), and the epic
 * header badges how many the epic holds. Only `abandoned` still sits in a bucket, behind
 * *Show abandoned*.
 *
 * These run against the real PATCH route, so they also exercise the server-side `blocked_from`
 * derivation end to end — the column is written from the STORED row, never the request body.
 *
 * `/api/code` validates ids as strict UUIDs, and `v_code_stories` only surfaces a story when its
 * backing `items` row is ALSO seeded (the view's inner join) — so each id is a real UUID and each
 * story is seeded as an item + a code_items sidecar.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EPIC_ID = '22222222-2222-4222-8222-222222222222';
const STORY_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const GONE_ITEM_ID = '55555555-5555-4555-8555-555555555555';

test('blocks a story in place, badges the epic, and unblocks it back to its lane', async ({
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
  const item = makeItem('Implement the allow-list parser', {
    id: STORY_ITEM_ID,
    item_type: 'code',
  });
  const story = makeCodeStory({
    item_id: STORY_ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 5,
    ref: 'ALF-5',
    factory_state: 'in_development',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });
  await page.goto(`/code/${PROJECT_ID}`);

  // There is no Show-blocked toggle any more — blocked work is never hidden.
  await expect(page.getByRole('button', { name: /show blocked/i })).toBeHidden();

  const inDevelopment = page.getByRole('region', { name: 'In Development' });
  await expect(inDevelopment.getByText('ALF-5')).toBeVisible();

  // Block it from the detail modal, with a reason.
  await inDevelopment.getByRole('button', { name: /open ALF-5/i }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: /^block$/i }).click();
  await modal.getByRole('textbox', { name: /why is this blocked/i }).fill('waiting on the vendor');
  await modal.getByRole('button', { name: /confirm block/i }).click();
  // The modal's state chip, keyed by its data attribute — the bare text "Blocked" also matches
  // the "Why is this blocked?" field label.
  await expect(modal.locator('[data-factory-state="blocked"]')).toBeVisible();
  await modal.getByRole('button', { name: /close/i }).click();
  await expect(modal).toBeHidden();

  // It stays in In Development — now carrying its Blocked pill — instead of moving to a bucket.
  await expect(inDevelopment.getByText('Blocked')).toBeVisible();
  await expect(inDevelopment.getByText('ALF-5')).toBeVisible();

  // The epic header badges the count, and keeps it while collapsed.
  await expect(page.getByText('1 blocked')).toBeVisible();
  const epicHeader = page.getByRole('button', { name: /^communication firewall/i });
  await epicHeader.click();
  await expect(epicHeader).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('1 blocked')).toBeVisible();
  await epicHeader.click();

  // Unblock sends it back to the state it was blocked from — proving `blocked_from` round-tripped
  // through the real PATCH route and the database.
  await inDevelopment.getByRole('button', { name: /open ALF-5/i }).click();
  await modal.getByRole('button', { name: /unblock to in development/i }).click();
  await expect(modal.locator('[data-factory-state="in_development"]')).toBeVisible();
  await modal.getByRole('button', { name: /close/i }).click();
  await expect(modal).toBeHidden();

  await expect(page.getByText('1 blocked')).toBeHidden();
  await expect(inDevelopment.getByText('ALF-5')).toBeVisible();
  await expect(inDevelopment.getByText('Blocked')).toBeHidden();
});

test('keeps abandoned stories behind the Show abandoned toggle', async ({ page, seed }) => {
  const project = makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const item = makeItem('Retire the legacy importer', { id: GONE_ITEM_ID, item_type: 'code' });
  const story = makeCodeStory({
    item_id: GONE_ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 9,
    ref: 'ALF-9',
    factory_state: 'abandoned',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });
  await page.goto(`/code/${PROJECT_ID}`);

  // Abandoned has no lane to return to, so it stays hidden until the toggle reveals its bucket.
  await expect(page.getByText('ALF-9')).toBeHidden();
  await page.getByRole('button', { name: /show abandoned/i }).click();
  await expect(page.getByRole('heading', { name: 'Abandoned' })).toBeVisible();
  await expect(page.getByText('ALF-9')).toBeVisible();

  // An abandoned story is not blocked, so no badge appears.
  await expect(page.getByText(/\d+ blocked/)).toBeHidden();
});
