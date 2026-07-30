import type { Locator, Page } from '@playwright/test';

import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { boxOf, pickUp } from './support/drag';
import { expect, test } from './support/fixtures';

/**
 * Drag a code story between swimlanes (ALF-155). A card's body is its drag surface; every lane
 * of the card's OWN epic is a drop target. A drop routes through the same optimistic
 * `updateCodeState` the detail modal's status menu uses, so the card lands in its new lane
 * instantly and the transition is durable.
 *
 * These run against the real PATCH route, so a reload proves the write reached the server
 * rather than only the store.
 */

const PROJECT = makeProject('Alfred', { id: 'p1', key: 'ALF' });

/**
 * Glide the pointer to `target`'s centre, re-measuring between attempts until it settles there.
 * The lane row scrolls horizontally, and dnd-kit auto-scrolls it while a card is dragged near
 * its edge — so a lane measured before the glide has often moved by the time the pointer
 * arrives, landing the drop on a neighbouring lane.
 */
async function glideTo(page: Page, target: Locator): Promise<void> {
  await expect(async () => {
    const before = await boxOf(target);
    const x = before.x + before.width / 2;
    await page.mouse.move(x, before.y + before.height / 2, { steps: 10 });
    // Re-measure: the pointer is only really over the lane if the lane is still under it.
    const after = await boxOf(target);
    expect(x).toBeGreaterThanOrEqual(after.x);
    expect(x).toBeLessThanOrEqual(after.x + after.width);
  }).toPass({ timeout: 10_000 });
}

/** Drag `source` onto `target` and release once THAT lane has armed itself as the drop target. */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  await pickUp(page, source);
  await expect(async () => {
    const to = await boxOf(target);
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    // Assert on the target's OWN marker, not just "some lane lit up" — with six lanes under an
    // auto-scrolling row, the wrong one arming is exactly the failure worth catching.
    await expect(target).toHaveAttribute('data-drop-over', 'true', { timeout: 750 });
  }).toPass({ timeout: 10_000 });
  await page.mouse.up();
}

/** Drag `source` over `target` and release, asserting the lane refused to arm itself. */
async function dragOntoRefused(page: Page, source: Locator, target: Locator): Promise<void> {
  await pickUp(page, source);
  await glideTo(page, target);
  // The pointer is over the lane and the card is still lifted — so the missing marker is the
  // lane declining this drag, not the drag failing to reach it.
  await expect(page.locator('.opacity-40')).toBeVisible();
  await expect(target).not.toHaveAttribute('data-drop-over', 'true');
  await page.mouse.up();
}

test('moves a story to the lane it is dropped on, and the move survives a reload', async ({
  page,
  seed,
}) => {
  const epic = makeEpic('Communication Firewall', {
    id: 'e1',
    project_id: 'p1',
    ref_number: 1,
    ref: 'ALF-1',
  });
  const item = makeItem('Draft the inbound filter spec', { id: 'i1', item_type: 'code' });
  const story = makeCodeStory({
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 3,
    ref: 'ALF-3',
    factory_state: 'needs_refinement',
  });

  await seed({ projects: [PROJECT], epics: [epic], items: [item], codeItems: [story] });
  await page.goto('/code/p1');

  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  const inDevelopment = page.getByRole('region', { name: 'In Development' });
  await expect(needsRefinement.getByText('ALF-3')).toBeVisible();

  await dragOnto(page, needsRefinement.getByText('Draft the inbound filter spec'), inDevelopment);

  // Optimistic: the card leaves its old lane for the target lane immediately ...
  await expect(inDevelopment.getByText('ALF-3')).toBeVisible();
  await expect(needsRefinement.getByText('ALF-3')).toBeHidden();

  // ... and the PATCH is durable, so a full reload finds it in the new lane.
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'In Development' }).getByText('ALF-3'),
  ).toBeVisible();
});

test('refuses a drop on another epic lane, leaving the story where it was', async ({
  page,
  seed,
}) => {
  // Two epics, so the board renders two rows of six lanes. The gesture is state-only: a lane
  // belonging to the OTHER epic is not a target, so nothing moves.
  const epicOne = makeEpic('Communication Firewall', {
    id: 'e1',
    project_id: 'p1',
    ref_number: 1,
    ref: 'ALF-1',
  });
  const epicTwo = makeEpic('Capture Pipeline', {
    id: 'e2',
    project_id: 'p1',
    ref_number: 2,
    ref: 'ALF-2',
  });
  const item = makeItem('Draft the inbound filter spec', { id: 'i1', item_type: 'code' });
  const story = makeCodeStory({
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 3,
    ref: 'ALF-3',
    factory_state: 'needs_refinement',
  });

  await seed({
    projects: [PROJECT],
    epics: [epicOne, epicTwo],
    items: [item],
    codeItems: [story],
  });
  await page.goto('/code/p1');

  // Each epic renders its own set of lanes, so scope by the epic's section.
  const otherEpic = page.getByRole('region', { name: /^capture pipeline/i });
  const ownEpic = page.getByRole('region', { name: /^communication firewall/i });
  const ownLane = ownEpic.getByRole('region', { name: 'Needs Refinement' });

  await dragOntoRefused(
    page,
    ownLane.getByText('Draft the inbound filter spec'),
    otherEpic.getByRole('region', { name: 'In Development' }),
  );

  // The card stayed put — in its own epic's original lane, and in no lane of the other epic.
  await expect(ownLane.getByText('ALF-3')).toBeVisible();
  await expect(otherEpic.getByText('ALF-3')).toBeHidden();
});

test('unblocks a blocked story into the lane it is dragged to', async ({ page, seed }) => {
  // A blocked card sits in the lane it was blocked FROM, carrying its Blocked tag and feeding
  // the epic's blocked badge. Dragging it to a lane is a real transition: it lands there
  // unblocked, and the reason it carried is cleared by the same write.
  const epic = makeEpic('Communication Firewall', {
    id: 'e1',
    project_id: 'p1',
    ref_number: 1,
    ref: 'ALF-1',
  });
  const item = makeItem('Implement the allow-list parser', { id: 'i1', item_type: 'code' });
  const story = makeCodeStory({
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 5,
    ref: 'ALF-5',
    factory_state: 'blocked',
    blocked_from: 'in_development',
    blocked_reason: 'waiting on the vendor',
  });

  await seed({ projects: [PROJECT], epics: [epic], items: [item], codeItems: [story] });
  await page.goto('/code/p1');

  const inDevelopment = page.getByRole('region', { name: 'In Development' });
  const readyForReview = page.getByRole('region', { name: 'Ready for Review' });
  await expect(inDevelopment.getByText('Blocked')).toBeVisible();
  await expect(page.getByText('1 blocked')).toBeVisible();

  await dragOnto(page, inDevelopment.getByText('Implement the allow-list parser'), readyForReview);

  // It landed in the target lane, no longer blocked — so the card's tag and the epic's badge go.
  await expect(readyForReview.locator('[data-factory-state="ready_for_review"]')).toBeVisible();
  await expect(page.locator('[data-factory-state="blocked"]')).toBeHidden();
  await expect(page.getByText('1 blocked')).toBeHidden();

  // The cleared reason round-tripped: the detail modal offers Block afresh rather than Unblock.
  await readyForReview.getByRole('button', { name: /^open alf-5/i }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('button', { name: 'Block', exact: true })).toBeVisible();
  await expect(modal.getByRole('button', { name: /unblock/i })).toBeHidden();
});
