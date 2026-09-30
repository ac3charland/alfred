import type { Locator, Page } from '@playwright/test';

import {
  type SeedState,
  makeCodeStory,
  makeEpic,
  makeItem,
  makeProject,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The story detail on a phone: a full-screen sheet sized to the part of the screen above the
 * keyboard, with what you read scrolling and every action pinned in a bottom bar.
 *
 * A real browser is the only place these mean anything — jsdom has no layout, so it can confirm
 * classes but not that a box sits above another, that a textarea has no inner overflow, or that
 * the sheet's height follows the viewport. CI can't raise an on-screen keyboard, so a shorter
 * viewport (`setViewportSize`) stands in for one: `window.visualViewport` shrinks exactly as it
 * does when iOS raises the keyboard, which is what the sheet tracks.
 *
 * `hasTouch: true` makes the pointer coarse, as on a phone (which is also what lifts fields to
 * the 16px that stops iOS zooming on focus).
 */
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EPIC_ID = '22222222-2222-4222-8222-222222222222';
const STORY_ITEM_ID = '44444444-4444-4444-8444-444444444444';

/** Enough lines that the sheet's body has to scroll, at any phone width. */
function longNote(lines = 40): string {
  return Array.from(
    { length: lines },
    (_, index) => `Line ${String(index + 1)}: the owner wants the firewall to default-deny.`,
  ).join('\n');
}

/** Seed one story and open its detail on the phone, returning the sheet. */
async function openSheet(
  page: Page,
  seed: (state: SeedState) => Promise<void>,
  options: { notes?: string | null; factoryState?: 'ready_for_dev' | 'in_development' } = {},
) {
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
    notes: options.notes ?? null,
  });
  const story = makeCodeStory({
    item_id: STORY_ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 5,
    ref: 'ALF-5',
    factory_state: options.factoryState ?? 'ready_for_dev',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });
  await page.goto(`/code/${PROJECT_ID}`);
  await page.getByRole('button', { name: /open ALF-5/i }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The sheet's three regions. */
function regions(sheet: Locator) {
  return {
    header: sheet.locator('[data-sheet-header]'),
    body: sheet.locator('[data-sheet-body]'),
    footer: sheet.locator('[data-sheet-footer]'),
  };
}

/** Scroll the sheet's body all the way down. */
async function scrollToEnd(body: Locator) {
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('expected the element to have a box');
  return found;
}

async function heightOf(locator: Locator) {
  const { height } = await box(locator);
  return height;
}

test('the story opens as a sheet that fills the phone, with no radius or border', async ({
  page,
  seed,
}) => {
  const sheet = await openSheet(page, seed);

  expect(await box(sheet)).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  const chrome = await sheet.evaluate((element) => {
    const style = getComputedStyle(element);
    return { radius: style.borderTopLeftRadius, border: style.borderTopWidth };
  });
  expect(chrome).toEqual({ radius: '0px', border: '0px' });
});

test('scrolling the body to the end leaves the header, the × and the action bar in view', async ({
  page,
  seed,
}) => {
  const sheet = await openSheet(page, seed, { notes: longNote() });
  const { header, body, footer } = regions(sheet);

  await scrollToEnd(body);

  // It really scrolled: the content is taller than its region.
  expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const headerBox = await box(header);
  expect(headerBox.y).toBe(0);
  const closeBox = await box(sheet.getByRole('button', { name: 'Close' }));
  expect(closeBox.y).toBeGreaterThanOrEqual(0);
  expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(headerBox.height);
  // The bar sits at the bottom of the screen, its controls all inside it.
  const footerBox = await box(footer);
  expect(footerBox.y + footerBox.height).toBe(844);
  await expect(footer.getByRole('button', { name: 'Implement' })).toBeInViewport({ ratio: 1 });
  await expect(footer.getByRole('button', { name: 'More story actions' })).toBeInViewport({
    ratio: 1,
  });
});

test('the notes editor grows to show a long note in full, with no inner scroll', async ({
  page,
  seed,
}) => {
  const sheet = await openSheet(page, seed, { notes: 'A short note.' });

  await sheet.getByText('A short note.').click();
  const editor = sheet.getByRole('textbox', { name: 'Edit notes' });
  const before = await box(editor);
  await editor.fill(longNote(20));

  const { scrollHeight, clientHeight } = await editor.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(scrollHeight).toBe(clientHeight);
  // …and it actually grew to fit, rather than staying its opening height.
  const after = await box(editor);
  expect(after.height).toBeGreaterThan(before.height * 3);
});

test('an empty note opens at four rows', async ({ page, seed }) => {
  const sheet = await openSheet(page, seed);

  await sheet.getByText('Add notes…').click();
  const editor = sheet.getByRole('textbox', { name: 'Edit notes' });

  const { height, fourRows } = await editor.evaluate((element) => {
    const style = getComputedStyle(element);
    const px = Number.parseFloat;
    return {
      height: element.getBoundingClientRect().height,
      fourRows:
        4 * px(style.lineHeight) +
        px(style.paddingTop) +
        px(style.paddingBottom) +
        px(style.borderTopWidth) +
        px(style.borderBottomWidth),
    };
  });
  expect(height).toBeCloseTo(fourRows, 0);
});

test('editing puts Save and Cancel in the footer, outside the scroll region', async ({
  page,
  seed,
}) => {
  const sheet = await openSheet(page, seed, { notes: longNote() });
  const { body, footer } = regions(sheet);

  await sheet.getByText(/Line 1:/).click();

  await expect(footer.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(footer.getByRole('button', { name: 'Cancel' })).toBeVisible();
  // The action bar has stepped aside, and nothing of the editor's actions is in the body.
  await expect(footer.getByRole('button', { name: 'More story actions' })).toBeHidden();
  await expect(body.getByRole('button', { name: 'Save' })).toBeHidden();
});

test('with the keyboard up, the sheet follows the visible viewport and the editor stays clear of Save', async ({
  page,
  seed,
}) => {
  const sheet = await openSheet(page, seed, { notes: longNote() });
  const { header, body, footer } = regions(sheet);
  await sheet.getByText(/Line 1:/).click();
  const editor = sheet.getByRole('textbox', { name: 'Edit notes' });
  await expect(editor).toBeFocused();

  // The stand-in for a raised keyboard: the visible viewport shrinks.
  await page.setViewportSize({ width: 390, height: 470 });

  await expect.poll(() => heightOf(sheet)).toBe(470);
  const saveBox = await box(footer.getByRole('button', { name: 'Save' }));
  expect(saveBox.y).toBeGreaterThanOrEqual(0);
  expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(470);
  // The footer is the bottom of the visible screen.
  const footerBox = await box(footer);
  expect(footerBox.y + footerBox.height).toBe(470);
  // The focused editor is still on screen: some of it sits between the header and the footer.
  const headerBox = await box(header);
  const headerBottom = headerBox.y + headerBox.height;
  const editorBox = await box(editor);
  expect(editorBox.y).toBeLessThan(footerBox.y);
  expect(editorBox.y + editorBox.height).toBeGreaterThan(headerBottom);

  // Scrolled to the end, the editor's bottom edge is above the footer's top — the bar never
  // covers the text, at any scroll position.
  await scrollToEnd(body);
  const endEditor = await box(editor);
  const endFooter = await box(footer);
  expect(endEditor.y + endEditor.height).toBeLessThanOrEqual(endFooter.y);
});

test('the block-reason editor behaves the same way with the keyboard up', async ({
  page,
  seed,
}) => {
  const sheet = await openSheet(page, seed, { factoryState: 'in_development' });
  const { body, footer } = regions(sheet);
  await sheet.getByRole('button', { name: 'More story actions' }).click();
  await page.getByRole('menuitem', { name: 'Block…' }).click();
  const reason = sheet.getByRole('textbox', { name: /why is this blocked/i });
  await expect(reason).toBeFocused();
  await reason.fill(longNote(12));

  await page.setViewportSize({ width: 390, height: 470 });

  await expect.poll(() => heightOf(sheet)).toBe(470);
  await expect(footer.getByRole('button', { name: 'Confirm block' })).toBeInViewport({
    ratio: 1,
  });
  await scrollToEnd(body);
  const endReason = await box(reason);
  const endFooter = await box(footer);
  expect(endReason.y + endReason.height).toBeLessThanOrEqual(endFooter.y);
  expect(await reason.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
});

test('a long unbroken word wraps inside the notes well instead of scrolling the sheet sideways', async ({
  page,
  seed,
}) => {
  // No `/`, `-` or space to break at, as browsers break URLs there: one word wider than the well.
  const word = `See ${'x'.repeat(160)}`;
  const sheet = await openSheet(page, seed, { notes: word });
  const { body } = regions(sheet);

  const overflow = await body.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBe(0);
  // The pencil is still inside the well, not pushed off its edge.
  const well = await box(sheet.getByRole('button', { name: /^See x+/ }));
  const pencil = await box(sheet.getByRole('button', { name: /^See x+/ }).locator('svg'));
  expect(pencil.x + pencil.width).toBeLessThanOrEqual(well.x + well.width);
});

test('a reason editor added below a long note is revealed, and stays clear of the footer when the keyboard rises', async ({
  page,
  seed,
}) => {
  const sheet = await openSheet(page, seed, {
    factoryState: 'in_development',
    notes: longNote(),
  });
  const { footer } = regions(sheet);
  await sheet.getByRole('button', { name: 'More story actions' }).click();
  await page.getByRole('menuitem', { name: 'Block…' }).click();
  const reason = sheet.getByRole('textbox', { name: /why is this blocked/i });
  await expect(reason).toBeFocused();
  // Appended at the end of a body far taller than the screen, yet scrolled into view.
  await expect(reason).toBeInViewport({ ratio: 1 });

  // The keyboard rises under the focused field: nothing scrolls by hand, so the sheet itself has
  // to bring the field back above the footer.
  await page.setViewportSize({ width: 390, height: 470 });

  await expect.poll(() => heightOf(sheet)).toBe(470);
  await expect
    .poll(async () => {
      const field = await box(reason);
      const bar = await box(footer);
      return field.y + field.height <= bar.y;
    })
    .toBe(true);
});
