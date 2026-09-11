import type { Meta, StoryObj } from '@storybook/nextjs';

import { makeCommAccount, makeCommCorrection } from '@/lib/comms/fixtures';

import { CommsExamplesView } from './comms-examples-view';

/**
 * The example set, with the purge beneath it.
 *
 * The three rows are deliberately unlike each other: a promotion the model got wrong, a
 * demotion recorded by "Nothing to answer", and a pruned row still carrying its stamps — the
 * distinctions the card exists to draw.
 */
const PERSONAL = makeCommAccount('personal');

const PROMOTION = makeCommCorrection({
  account_label: 'personal',
  sender_name: 'Dana Whitfield',
  sender_handle: 'dana@example.com',
  subject: 'Thursday',
  body_excerpt: 'Are we still on for Thursday? I need to tell the sitter by tonight.',
  model_tier: 'whenever',
  chosen_tier: 'asap',
  kind: 'tier_change',
  created_version: 3,
});

const DEMOTION = makeCommCorrection({
  account_label: 'workmail',
  sender_name: 'Vendor Billing',
  sender_handle: 'noreply@vendor.example',
  subject: 'Your receipt',
  body_excerpt: 'Thanks for your order. No action is required.',
  model_tier: 'today',
  chosen_tier: 'fyi',
  kind: 'nothing_to_answer',
  created_version: 2,
});

const PRUNED = makeCommCorrection({
  account_label: 'imessage',
  sender_handle: '+15550102233',
  body_excerpt: 'k',
  model_tier: null,
  chosen_tier: 'fyi',
  kind: 'nothing_to_answer',
  created_version: 1,
  pruned_version: 4,
  pruned_at: '2020-06-02T09:00:00.000Z',
});

const meta = {
  title: 'Comms/ExamplesView',
  component: CommsExamplesView,
} satisfies Meta<typeof CommsExamplesView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The set as it reads in use: two live examples, one pruned, and the version stamped on both. */
export const Populated: Story = {
  parameters: {
    store: {
      commsSettings: { corrections: [PROMOTION, DEMOTION, PRUNED] },
      comms: { accounts: [PERSONAL] },
    },
    visualTest: {},
  },
};

/** Nothing corrected yet — the purge is still offered, because the mirror still fills up. */
export const Empty: Story = {
  parameters: {
    store: { commsSettings: { corrections: [] }, comms: { accounts: [PERSONAL] } },
  },
};
