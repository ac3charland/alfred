import type { Meta, StoryObj } from '@storybook/nextjs';

import { BarLineChart, type BarLinePoint } from './bar-line-chart';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

/** Twelve weeks of churn ending Sunday 6 Sep 2026, read mid-week on Saturday the 12th. */
const LINES = [3120, 3380, 3300, 4620, 4400, 4560, 5480, 5160, 5740, 6140, 5900, 1980];

const LABELS = [
  'Jun 21',
  'Jun 28',
  'Jul 5',
  'Jul 12',
  'Jul 19',
  'Jul 26',
  'Aug 2',
  'Aug 9',
  'Aug 16',
  'Aug 23',
  'Aug 30',
  'Sep 6',
];

/** The trailing four-week mean, withheld on the in-progress final week. */
function withTrend(values: number[]): BarLinePoint[] {
  return values.map((value, index) => {
    const partial = index === values.length - 1;
    const window = values.slice(Math.max(0, index - 3), index + 1);
    return {
      label: LABELS[index] ?? String(index),
      value,
      average: partial ? null : Math.round(window.reduce((sum, n) => sum + n, 0) / window.length),
      title: `${LABELS[index] ?? ''} · ${value.toLocaleString('en-US')} lines`,
      ...(partial && { provisional: true }),
    };
  });
}

const meta = {
  title: 'Atoms/BarLineChart',
  component: BarLineChart,
  decorators: [withVisualFrame],
  parameters: { controls: { disable: true }, visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof BarLineChart>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The resting shape: one bar per bucket under a trailing-average line, the axis maximum on a
 * dashed top rule, and the bucket still filling drawn at a third of the fill with the line
 * stopping short of it.
 */
export const Trending: Story = {
  args: {
    points: withTrend(LINES),
    ariaLabel: 'Lines changed over the last 12 weeks, ranging from 1,980 to 6,140 a week',
    className: 'w-[560px]',
  },
};

/** A quiet bucket among busy ones: floored to a visible sliver rather than vanishing. */
export const QuietBucket: Story = {
  args: {
    points: withTrend([3120, 3380, 40, 4620, 4400, 4560, 5480, 5160, 5740, 6140, 5900, 1980]),
    ariaLabel: 'Lines changed over the last 12 weeks, ranging from 40 to 6,140 a week',
    className: 'w-[560px]',
  },
};

/**
 * A gap in the middle of the series: `null` splits the trend into two polylines, so nothing is
 * drawn across the break and the line never dives to the floor.
 */
export const BrokenTrend: Story = {
  args: {
    points: withTrend(LINES).map((point, index) =>
      index >= 4 && index <= 6 ? { ...point, average: null } : point,
    ),
    ariaLabel: 'Lines changed over 12 weeks, with three weeks missing a trend reading',
    className: 'w-[560px]',
  },
};

/** Every bucket at zero: no bars, no line — nothing that could read as a broken plot. */
export const AllZero: Story = {
  args: {
    points: withTrend(Array.from({ length: 12 }, () => 0)),
    ariaLabel: 'No lines changed in the last 12 weeks',
    className: 'w-[560px]',
  },
};
