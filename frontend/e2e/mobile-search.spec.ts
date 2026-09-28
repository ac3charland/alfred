import {
  makeCodeStory,
  makeEpic,
  makeFolder,
  makeItem,
  makeProject,
  makeWikiPage,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Global search on a phone: a header icon opens a full-screen sheet with full-width, 44px,
 * scrollable results. It replaced a field in the hamburger drawer whose results were a ~190px
 * popover that couldn't scroll — the drawer's modal scroll lock swallowed every touch and wheel
 * event on a list portalled outside it.
 *
 * Proven in a real browser: the `md:` breakpoint, the scroll lock, and the rendered sizes are all
 * things jsdom never resolves.
 */
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EPIC_ID = '22222222-2222-4222-8222-222222222222';

/** Enough "firewall" matches to overflow the screen: 10 tasks (capped at 8), 8 stories, 3 pages. */
function overflowingSeed() {
  const folder = makeFolder('Software');
  const tasks = Array.from({ length: 10 }, (_, index) =>
    makeItem(`Firewall task ${String(index + 1)}`, { item_type: 'task', folder_id: folder.id }),
  );
  const project = makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const storyItems = Array.from({ length: 8 }, (_, index) =>
    makeItem(`Firewall story ${String(index + 1)}`, {
      id: `44444444-4444-4444-8444-44444444444${String(index)}`,
      item_type: 'code',
    }),
  );
  const codeItems = storyItems.map((item, index) =>
    makeCodeStory({
      item_id: item.id,
      project_id: PROJECT_ID,
      epic_id: EPIC_ID,
      ref_number: 10 + index,
      ref: `ALF-${String(10 + index)}`,
      factory_state: 'ready_for_dev',
    }),
  );
  const wikiPages = ['a', 'b', 'c'].map((suffix) =>
    makeWikiPage(`wiki/concepts/firewall-${suffix}.md`, {
      title: `Firewall page ${suffix.toUpperCase()}`,
    }),
  );
  return {
    folders: [folder],
    items: [...tasks, ...storyItems],
    projects: [project],
    epics: [epic],
    codeItems,
    wikiPages,
  };
}

test('full-width, touch-sized results that scroll, reaching and opening the last one', async ({
  page,
  seed,
}) => {
  await seed(overflowingSeed());
  await page.goto('/');

  // The icon sits in the header's right-hand cluster, just before the account pill.
  const trigger = page.getByRole('button', { name: 'Search', exact: true });
  const accountMenu = page.getByRole('button', { name: 'Account menu' });
  await expect(trigger).toBeVisible();
  const triggerBox = await trigger.boundingBox();
  const accountBox = await accountMenu.boundingBox();
  expect(triggerBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(accountBox?.x ?? 0);

  await trigger.tap();
  const sheet = page.getByRole('dialog', { name: 'Search' });
  await expect(sheet).toBeVisible();

  const search = sheet.getByRole('combobox', { name: /search tasks, stories, and wiki pages/i });
  await expect(search).toBeFocused();
  const field = await search.evaluate((element) => ({
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    height: element.getBoundingClientRect().height,
  }));
  // ≥16px so iOS doesn't zoom on focus; 44px tall for the thumb.
  expect(field.fontSize).toBeGreaterThanOrEqual(16);
  expect(field.height).toBeGreaterThanOrEqual(44);

  await search.fill('firewall');
  const listbox = sheet.getByRole('listbox');
  // Newest first, so the two oldest tasks fall past the per-group cap of 8.
  await expect(listbox.getByText('Firewall task 10', { exact: true })).toBeVisible();
  await expect(sheet.getByText('+2 more — keep typing')).toBeVisible();
  await expect(sheet.getByText('19 results')).toBeVisible();

  // Results fill the sheet's width, and every row is a full 44px tap target.
  const listboxBox = await listbox.boundingBox();
  expect(listboxBox?.width ?? 0).toBeGreaterThanOrEqual(390 * 0.9);
  const heights = await listbox
    .getByRole('option')
    .evaluateAll((options) => options.map((option) => option.getBoundingClientRect().height));
  expect(heights).toHaveLength(19);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);

  // Regression for "can't scroll": a wheel over the results moves the list.
  const region = sheet.getByTestId('search-results-region');
  expect(await region.evaluate((element) => element.scrollTop)).toBe(0);
  await region.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  // The last result can be reached and opened.
  const lastOption = listbox.getByRole('option').last();
  const lastId = (await lastOption.getAttribute('id')) ?? '';
  const lastPath = decodeURIComponent(lastId.replace('search-option-wiki-', ''));
  expect(lastPath).toMatch(/^wiki\/concepts\/firewall-[abc]\.md$/);
  await lastOption.tap();

  await expect(page).toHaveURL(new RegExp(`/${lastPath.replace(/\.md$/, '')}$`));
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden();
});

test('dragging the results dismisses the keyboard but keeps the sheet and query', async ({
  page,
  seed,
}) => {
  await seed(overflowingSeed());
  await page.goto('/');

  await page.getByRole('button', { name: 'Search', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Search' });
  const search = sheet.getByRole('combobox');
  await expect(search).toBeFocused();
  await search.fill('firewall');

  const region = sheet.getByTestId('search-results-region');
  const box = await region.boundingBox();
  const x = (box?.x ?? 0) + 100;
  const y = (box?.y ?? 0) + 200;
  // A one-finger drag up the list: start, move, end — the move is what blurs the field.
  await region.dispatchEvent('touchstart', {
    touches: [{ identifier: 0, clientX: x, clientY: y }],
  });
  await region.dispatchEvent('touchmove', {
    touches: [{ identifier: 0, clientX: x, clientY: y - 120 }],
  });
  await region.dispatchEvent('touchend', { touches: [] });

  await expect(search).not.toBeFocused();
  await expect(sheet).toBeVisible();
  await expect(search).toHaveValue('firewall');
});

test('the hamburger drawer no longer carries a search field', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Open navigation' }).tap();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('group', { name: 'Switch module' })).toBeVisible();
  await expect(drawer.getByRole('combobox')).toHaveCount(0);
});

test.describe('at a desktop width', () => {
  test.use({ hasTouch: false, viewport: { width: 1280, height: 800 } });

  test('shows no search icon — the header field is the search', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('combobox', { name: /search tasks, stories, and wiki pages/i }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeHidden();
  });
});
