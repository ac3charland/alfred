import type { SeedState } from './support/constants';
import {
  makeCommAccount,
  makeCommCorrection,
  makeCommHandle,
  makeCommMessage,
  makeCommPerson,
  makeCommRubric,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The three surfaces the owner writes by hand — the roster, the rubric, and the example set —
 * plus the purge that reaches into the last of them.
 *
 * Proven end to end rather than in jsdom because every claim here spans the whole stack: a
 * handle is normalised server-side, a rubric version is NUMBERED server-side, and the example
 * set's version is stamped by a database trigger. A component test can only assert what the
 * client sent; these assert what came back.
 */

const ACCOUNT = makeCommAccount('personal', { id: '22222222-2222-4222-8222-222222222222' });

const DANA = makeCommPerson('Dana Whitfield', { id: '33333333-3333-4333-8333-333333333333' });
const MARCUS = makeCommPerson('Marcus Okonkwo', {
  id: '44444444-4444-4444-8444-444444444444',
  priority: 'normal',
});

const DANA_EMAIL = makeCommHandle(DANA.id, 'dana@example.com');
const DANA_PHONE = makeCommHandle(DANA.id, '+15550102233');
const MARCUS_EMAIL = makeCommHandle(MARCUS.id, 'marcus@realplay.example');

const RUBRIC_V1 = makeCommRubric('Anything from my wife is ASAP.', { version: 1 });

const MESSAGE = makeCommMessage(ACCOUNT.id, {
  id: '55555555-5555-4555-8555-555555555555',
  tier: 'fyi',
  judged_by: 'owner',
});

const CORRECTIONS = [
  makeCommCorrection({
    account_label: 'personal',
    sender_name: 'Dana Whitfield',
    subject: 'Thursday',
    body_excerpt: 'Are we still on for Thursday?',
    model_tier: 'whenever',
    chosen_tier: 'asap',
    kind: 'tier_change',
    // Stated rather than left to default: each seeded correction is one insertion, and the set
    // version the page shows is the highest of them.
    created_version: 3,
  }),
  makeCommCorrection({
    message_id: MESSAGE.id,
    account_label: 'personal',
    sender_handle: 'noreply@vendor.example',
    subject: 'Your receipt',
    body_excerpt: 'Thanks for your order.',
    model_tier: 'today',
    chosen_tier: 'fyi',
    kind: 'nothing_to_answer',
    created_version: 2,
  }),
  makeCommCorrection({
    account_label: 'personal',
    sender_handle: 'priya@talentco.example',
    subject: 'A role you might like',
    body_excerpt: 'I came across your profile.',
    model_tier: null,
    chosen_tier: 'fyi',
    kind: 'nothing_to_answer',
    created_version: 1,
  }),
];

/** The roster, the rubric and the example set, as every test in this file starts from them. */
async function seedSettings(seed: (state: SeedState) => Promise<void>): Promise<void> {
  await seed({
    commAccounts: [ACCOUNT],
    commMessages: [MESSAGE],
    commPeople: [DANA, MARCUS],
    commHandles: [DANA_EMAIL, DANA_PHONE, MARCUS_EMAIL],
    commRubrics: [RUBRIC_V1],
    commCorrections: CORRECTIONS,
  });
}

test.describe('the people list', () => {
  test('adds a person with two handles, stored normalised', async ({ page, seed }) => {
    await seedSettings(seed);
    await page.goto('/comms/people');

    await page.getByRole('button', { name: 'New person' }).click();
    await page.getByLabel('Name').fill('Priya Raman');
    // `exact` because "Handle 1 kind" and "Remove handle 1" both contain this label.
    await page.getByLabel('Handle 1', { exact: true }).fill('  Priya@TalentCo.example ');
    await page.getByRole('button', { name: 'Add handle' }).click();
    await page
      .getByRole('group', { name: 'Handle 2 kind' })
      .getByRole('button', { name: 'Phone' })
      .click();
    await page.getByLabel('Handle 2', { exact: true }).fill('+1 (555) 010-9988');
    await page.getByRole('button', { name: 'Add person' }).click();

    // `exact` again: the priority chip and the delete control both name the person too.
    await expect(page.getByRole('button', { name: 'Priya Raman', exact: true })).toBeVisible();
    // Both stored forms come back from the server, not from what the form sent.
    await expect(page.getByText('priya@talentco.example')).toBeVisible();
    await expect(page.getByText('+15550109988')).toBeVisible();
  });

  test('changes a priority, removes a handle, and drops a person', async ({ page, seed }) => {
    await seedSettings(seed);
    await page.goto('/comms/people');

    await page.getByRole('button', { name: /^Priority for Dana Whitfield/ }).click();
    await page.getByRole('button', { name: /Never urgent/ }).click();
    await expect(
      page.getByRole('button', { name: 'Priority for Dana Whitfield: Low' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Remove +15550102233' }).click();
    await expect(page.getByText('+15550102233')).toBeHidden();
    await expect(page.getByText('dana@example.com')).toBeVisible();

    await page.getByRole('button', { name: 'Remove Marcus Okonkwo' }).click();
    await page.getByRole('button', { name: 'Remove person' }).click();
    await expect(page.getByRole('button', { name: 'Marcus Okonkwo', exact: true })).toBeHidden();
    // The handle cascaded with them.
    await expect(page.getByText('marcus@realplay.example')).toBeHidden();

    // The roster survives a reload, so none of that was only optimistic.
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Priority for Dana Whitfield: Low' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Marcus Okonkwo', exact: true })).toBeHidden();
  });
});

test.describe('the rubric', () => {
  test('numbers each save, and restoring an old version writes a new one', async ({
    page,
    seed,
  }) => {
    await seedSettings(seed);
    await page.goto('/comms/rubric');

    await expect(page.getByText(/^Version 1 · saved/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save new version' })).toBeDisabled();

    const field = page.getByLabel('Rubric');
    await field.fill('Anything from my wife is ASAP.\nInvoices go to Today.');
    await page.getByRole('button', { name: 'Save new version' }).click();
    await expect(page.getByText(/^Version 2 · saved/)).toBeVisible();

    // Version 1 is still readable — that is what makes an old verdict answerable.
    await page.getByRole('button', { name: 'Previous versions (1)' }).click();
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(field).toHaveValue('Anything from my wife is ASAP.');

    await page.getByRole('button', { name: 'Save new version' }).click();
    await expect(page.getByText(/^Version 3 · saved/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous versions (2)' })).toBeVisible();
  });
});

test.describe('the example set', () => {
  test('prunes an example, stamping the version it left at, then re-admits it', async ({
    page,
    seed,
  }) => {
    await seedSettings(seed);
    await page.goto('/comms/examples');

    // Three seeded corrections, each claiming a version as it was inserted.
    await expect(page.getByText('Example set v3')).toBeVisible();

    const card = page.getByRole('listitem').filter({ hasText: 'Are we still on for Thursday?' });
    await card.getByRole('button', { name: 'Prune' }).click();

    // The database stamped the next set version, and the page says so.
    await expect(card.getByText('pruned v4')).toBeVisible();
    await expect(page.getByText('Example set v4')).toBeVisible();
    await expect(card).toHaveClass(/opacity-55/);

    await card.getByRole('button', { name: 'Restore' }).click();
    await expect(card.getByText('pruned v4')).toBeHidden();
    await expect(card).not.toHaveClass(/opacity-55/);
  });

  test('purges one message through the confirm, blanking the example it reached', async ({
    page,
    seed,
  }) => {
    await seedSettings(seed);
    await page.goto('/comms/examples');

    await page.getByRole('button', { name: 'One message' }).click();
    await page.getByLabel('Message id to purge').fill(MESSAGE.id);
    await page.getByRole('button', { name: 'Purge' }).click();

    await expect(
      page.getByText(
        'This deletes the messages from alfred and blanks their example text. Nothing is touched in Gmail or Messages.',
      ),
    ).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Purge' }).click();

    await expect(page.getByText('Purged 1 message')).toBeVisible();

    // The correction survives; its text does not — the cascade the retention sweep never does.
    await page.reload();
    await expect(page.getByText('Purged — the message and its text are gone.')).toBeVisible();
    await expect(page.getByText('Thanks for your order.')).toBeHidden();
  });
});
