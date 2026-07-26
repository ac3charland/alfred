import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The project board's header controls at a phone width (ALF-134). The fold is done with
 * Tailwind's `md:` prefix, which keys on the **real browser viewport** — jsdom never applies it —
 * so this is the suite that actually proves the responsive behaviour:
 *
 * - below `md` the three view filters (Filter by status / Show abandoned / Show archived) are gone
 *   from the header and live inside a single ⋯ menu, which still drives the board;
 * - "Collapse all" keeps its accessible name but shows only its chevron glyph;
 * - "Create epic" stays a visible button at every width;
 * - at desktop width nothing changed: the filters are inline and the ⋯ is absent.
 */

// A project with one active epic, one archived epic, and an abandoned story — enough for all
// three folded filters to have something to reveal.
const PROJECT = makeProject('Alfred', { id: 'p1', key: 'ALF' });
const ACTIVE_EPIC = makeEpic('Communication Firewall', {
  id: 'e1',
  project_id: 'p1',
  ref_number: 1,
  ref: 'ALF-1',
});
const ARCHIVED_EPIC = makeEpic('Retired Plumbing', {
  id: 'e2',
  project_id: 'p1',
  ref_number: 2,
  ref: 'ALF-2',
  archived_at: '2026-01-15T00:00:00Z',
});
const ABANDONED_ITEM = makeItem('Dropped in favour of the vendor', { id: 'i1', item_type: 'code' });
const ABANDONED_STORY = makeCodeStory({
  item_id: 'i1',
  project_id: 'p1',
  epic_id: 'e1',
  ref_number: 3,
  ref: 'ALF-3',
  factory_state: 'abandoned',
});

const SEED = {
  projects: [PROJECT],
  epics: [ACTIVE_EPIC, ARCHIVED_EPIC],
  items: [ABANDONED_ITEM],
  codeItems: [ABANDONED_STORY],
};

test.describe('at a phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('folds the view filters into the ⋯ menu and keeps driving the board from it', async ({
    page,
    seed,
  }) => {
    await seed(SEED);
    await page.goto('/code/p1');

    // The header keeps only the primary action, the condensed collapse-all, and the ⋯.
    await expect(page.getByRole('button', { name: /create epic/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse all' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Board filters' })).toBeVisible();
    // The inline filter controls are folded away.
    await expect(page.getByRole('button', { name: 'Filter by status' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show abandoned' })).toBeHidden();
    await expect(page.getByRole('button', { name: /show archived/i })).toBeHidden();

    // Neither the archived epic nor the abandoned story is on the board at rest.
    await expect(page.getByRole('button', { name: /^retired plumbing/i })).toBeHidden();
    await expect(page.getByText('ALF-3')).toBeHidden();

    // The menu carries all three filters, and stays open across several toggles.
    await page.getByRole('button', { name: 'Board filters' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: /filter by status/i })).toBeVisible();
    await menu.getByRole('menuitemcheckbox', { name: 'Show archived' }).click();
    await menu.getByRole('menuitemcheckbox', { name: 'Show abandoned' }).click();

    // The menu is modal — while it's open Radix `aria-hidden`s the board behind it, so assert
    // the board only once it's dismissed.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.getByRole('button', { name: /^retired plumbing/i })).toBeVisible();
    await expect(page.getByText('ALF-3')).toBeVisible();
  });

  test('condenses Collapse all to a glyph while keeping its accessible name', async ({
    page,
    seed,
  }) => {
    await seed(SEED);
    await page.goto('/code/p1');

    // Named for a screen reader, but the label itself takes no visible space — the chevron
    // glyph does the work at this width.
    const collapseAll = page.getByRole('button', { name: 'Collapse all' });
    await expect(collapseAll).toBeVisible();
    const box = await collapseAll.boundingBox();
    expect(box?.width ?? 0).toBeLessThan(48);

    // …and it stands the same height as the buttons flanking it, so the header reads as one bar.
    const createEpic = await page.getByRole('button', { name: /create epic/i }).boundingBox();
    const more = await page.getByRole('button', { name: 'Board filters' }).boundingBox();
    expect(box?.height).toBe(createEpic?.height);
    expect(box?.height).toBe(more?.height);

    // It still collapses every epic.
    await expect(page.getByRole('region', { name: 'Needs Refinement' })).toBeVisible();
    await collapseAll.click();
    await expect(page.getByRole('region', { name: 'Needs Refinement' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open all' })).toBeVisible();
  });
});

test.describe('at a desktop width', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('keeps every control inline and shows no ⋯ menu', async ({ page, seed }) => {
    await seed(SEED);
    await page.goto('/code/p1');

    await expect(page.getByRole('button', { name: /create epic/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse all' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Filter by status' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show abandoned' })).toBeVisible();
    await expect(page.getByRole('button', { name: /show archived/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Board filters' })).toBeHidden();
  });
});
