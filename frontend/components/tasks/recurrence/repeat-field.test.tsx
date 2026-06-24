import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { RecurrenceRule } from '@/lib/recurrence';

import { RepeatField } from './repeat-field';

// 2026-06-01 is a Monday (weekday 1) — a deterministic anchor for the weekly/biweekly presets.
const MONDAY = '2026-06-01';

const DAILY: RecurrenceRule = { freq: 'daily', interval: 1, end: { type: 'never' } };

/** Open the preset dropdown and activate an item by name via keyboard (portal-safe). */
async function pickPreset(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  await user.click(screen.getByRole('button', { name: /repeat/i }));
  await screen.findByRole('menu');
  const target = screen.getByRole('menuitem', { name });
  const itemCount = screen.getAllByRole('menuitem').length;
  for (let index = 0; index < itemCount; index += 1) {
    if (document.activeElement === target) break;
    await user.keyboard('[ArrowDown]');
  }
  expect(target).toHaveFocus();
  await user.keyboard('[Enter]');
}

function renderField(props: Partial<React.ComponentProps<typeof RepeatField>> = {}) {
  const onChange = jest.fn();
  render(
    <RepeatField
      fieldId="repeat-1"
      rule={props.rule ?? null}
      dueDate={props.dueDate ?? MONDAY}
      onChange={props.onChange ?? onChange}
    />,
  );
  return { onChange: props.onChange ?? onChange };
}

describe('RepeatField', () => {
  it('shows "Never" when there is no rule', () => {
    renderField({ rule: null });
    expect(screen.getByRole('button', { name: /repeat/i })).toHaveTextContent('Never');
  });

  it('shows the rule summary when a rule is set', () => {
    renderField({ rule: DAILY });
    expect(screen.getByRole('button', { name: /repeat/i })).toHaveTextContent('Daily');
  });

  it('writes the chosen preset rule, anchored to the due date', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ rule: null, dueDate: MONDAY });

    await pickPreset(user, /^Daily$/);

    expect(onChange).toHaveBeenCalledWith(
      { freq: 'daily', interval: 1, end: { type: 'never' } },
      MONDAY,
    );
  });

  it('anchors the Weekly preset to the due date weekday', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ rule: null, dueDate: MONDAY });

    await pickPreset(user, /^Weekly$/);

    expect(onChange).toHaveBeenCalledWith(
      { freq: 'weekly', interval: 1, byweekday: [1], end: { type: 'never' } },
      MONDAY,
    );
  });

  it('clears the rule when Never is chosen', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ rule: DAILY, dueDate: MONDAY });

    await pickPreset(user, /^Never$/);

    expect(onChange).toHaveBeenCalledWith(null, MONDAY);
  });

  it('does not offer Hourly (deferred — needs a time anchor)', async () => {
    const user = userEvent.setup();
    renderField({ rule: null });
    await user.click(screen.getByRole('button', { name: /repeat/i }));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: /hourly/i })).not.toBeInTheDocument();
  });

  it('check-marks the active preset', async () => {
    const user = userEvent.setup();
    renderField({ rule: DAILY });
    await user.click(screen.getByRole('button', { name: /repeat/i }));
    await screen.findByRole('menu');
    // The active "Daily" item carries a check icon; "Weekly" does not.
    const dailyItem = screen.getByRole('menuitem', { name: /^Daily$/ });
    expect(
      within(dailyItem).queryByRole('img', { hidden: true }) ?? dailyItem.querySelector('svg'),
    ).not.toBeNull();
    const weeklyItem = screen.getByRole('menuitem', { name: /^Weekly$/ });
    expect(weeklyItem.querySelector('svg')).toBeNull();
  });

  it('opens the custom editor from Custom…', async () => {
    const user = userEvent.setup();
    renderField({ rule: null });
    await pickPreset(user, /custom/i);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Custom recurrence')).toBeInTheDocument();
  });
});
