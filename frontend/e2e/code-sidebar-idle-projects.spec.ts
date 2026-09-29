import type { Locator } from '@playwright/test';

import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Code sidebar grays out a project with no active items — no stories, or only done/abandoned
 * ones. Asserted on the browser's computed styles, so it also proves the Tailwind utilities the
 * unit tests only see as class names really generate: dimmed and desaturated at rest, full strength
 * on hover and on keyboard focus, and never on the board you're viewing.
 *
 * Seed: Alfred has an open story, Beacon a blocked one (still active), Relay only a done one, and
 * Corral none at all.
 */

const ALFRED = makeProject('Alfred', { id: '11111111-1111-4111-8111-111111111111', key: 'ALF' });
const RELAY = makeProject('Relay', {
  id: '22222222-2222-4222-8222-222222222222',
  key: 'RLP',
  repo_name: 'relay',
});
const BEACON = makeProject('Beacon', {
  id: '33333333-3333-4333-8333-333333333333',
  key: 'BCN',
  repo_name: 'beacon',
});
const CORRAL = makeProject('Corral', {
  id: '44444444-4444-4444-8444-444444444444',
  key: 'COR',
  repo_name: 'corral',
});

const EPICS = [
  makeEpic('Alfred work', { id: 'a1111111-1111-4111-8111-111111111111', project_id: ALFRED.id }),
  makeEpic('Relay work', { id: 'a2222222-2222-4222-8222-222222222222', project_id: RELAY.id }),
  makeEpic('Beacon work', { id: 'a3333333-3333-4333-8333-333333333333', project_id: BEACON.id }),
];

const STORIES = [
  { id: 'b1111111-1111-4111-8111-111111111111', epic: EPICS[0], state: 'in_development' },
  { id: 'b2222222-2222-4222-8222-222222222222', epic: EPICS[1], state: 'done' },
  { id: 'b3333333-3333-4333-8333-333333333333', epic: EPICS[2], state: 'blocked' },
] as const;

const items = STORIES.map((story) =>
  makeItem(`Story ${story.state}`, { id: story.id, item_type: 'code' }),
);
const codeItems = STORIES.map((story, index) =>
  makeCodeStory({
    item_id: story.id,
    project_id: story.epic?.project_id ?? '',
    epic_id: story.epic?.id ?? '',
    ref_number: index + 1,
    priority: index + 1,
    factory_state: story.state,
  }),
);

/** Assert a sidebar row's rendered strength — `toHaveCSS` retries through the 100ms transition. */
async function expectDimmed(row: Locator) {
  await expect(row).toHaveCSS('opacity', '0.5');
  await expect(row).toHaveCSS('filter', 'grayscale(1)');
}
// A row that was never dimmed has no filter; one restored by hover/focus carries `grayscale(0)`.
async function expectFullStrength(row: Locator) {
  await expect(row).toHaveCSS('opacity', '1');
  await expect(row).toHaveCSS('filter', /^(none|grayscale\(0\))$/);
}

test('grays out idle projects and restores them on hover, focus and selection', async ({
  page,
  seed,
}) => {
  await seed({
    projects: [ALFRED, RELAY, BEACON, CORRAL],
    epics: EPICS,
    items,
    codeItems,
  });
  await page.goto('/code/backlog');

  const nav = page.getByRole('navigation', { name: 'Projects' });
  const alfred = nav.getByRole('link', { name: /Alfred/ });
  const beacon = nav.getByRole('link', { name: /Beacon/ });
  const relay = nav.getByRole('link', { name: /Relay/ });
  const corral = nav.getByRole('link', { name: /Corral/ });

  // At rest: projects with open work (Beacon's is blocked) keep full strength; the rest fade.
  await expectFullStrength(alfred);
  await expectFullStrength(beacon);
  await expectDimmed(relay);
  await expectDimmed(corral);

  // A real pointer over an idle row brings it back; leaving dims it again.
  await relay.hover();
  await expectFullStrength(relay);
  await expectDimmed(corral);
  await page.mouse.move(700, 400);
  await expectDimmed(relay);

  // Keyboard focus does the same — Tab from the active row above lands on Relay.
  await beacon.focus();
  await page.keyboard.press('Tab');
  await expect(relay).toBeFocused();
  await expectFullStrength(relay);

  // Opening an idle project's board keeps its own row at full strength; the others stay faded.
  await corral.click();
  await page.mouse.move(700, 400);
  await expect(page).toHaveURL(new RegExp(`/code/${CORRAL.id}$`));
  await expectFullStrength(corral);
  await expectDimmed(relay);
});
