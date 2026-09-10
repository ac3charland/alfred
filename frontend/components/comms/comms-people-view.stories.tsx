import type { Meta, StoryObj } from '@storybook/nextjs';

import { makeCommHandle, makeCommPerson } from '@/lib/comms/fixtures';
import type { CommPersonWithHandles } from '@/lib/types';

import { CommsPeopleView } from './comms-people-view';

/**
 * The roster the classifier weighs a sender against. What the baseline pins is the shape of a
 * row: a name that edits in place, a priority chip that reads as a value rather than an alarm,
 * and however many handles resolve to the same human.
 */
function person(
  name: string,
  handles: string[],
  overrides: Parameters<typeof makeCommPerson>[1] = {},
): CommPersonWithHandles {
  const row = makeCommPerson(name, overrides);
  return { ...row, comm_handles: handles.map((handle) => makeCommHandle(row.id, handle)) };
}

const DANA = person('Dana Whitfield', ['dana@example.com', '+15550102233'], {
  notes: 'Wife. Anything from her is ASAP.',
});
const MARCUS = person('Marcus Okonkwo', ['marcus@realplay.example'], { priority: 'normal' });
const RECRUITER = person('Priya Raman', ['priya@talentco.example'], { priority: 'low' });

const meta = {
  title: 'Comms/PeopleView',
  component: CommsPeopleView,
} satisfies Meta<typeof CommsPeopleView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** All three priorities at once, because the chip is the only place they are told apart. */
export const Populated: Story = {
  parameters: {
    store: { commsSettings: { people: [DANA, MARCUS, RECRUITER] } },
    visualTest: {},
  },
};

/** Nothing listed: the state the module ships in, and the one that has to say what to do. */
export const Empty: Story = {
  parameters: { store: { commsSettings: { people: [] } } },
};
