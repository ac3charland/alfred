import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { DigestFacts } from './facts';
import {
  APP_URL,
  OPENERS,
  SATURDAY,
  SUNDAY,
  ZONE,
  ask,
  noPlanFacts,
  normalFacts as normalStateFacts,
  plan,
  quietFacts,
  task,
} from './fixtures/states';
import {
  ASK_CAP,
  DUE_ROWS,
  PLAN_LINES,
  type PreparedDigest,
  buildDigest,
  openerInput,
  prepareDigest,
} from './format';

const PLAN_HTML = readFileSync(path.join(__dirname, 'fixtures', 'weekly-plan.html'), 'utf8');
const WIRE_NULL = JSON.parse('null') as null;
const APP = APP_URL;
const OPENER = OPENERS.normal;
const PLAN = plan(PLAN_HTML);
const normalFacts = (): DigestFacts => normalStateFacts(PLAN_HTML);

const LINKS_HTML =
  `<a href="${APP}/today">Today</a> · <a href="${APP}/comms">Comms</a> · ` +
  `<a href="${APP}/reader">Reader</a>`;
const LINKS_PLAIN = `${APP}/today\n${APP}/comms\n${APP}/reader`;

const DUE_HTML = [
  '<b>Due · 5</b>',
  '• Send RealPlay October invoice — <i>2 days late</i>',
  '• Plan Motivic beta — <i>subtask late</i>',
  '• Call the dentist about the crown — 3:00 PM',
  '• Draft Motivic chord-voicing notes',
  '• Pick a post-show bedtime',
].join('\n');

const COMMS_HTML = [
  '<b>Comms · 1 ASAP · 2 today · 6 whenever</b>',
  '• ASAP · Dana — Can you confirm Thursday’s rehearsal time?',
  '• Today · Chad — Wants your read on the 2.4 release notes.',
  '• Today · Mom — Asks whether you’re coming Sunday.',
].join('\n');

const long = (n: number): string => 'w'.repeat(n);

function prepared(facts: DigestFacts, now = SATURDAY): PreparedDigest {
  return prepareDigest(facts, now, ZONE).digest;
}

describe('buildDigest — the four states', () => {
  it('Normal: the opener in italics, then Due, Comms, Reader and the links', () => {
    const text = buildDigest(prepared(normalFacts()), OPENER, APP);
    expect(text.html).toBe(
      [
        `<b>Good morning · Saturday, Nov 7</b>\n<i>${OPENER}</i>`,
        DUE_HTML,
        COMMS_HTML,
        '<b>Reader · 12 waiting</b>',
        LINKS_HTML,
      ].join('\n\n'),
    );
    expect(text.plain).toBe(
      [
        `Good morning · Saturday, Nov 7\n${OPENER}`,
        DUE_HTML.replaceAll(/<\/?[bi]>/g, ''),
        COMMS_HTML.replaceAll(/<\/?b>/g, ''),
        'Reader · 12 waiting',
        LINKS_PLAIN,
      ].join('\n\n'),
    );
  });

  it('Model unavailable: today’s plan lines take the opener’s place, verbatim', () => {
    const text = buildDigest(prepared(normalFacts()), undefined, APP);
    expect(text.html).toBe(
      [
        '<b>Good morning · Saturday, Nov 7</b>',
        [
          '<b>Plan for today</b>',
          '• Run · Long run (8)',
          '• Rock 1 · Draft Motivic chord-voicing notes',
          '• RealPlay · Send RealPlay October invoice',
        ].join('\n'),
        DUE_HTML,
        COMMS_HTML,
        '<b>Reader · 12 waiting</b>',
        LINKS_HTML,
      ].join('\n\n'),
    );
  });

  it('No plan covers today: the opener, and no plan section even without one', () => {
    const facts = noPlanFacts(PLAN_HTML);
    expect(buildDigest(prepared(facts), OPENERS.noPlan, APP).html).toBe(
      [
        `<b>Good morning · Saturday, Nov 7</b>\n<i>${OPENERS.noPlan}</i>`,
        [
          '<b>Due · 2</b>',
          '• Send RealPlay October invoice — <i>2 days late</i>',
          '• Call the dentist about the crown — 3:00 PM',
        ].join('\n'),
        [
          '<b>Comms · 1 ASAP · 0 today · 6 whenever</b>',
          '• ASAP · Dana — Can you confirm Thursday’s rehearsal time?',
        ].join('\n'),
        '<b>Reader · 12 waiting</b>',
        LINKS_HTML,
      ].join('\n\n'),
    );
    expect(buildDigest(prepared(facts), undefined, APP).html).toMatch(
      /^<b>Good morning · Saturday, Nov 7<\/b>\n\n<b>Due · 2<\/b>/,
    );
  });

  it('Quiet day: it still sends, saying so in every section', () => {
    const facts = quietFacts(PLAN_HTML);
    const opener = OPENERS.quiet;
    expect(buildDigest(prepared(facts, SUNDAY), opener, APP).html).toBe(
      [
        `<b>Good morning · Sunday, Nov 8</b>\n<i>${opener}</i>`,
        '<b>Due · nothing today</b>',
        '<b>Comms · nothing waiting on you</b>',
        '<b>Reader · 0 waiting</b>',
        LINKS_HTML,
      ].join('\n\n'),
    );
    // With no model, the rest day is said rather than silently dropped.
    expect(buildDigest(prepared(facts, SUNDAY), undefined, APP).html).toContain(
      '<b>Plan for today · rest day</b>',
    );
  });

  it('shows the whenever-only queue as counts with no rows', () => {
    const facts = {
      ...normalFacts(),
      comms: { counts: { asap: 0, today: 0, whenever: 3 }, asks: [] },
    };
    expect(buildDigest(prepared(facts), OPENER, APP).html).toContain(
      '<b>Comms · 0 ASAP · 0 today · 3 whenever</b>\n\n<b>Reader',
    );
  });
});

describe('buildDigest — escaping and caps', () => {
  it('escapes every interpolated value, and keeps it literal in the plain twin', () => {
    const facts: DigestFacts = {
      tasks: [task('Fix <b> & </i> in "notes" 🎷', { due_date: '2026-11-07' })],
      comms: {
        counts: { asap: 1, today: 0, whenever: 0 },
        asks: [ask('asap', 'A <Co> & B', 'Is 2 < 3 & 4 > 1?')],
      },
      reader_waiting: 1,
      plan: WIRE_NULL,
    };
    const text = buildDigest(prepared(facts), 'Fix <that> & go', 'https://x.test/?a=1&b=2');
    expect(text.html).toContain('<i>Fix &lt;that&gt; &amp; go</i>');
    expect(text.html).toContain('• Fix &lt;b&gt; &amp; &lt;/i&gt; in "notes" 🎷');
    expect(text.html).toContain('• ASAP · A &lt;Co&gt; &amp; B — Is 2 &lt; 3 &amp; 4 &gt; 1?');
    expect(text.html).toContain('<a href="https://x.test/?a=1&amp;b=2/today">Today</a>');
    expect(text.plain).toContain('• Fix <b> & </i> in "notes" 🎷');
  });

  it('caps a title at 100 graphemes without splitting an emoji', () => {
    const facts = { ...normalFacts(), tasks: [task('🏃'.repeat(150), { due_date: '2026-11-07' })] };
    expect(buildDigest(prepared(facts), OPENER, APP).plain).toContain(`• ${'🏃'.repeat(99)}…\n`);
  });

  it('caps an ask, and drops the dash for an ask that is missing', () => {
    const facts = {
      ...normalFacts(),
      comms: {
        counts: { asap: 2, today: 0, whenever: 0 },
        asks: [
          ask('asap', 'Dana', 'x'.repeat(ASK_CAP + 10)),
          { ...ask('asap', 'Chad', ''), ask: WIRE_NULL },
        ],
      },
    };
    const plain = buildDigest(prepared(facts), OPENER, APP).plain;
    expect(plain).toContain(`• ASAP · Dana — ${'x'.repeat(ASK_CAP - 1)}…\n`);
    expect(plain).toContain('• ASAP · Chad\n');
  });

  it('lists eight due rows, then "+N more on Today"; the header counts them all', () => {
    const tasks = Array.from({ length: 40 }, (_, index) =>
      task(`Task ${String(index + 1).padStart(2, '0')}`, {
        due_date: '2026-11-07',
        created_at: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z`,
      }),
    );
    const html = buildDigest(prepared({ ...normalFacts(), tasks }), OPENER, APP).html;
    expect(DUE_ROWS).toBe(8);
    expect(html).toContain('<b>Due · 40</b>\n• Task 01\n');
    expect(html).toContain('• Task 08\n+32 more on Today\n\n');
    expect(html).not.toContain('Task 09');
  });

  it('stays under 4,000 characters at every cap, in both forms', () => {
    const html = `<p>${long(10)}</p>`;
    const days = {
      '2026-11-07': Array.from({ length: PLAN_LINES + 4 }, () => ({
        pill: 'r1',
        label: long(80),
        text: long(400),
      })),
    };
    const plan = {
      ...PLAN,
      html: `${html}<div class="theme-title">${long(500)}</div>\n<script>\nvar DAILY_TASKS = ${JSON.stringify(days)};\n\nfunction initToday() {}\n</script>`,
    };
    const facts: DigestFacts = {
      tasks: Array.from({ length: 40 }, (_, index) =>
        task(`${long(300)}${String(index)}`, { due_date: '2026-11-01' }),
      ),
      comms: {
        counts: { asap: 9999, today: 9999, whenever: 9999 },
        asks: Array.from({ length: 5 }, () => ({
          ...ask('asap', long(300), long(1000)),
        })),
      },
      reader_waiting: 99_999,
      plan,
    };
    const digest = prepared(facts);
    const appUrl = `https://${long(60)}.example.com`;
    for (const opener of [long(5000), undefined]) {
      const text = buildDigest(
        digest,
        opener === undefined ? undefined : opener.slice(0, 600),
        appUrl,
      );
      expect(text.plain.length).toBeLessThan(4000);
      // Telegram counts after entity parsing, so the tags don't count — but the entities do.
      expect(text.html.replaceAll(/<[^>]+>/g, '').length).toBeLessThan(4000);
    }
  });
});

describe('prepareDigest', () => {
  it('reads today and the headline date in the zone, not UTC', () => {
    // 05:30 UTC Sunday is still 23:30 Saturday in Chicago.
    const late = prepareDigest(normalFacts(), new Date('2026-11-08T05:30:00Z'), ZONE).digest;
    expect(late.date).toBe('Saturday, Nov 7');
    expect(late.dueTotal).toBe(5);
  });

  it('reports an unreadable plan, and treats the day as having none', () => {
    const facts = { ...normalFacts(), plan: { ...PLAN, html: '<html>' } };
    const { digest, planUnreadable } = prepareDigest(facts, SATURDAY, ZONE);
    expect(planUnreadable).toBe('plan-1');
    expect(digest.plan).toBeUndefined();
    expect(buildDigest(digest, undefined, APP).html).not.toContain('Plan for today');
  });
});

describe('openerInput', () => {
  it('hands the model the same values the lists render, and the plan it does not list', () => {
    expect(openerInput(prepared(normalFacts()))).toEqual({
      date: 'Saturday, Nov 7',
      plan: {
        theme: 'Finish what slipped & keep the long run',
        lines: [
          { label: 'Run', text: 'Long run (8)' },
          { label: 'Rock 1', text: 'Draft Motivic chord-voicing notes' },
          { label: 'RealPlay', text: 'Send RealPlay October invoice' },
        ],
      },
      due: [
        { title: 'Send RealPlay October invoice', label: '2 days late' },
        { title: 'Plan Motivic beta', label: 'subtask late' },
        { title: 'Call the dentist about the crown', label: '3:00 PM' },
        { title: 'Draft Motivic chord-voicing notes', label: WIRE_NULL },
        { title: 'Pick a post-show bedtime', label: WIRE_NULL },
      ],
      due_overflow: 0,
      comms: {
        counts: { asap: 1, today: 2, whenever: 6 },
        asks: [
          { tier: 'asap', sender: 'Dana', ask: 'Can you confirm Thursday’s rehearsal time?' },
          { tier: 'today', sender: 'Chad', ask: 'Wants your read on the 2.4 release notes.' },
          { tier: 'today', sender: 'Mom', ask: 'Asks whether you’re coming Sunday.' },
        ],
      },
      reader_waiting: 12,
    });
  });

  it('sends plan: null when no plan covers today', () => {
    expect(openerInput(prepared({ ...normalFacts(), plan: WIRE_NULL })).plan).toBeNull();
    expect(openerInput(prepared(normalFacts(), new Date('2026-11-20T13:00:00Z'))).plan).toBeNull();
  });
});
