import type { Page } from '@playwright/test';

import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Links & launch. A `needs_refinement` story shows the phase-appropriate
 * **Refine in Claude Code** button on its card. Clicking it triggers the transition:
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
  // The launch copies the prompt to the clipboard as the mobile paste-fallback; grant the
  // permission so the copy succeeds (and the confirming toast fires) under headless Chromium.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

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
  // `window.open` fires AFTER the awaited state write resolves, while the card moves
  // optimistically — so poll the one-shot capture rather than reading it once (racy).
  await expect.poll(() => getOpenedUrls(page)).toHaveLength(1);
  const opened = await getOpenedUrls(page);
  const url = opened[0] ?? '';
  expect(url).toContain('https://claude.ai/code?repo=ac3charland%2Falfred');
  const prompt = new URL(url).searchParams.get('q') ?? '';
  expect(prompt).toContain('ALF-3: Draft the inbound filter spec');
  expect(prompt).toContain('phase: refinement');

  // The prompt is also copied to the clipboard — a paste-fallback for the mobile Claude app,
  // which opens the universal link but drops the `q` prompt — and a toast confirms it.
  await expect(page.getByText('Prompt copied to clipboard')).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(prompt);
});

test('a needs_refinement story can SKIP refinement: bypass launches development and advances straight to In Development', async ({
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
  const item = makeItem('Tweak the digest send time', { id: ITEM_ID, item_type: 'code' });
  const story = makeCodeStory({
    item_id: ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 4,
    ref: 'ALF-4',
    factory_state: 'needs_refinement',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });

  await stubWindowOpen(page);

  await page.goto(`/code/${PROJECT_ID}`);

  // The card sits in Needs Refinement and shows BOTH the Refine and the Skip launch buttons.
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  await expect(needsRefinement.getByText('ALF-4')).toBeVisible();
  await expect(
    needsRefinement.getByRole('button', { name: /refine in claude code/i }),
  ).toBeVisible();
  const skip = needsRefinement.getByRole('button', { name: /skip to development/i });
  await expect(skip).toBeVisible();

  await skip.click();

  // The await-write skips In Refinement AND Ready for Dev — the card lands straight in
  // In Development.
  const inDevelopment = page.getByRole('region', { name: 'In Development' });
  await expect(inDevelopment.getByText('ALF-4')).toBeVisible();
  await expect(needsRefinement.getByText('ALF-4')).toBeHidden();

  // The prefilled tab opened with a blended skip-refinement prompt carrying phase: implementation.
  await expect.poll(() => getOpenedUrls(page)).toHaveLength(1);
  const opened = await getOpenedUrls(page);
  const url = opened[0] ?? '';
  expect(url).toContain('https://claude.ai/code?repo=ac3charland%2Falfred');
  const prompt = new URL(url).searchParams.get('q') ?? '';
  expect(prompt).toContain('ALF-4: Tweak the digest send time');
  expect(prompt).toContain('phase: implementation');
  // It must NOT instruct reading a committed spec (the skip flow produces none).
  expect(prompt).toContain('SKIP-REFINEMENT');
  expect(prompt).not.toMatch(/merged spec/i);
});

test('a Spike: story offers only the spike launch, and it advances to In Development', async ({
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
  const item = makeItem('Spike: outbound notifications via Telegram', {
    id: ITEM_ID,
    item_type: 'code',
  });
  const story = makeCodeStory({
    item_id: ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 6,
    ref: 'ALF-6',
    factory_state: 'needs_refinement',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });

  await stubWindowOpen(page);

  await page.goto(`/code/${PROJECT_ID}`);

  // Spike-ness is derived from the title prefix: the card is badged, and the two ordinary
  // needs_refinement actions are replaced by the single spike launch.
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  await expect(needsRefinement.getByText('ALF-6')).toBeVisible();
  await expect(needsRefinement.getByText('Spike', { exact: true })).toBeVisible();
  await expect(
    needsRefinement.getByRole('button', { name: /refine in claude code/i }),
  ).toBeHidden();
  await expect(needsRefinement.getByRole('button', { name: /skip to development/i })).toBeHidden();
  const launch = needsRefinement.getByRole('button', { name: /run spike in claude code/i });
  await expect(launch).toBeVisible();

  await launch.click();

  // One session produces the findings, so the spike launch lands the card in In Development.
  const inDevelopment = page.getByRole('region', { name: 'In Development' });
  await expect(inDevelopment.getByText('ALF-6')).toBeVisible();
  await expect(needsRefinement.getByText('ALF-6')).toBeHidden();

  await expect.poll(() => getOpenedUrls(page)).toHaveLength(1);
  const opened = await getOpenedUrls(page);
  const url = opened[0] ?? '';
  expect(url).toContain('https://claude.ai/code?repo=ac3charland%2Falfred');
  const prompt = new URL(url).searchParams.get('q') ?? '';
  expect(prompt).toContain('ALF-6: Spike: outbound notifications via Telegram');
  expect(prompt).toContain('phase: spike');
  expect(prompt).toContain('FINDINGS DOCUMENT ONLY');
  // The findings are long-lived: the prompt never sends the agent at the specs directory.
  expect(prompt).not.toContain('docs/specs');
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
    spec_path: 'docs/specs/ALF-5.md',
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

  // `window.open` fires only after the awaited state write resolves (the card moves
  // optimistically before then), so poll the capture rather than reading it once (racy).
  await expect.poll(() => getOpenedUrls(page)).toHaveLength(1);
  const opened = await getOpenedUrls(page);
  const prompt = new URL(opened[0] ?? '').searchParams.get('q') ?? '';
  expect(prompt).toContain('ALF-5: Implement the allow-list parser');
  expect(prompt).toContain('phase: implementation');
  expect(prompt).toContain('docs/specs/ALF-5.md');
});

test('an epic launches an epic-refinement session from its 3-dot menu, changing no state', async ({
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
    ref_number: 12,
    ref: 'ALF-12',
    notes: 'Everything about how alfred talks to me.',
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

  await stubWindowOpen(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto(`/code/${PROJECT_ID}`);

  await page.getByRole('button', { name: 'Epic actions' }).click();
  await page.getByRole('menuitem', { name: /refine epic in claude code/i }).click();

  await expect.poll(() => getOpenedUrls(page)).toHaveLength(1);
  const opened = await getOpenedUrls(page);
  const url = opened[0] ?? '';
  expect(url).toContain('https://claude.ai/code?repo=ac3charland%2Falfred');
  const prompt = new URL(url).searchParams.get('q') ?? '';
  expect(prompt).toContain('ALF-12: Communication Firewall');
  expect(prompt).toContain('phase: epic-refinement');
  expect(prompt).toContain('.claude/skills/epic-refinement/SKILL.md');
  expect(prompt).toContain('Everything about how alfred talks to me.');

  // The prompt is copied for the mobile paste-fallback, exactly as the story launch does.
  await expect(page.getByText('Prompt copied to clipboard')).toBeVisible();

  // The story card has NOT moved — an epic launch writes no state at all.
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  await expect(needsRefinement.getByText('ALF-3')).toBeVisible();
});

test('an epic with a snapshotted spec offers View spec, and its stories’ prompts point at it', async ({
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
    ref_number: 12,
    ref: 'ALF-12',
    spec_path: 'docs/specs/epics/ALF-12.html',
    spec_sha: 'blobsha123',
    spec_markdown:
      '<!doctype html><html><body><h1>ALF-12 — Communication Firewall</h1><p>Default-deny.</p></body></html>',
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

  await stubWindowOpen(page);

  await page.goto(`/code/${PROJECT_ID}`);

  // The spec modal renders the snapshotted HTML in its sandboxed frame, with the sha-pinned link.
  await page.getByRole('button', { name: 'Epic actions' }).click();
  await page.getByRole('menuitem', { name: /view spec/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Communication Firewall')).toBeVisible();
  await expect(dialog.getByRole('link', { name: /view in repo/i })).toHaveAttribute(
    'href',
    'https://github.com/ac3charland/alfred/blob/blobsha123/docs/specs/epics/ALF-12.html',
  );
  // The HTML plan renders inside the sandboxed frame (the branch jsdom can only assert on).
  const frame = dialog.frameLocator('[data-testid="spec-html"]');
  await expect(frame.getByRole('heading', { name: /Communication Firewall/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // A story under that epic carries the epic-context paragraph in its launch prompt.
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  await needsRefinement.getByRole('button', { name: /refine in claude code/i }).click();

  await expect.poll(() => getOpenedUrls(page)).toHaveLength(1);
  const launched = await getOpenedUrls(page);
  const prompt = new URL(launched[0] ?? '').searchParams.get('q') ?? '';
  expect(prompt).toContain('Epic context:');
  expect(prompt).toContain('docs/specs/epics/ALF-12.html');
  expect(prompt).toContain("don't edit, archive, or move it");
});

test('a story created with "Needs refinement" unchecked lands in Ready for Dev and launches the SKIP-REFINEMENT prompt', async ({
  page,
  seed,
}) => {
  const project = makeProject('Alfred', {
    id: PROJECT_ID,
    key: 'ALF',
    repo_owner: 'ac3charland',
    repo_name: 'alfred',
    // The shared per-project ref counter stands at 6, so `create_code_story` allocates ALF-7.
    ref_seq: 6,
  });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 6,
    ref: 'ALF-6',
  });

  await seed({ projects: [project], epics: [epic], items: [], codeItems: [] });

  await stubWindowOpen(page);

  await page.goto(`/code/${PROJECT_ID}`);

  // Create the story with the box cleared — the decision "this needs no spec", made up front.
  await page.getByRole('button', { name: /new story in communication firewall/i }).click();
  await page.getByLabel(/title/i).fill('Bump the wrangler compatibility date');
  await page.getByRole('checkbox', { name: /needs refinement/i }).click();
  // The dialog states the consequence before submitting. `exact` so this matches the
  // description's trailing state, not the checkbox hint that also names the lane.
  await expect(page.getByRole('dialog').getByText('Ready for Dev', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^create$/i }).click();

  // It appears in Ready for Dev, never in Needs Refinement…
  const readyForDev = page.getByRole('region', { name: 'Ready for Dev' });
  await expect(readyForDev.getByText('ALF-7')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Needs Refinement' }).getByText('ALF-7'),
  ).toBeHidden();
  // …and, unlike Skip to Development, no tab was opened along the way.
  expect(await getOpenedUrls(page)).toHaveLength(0);

  // The launch is the normal Implement button, but its prompt is the skip-refinement one:
  // there is no committed spec for the agent to read.
  const launch = readyForDev.getByRole('button', { name: /implement in claude code/i });
  await expect(launch).toBeVisible();
  await launch.click();

  await expect.poll(() => getOpenedUrls(page)).toHaveLength(1);
  const opened = await getOpenedUrls(page);
  const prompt = new URL(opened[0] ?? '').searchParams.get('q') ?? '';
  expect(prompt).toContain('ALF-7: Bump the wrangler compatibility date');
  expect(prompt).toContain('phase: implementation');
  expect(prompt).toContain('SKIP-REFINEMENT');
  expect(prompt).not.toMatch(/merged spec/i);
});

test('the detail modal marks an existing story dev-ready without opening a tab', async ({
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
  const item = makeItem('Bump the wrangler compatibility date', {
    id: ITEM_ID,
    item_type: 'code',
  });
  const story = makeCodeStory({
    item_id: ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 8,
    ref: 'ALF-8',
    factory_state: 'needs_refinement',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });

  await stubWindowOpen(page);

  await page.goto(`/code/${PROJECT_ID}`);

  await page.getByRole('region', { name: 'Needs Refinement' }).getByText('ALF-8').click();
  const dialog = page.getByRole('dialog');
  const mark = dialog.getByRole('checkbox', { name: /needs refinement/i });
  await expect(mark).toBeChecked();

  await mark.click();

  // Behind the modal the card has moved, and the launch swapped from Refine to Implement.
  await expect(mark).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: /implement in claude code/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await expect(
    page.getByRole('region', { name: 'Ready for Dev' }).getByText('ALF-8'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Needs Refinement' }).getByText('ALF-8'),
  ).toBeHidden();
  // The whole point of the mark: the judgement is recorded with nothing launched.
  expect(await getOpenedUrls(page)).toHaveLength(0);
});
