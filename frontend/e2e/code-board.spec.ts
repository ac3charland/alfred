import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Code module (shell + board): the Tasks ⇄ Code switcher reaches the `(code)` route
 * group, and a seeded project renders its board — epics stacked & collapsible, each
 * expanded into the six happy-path swimlanes, with stories as cards (ref + title) in the
 * lane matching their factory_state.
 *
 * A code story only surfaces in `v_code_stories` when a backing `items` row with the same
 * id is ALSO seeded (the view's inner join), so each story is seeded as an item + a
 * code_items sidecar.
 */

test('switches from Tasks to Code via the header switcher', async ({ page, seed }) => {
  await seed({});
  await page.goto('/?view=inbox');

  // The switcher segments are present; Code routes into the (code) group.
  await page.getByRole('link', { name: 'Code' }).click();
  await expect(page).toHaveURL('/code');

  // The Code landing guides the user to pick a project, and the switch back works —
  // Tasks lands on the module's default By-Priority view.
  await expect(page.getByRole('heading', { name: /software factory/i })).toBeVisible();
  await page.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL('/priority');
});

test('lists projects in the nav and opens a project board from it', async ({ page, seed }) => {
  const project = makeProject('Alfred', { id: 'p1', key: 'ALF' });
  await seed({ projects: [project] });
  await page.goto('/code');

  // The project appears in the sidebar nav; selecting it routes to its board. Scope to the
  // Projects nav so the link doesn't also match the `alfred` wordmark.
  const projectNav = page.getByRole('navigation', { name: 'Projects' });
  await projectNav.getByRole('link', { name: /alfred/i }).click();
  await expect(page).toHaveURL('/code/p1');
  await expect(page.getByRole('heading', { name: 'Alfred' })).toBeVisible();
});

test('renders seeded stories grouped into the right swimlanes under collapsible epics', async ({
  page,
  seed,
}) => {
  const project = makeProject('Alfred', { id: 'p1', key: 'ALF' });
  const epic = makeEpic('Communication Firewall', {
    id: 'e1',
    project_id: 'p1',
    ref_number: 1,
    ref: 'ALF-1',
  });

  // Two stories in different states, each backed by an items row (inner-join requirement).
  const refineItem = makeItem('Draft the inbound filter spec', { id: 'i1', item_type: 'code' });
  const refine = makeCodeStory({
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 3,
    ref: 'ALF-3',
    factory_state: 'needs_refinement',
  });
  const devItem = makeItem('Implement the allow-list parser', { id: 'i2', item_type: 'code' });
  const dev = makeCodeStory({
    item_id: 'i2',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 5,
    ref: 'ALF-5',
    factory_state: 'in_development',
  });

  await seed({
    projects: [project],
    epics: [epic],
    items: [refineItem, devItem],
    codeItems: [refine, dev],
  });
  await page.goto('/code/p1');

  // The epic header shows its name + ref and is collapsible. Anchor the name so it matches
  // the header toggle ("Communication Firewall …"), not the "New story in Communication
  // Firewall" + button that also lives in the header.
  const epicHeader = page.getByRole('button', { name: /^communication firewall/i });
  await expect(epicHeader).toBeVisible();
  await expect(epicHeader).toHaveAttribute('aria-expanded', 'true');

  // ALF-3 sits in the Needs Refinement lane; ALF-5 in the In Development lane.
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  await expect(needsRefinement.getByText('ALF-3')).toBeVisible();
  await expect(needsRefinement.getByText('Draft the inbound filter spec')).toBeVisible();

  const inDevelopment = page.getByRole('region', { name: 'In Development' });
  await expect(inDevelopment.getByText('ALF-5')).toBeVisible();
  await expect(inDevelopment.getByText('Implement the allow-list parser')).toBeVisible();

  // ALF-5 is not in the Needs Refinement lane (grouped by state).
  await expect(needsRefinement.getByText('ALF-5')).toBeHidden();

  // Collapsing the epic hides its swimlanes; re-expanding brings them back.
  await epicHeader.click();
  await expect(epicHeader).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: 'Needs Refinement' })).toBeHidden();

  await epicHeader.click();
  await expect(page.getByRole('region', { name: 'Needs Refinement' })).toBeVisible();
});

test('creates an epic from the board toolbar (allocating the shared ref)', async ({
  page,
  seed,
}) => {
  // A project with no epics (ref_seq 0 → the first allocated ref is ALF-1). The id is a real
  // UUID because POST /api/epics validates project_id as a UUID (the projects PK type).
  const projectId = '33333333-3333-4333-8333-333333333333';
  const project = makeProject('Alfred', { id: projectId, key: 'ALF' });
  await seed({ projects: [project] });
  await page.goto(`/code/${projectId}`);

  // The board starts empty and offers "Create epic" in its toolbar.
  await expect(page.getByText(/no epics yet/i)).toBeVisible();
  const createEpic = page.getByRole('button', { name: /create epic/i });
  await expect(createEpic).toBeVisible();

  // Open the New-epic dialog (scoped to this project) and submit a name.
  await createEpic.click();
  const epicDialog = page.getByRole('dialog', { name: /new epic/i });
  await expect(epicDialog).toBeVisible();
  await epicDialog.getByRole('textbox', { name: /epic name/i }).fill('Communication Firewall');
  await epicDialog.getByRole('button', { name: /create epic/i }).click();
  await expect(epicDialog).toBeHidden();

  // The new epic lands on the board: its header (anchored so it doesn't match the "New story
  // in …" + button) carries the server-allocated ALF-1 ref and its swimlanes are expanded.
  const epicHeader = page.getByRole('button', { name: /^communication firewall/i });
  await expect(epicHeader).toBeVisible();
  await expect(epicHeader).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('ALF-1')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Needs Refinement' })).toBeVisible();

  // The empty state is gone now that the project has an epic.
  await expect(page.getByText(/no epics yet/i)).toBeHidden();
});
