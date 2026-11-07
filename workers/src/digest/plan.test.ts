import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readPlan } from './plan';

// `fixtures/weekly-plan.html` is real output of the weekly-review skill's generate_plan.py, run
// on the invented week in `fixtures/weekly-plan.input.json`. Regenerate it the same way rather
// than editing it: its shape is the contract under test.
const plan = readFileSync(path.join(__dirname, 'fixtures', 'weekly-plan.html'), 'utf8');

describe('readPlan — the generator’s own output', () => {
  it('reads today’s lines, defaulting an empty label to the pill’s name, and the theme', () => {
    expect(readPlan(plan, '2026-11-07')).toEqual({
      theme: 'Finish what slipped & keep the long run',
      lines: [
        { label: 'Run', text: 'Long run (8)' },
        { label: 'Rock 1', text: 'Draft Motivic chord-voicing notes' },
        { label: 'RealPlay', text: 'Send RealPlay October invoice' },
      ],
    });
  });

  it('keeps a written label, and renders markup and entities as the page would show them', () => {
    expect(readPlan(plan, '2026-11-09')).toMatchObject({
      lines: [
        { label: 'Shelves', text: 'Buy brackets & anchors' },
        { label: 'Other', text: 'Call the dentist about the crown' },
      ],
    });
  });

  it('decodes the JSON’s unicode escapes', () => {
    expect(readPlan(plan, '2026-11-11')).toMatchObject({
      lines: [{ label: 'Rock 1', text: 'Voice-lead the bridge — café sketch' }],
    });
  });

  it('reads an empty day as a planned rest day: covered, with no lines', () => {
    expect(readPlan(plan, '2026-11-08')).toEqual({
      theme: 'Finish what slipped & keep the long run',
      lines: [],
    });
  });

  it('says "none" for a day outside the plan', () => {
    expect(readPlan(plan, '2026-11-14')).toBe('none');
    expect(readPlan(plan, '2026-11-05')).toBe('none');
  });
});

describe('readPlan — degrades, never throws', () => {
  const marker = 'var DAILY_TASKS = ';

  it.each([
    ['no DAILY_TASKS at all', plan.replace(marker, 'var OTHER = ')],
    ['no end marker', plan.replace(';\n\nfunction initToday', '\nfunction initToday')],
    [
      'truncated JSON',
      plan.replace(
        /var DAILY_TASKS = [\s\S]*?;\n\nfunction initToday/,
        `${marker}{"2026-11-07": [;\n\nfunction initToday`,
      ),
    ],
    [
      'an array where the map should be',
      plan.replace(
        /var DAILY_TASKS = [\s\S]*?;\n\nfunction initToday/,
        `${marker}[];\n\nfunction initToday`,
      ),
    ],
    [
      'a line missing its text',
      plan.replace(
        /var DAILY_TASKS = [\s\S]*?;\n\nfunction initToday/,
        `${marker}{"2026-11-07": [{"pill": "r1", "label": ""}]};\n\nfunction initToday`,
      ),
    ],
    [
      'a day that is not an array',
      plan.replace(
        /var DAILY_TASKS = [\s\S]*?;\n\nfunction initToday/,
        `${marker}{"2026-11-07": "rest"};\n\nfunction initToday`,
      ),
    ],
    ['an empty document', ''],
  ])('reads %s as unreadable', (_what, html) => {
    expect(readPlan(html, '2026-11-07')).toBe('unreadable');
  });

  it('reads a plan with no theme bar as lines with no theme', () => {
    const html = plan.replace('<div class="theme-title">', '<div class="title">');
    expect(readPlan(html, '2026-11-07')).toMatchObject({ theme: undefined });
  });

  it('falls back to "Other" for a pill it does not know', () => {
    const html = plan.replace(
      /var DAILY_TASKS = [\s\S]*?;\n\nfunction initToday/,
      `${marker}{"2026-11-07": [{"pill": "new", "label": "", "text": "x"}]};\n\nfunction initToday`,
    );
    expect(readPlan(html, '2026-11-07')).toMatchObject({ lines: [{ label: 'Other', text: 'x' }] });
  });
});
