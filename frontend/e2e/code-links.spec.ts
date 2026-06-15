import type { Page } from '@playwright/test';

import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * M5 — Links & launch (§11). A `needs_refinement` story shows the phase-appropriate
 * **Refine in Claude Code** button on its card. Clicking it is the §11.3 transition trigger:
 * the store AWAITS the state write (the card moves from the Needs Refinement swimlane to In
 * Refinement) and THEN opens a prefilled claude.ai/code tab.
 *
 * We stub `window.open` via an init script so the test captures the launched URL without the
 * browser actually navigating to claude.ai (which is external + CDN-gated in the sandbox).
 *
 * Stories are seeded as an items row + a code_items sidecar (the view's inner-join), and the
 * /api/code endpoints validate ids as strict UUIDs, so every seeded id is a real UUID.
 */

/** The global the stubbed `window.open` records each opened URL into. */
interface OpenCaptureWindow {
  __openedUrls?: string[];
}

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EPIC_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '99999999-9999-4999-8999-999999999999';

/**
 * Replace `window.open` (before any app script runs) with a recorder that captures the URL
 * and opens nothing — so the test asserts the launched link without navigating to the
 * external, CDN-gated claude.ai. Read the captured URLs via `getOpenedUrls`.
 */
async function stubWindowOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win: OpenCaptureWindow & typeof globalThis = globalThis;
    win.__openedUrls = [];
    win.open = (url?: string | URL) => {
      win.__openedUrls?.push(typeof url === 'string' ? url : (url?.toString() ?? ''));
      return null;
    };
  });
}

/** The URLs `window.open` was called with since the page loaded. */
function getOpenedUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as OpenCaptureWindow).__openedUrls ?? []);
}

test('a needs_refinement story launches a refinement session and advances to In Refinement', async ({
  page,
  seed,
}) => {
  const project = makeProject('Alfred', {
    id: PROJECT_ID,
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
  });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const item = makeItem('Draft the inbound filter spec', { id: ITEM_ID, item_type: 'code' });
  const story = makeCodeStory({
    item_id: ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 3,
    ref: 'ALF-3',
    factory_state: 'needs_refinement',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });

  // Stub window.open before any app script runs: record the URL, open nothing.
  await stubWindowOpen(page);

  await page.goto(`/code/${PROJECT_ID}`);

  // The card sits in Needs Refinement and shows the Refine launch button.
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  await expect(needsRefinement.getByText('ALF-3')).toBeVisible();
  const launch = needsRefinement.getByRole('button', { name: /refine in claude code/i });
  await expect(launch).toBeVisible();

  await launch.click();

  // The await-write moves the card out of Needs Refinement and into In Refinement.
  const inRefinement = page.getByRole('region', { name: 'In Refinement' });
  await expect(inRefinement.getByText('ALF-3')).toBeVisible();
  await expect(needsRefinement.getByText('ALF-3')).toBeHidden();

  // No launch button applies in the in_refinement state.
  await expect(inRefinement.getByRole('button', { name: /claude code/i })).toBeHidden();

  // The prefilled claude.ai/code tab was opened with the repo + an encoded prompt.
  const opened = await getOpenedUrls(page);
  expect(opened).toHaveLength(1);
  const url = opened[0] ?? '';
  expect(url).toContain('https://claude.ai/code?repo=ac3charland%2Falfred');
  const prompt = new URL(url).searchParams.get('q') ?? '';
  expect(prompt).toContain('ALF-3: Draft the inbound filter spec');
  expect(prompt).toContain('phase: refinement');
});

test('a ready_for_dev story launches an implementation session and advances to In Development', async ({
  page,
  seed,
}) => {
  const project = makeProject('Alfred', {
    id: PROJECT_ID,
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
  });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const item = makeItem('Implement the allow-list parser', { id: ITEM_ID, item_type: 'code' });
  const story = makeCodeStory({
    item_id: ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 5,
    ref: 'ALF-5',
    factory_state: 'ready_for_dev',
    spec_path: 'specs/ALF-5.md',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });

  await stubWindowOpen(page);

  await page.goto(`/code/${PROJECT_ID}`);

  const readyForDev = page.getByRole('region', { name: 'Ready for Dev' });
  const launch = readyForDev.getByRole('button', { name: /implement in claude code/i });
  await expect(launch).toBeVisible();

  await launch.click();

  const inDevelopment = page.getByRole('region', { name: 'In Development' });
  await expect(inDevelopment.getByText('ALF-5')).toBeVisible();
  await expect(readyForDev.getByText('ALF-5')).toBeHidden();

  const opened = await getOpenedUrls(page);
  expect(opened).toHaveLength(1);
  const prompt = new URL(opened[0] ?? '').searchParams.get('q') ?? '';
  expect(prompt).toContain('ALF-5: Implement the allow-list parser');
  expect(prompt).toContain('phase: implementation');
  expect(prompt).toContain('specs/ALF-5.md');
});
