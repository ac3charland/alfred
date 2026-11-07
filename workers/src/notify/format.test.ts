import {
  ASK_CAP,
  TITLE_CAP,
  buildCommsAsap,
  buildTaskDue,
  cap,
  escapeHtml,
  formatTime,
} from './format';

const APP = 'https://alfred-six-gamma.vercel.app';

describe('buildCommsAsap', () => {
  it('renders the ASAP ping verbatim: bold headline, the ask, a link to /comms', () => {
    const text = buildCommsAsap(
      {
        sender: 'Dana',
        account: 'iMessage',
        ask: 'Asks whether you can pick up the kids at 4 today.',
      },
      APP,
    );

    expect(text.html).toBe(
      '<b>ASAP</b> · Dana · iMessage\n' +
        'Asks whether you can pick up the kids at 4 today.\n' +
        '<a href="https://alfred-six-gamma.vercel.app/comms">Open comms</a>',
    );
    expect(text.plain).toBe(
      'ASAP · Dana · iMessage\n' +
        'Asks whether you can pick up the kids at 4 today.\n' +
        'https://alfred-six-gamma.vercel.app/comms',
    );
  });

  it('renders markup and emoji in any field literally', () => {
    const text = buildCommsAsap(
      { sender: 'A&B <Co>', account: 'Work & Play', ask: 'Is <b>this</b> > that? 🎉' },
      APP,
    );

    expect(text.html).toContain('<b>ASAP</b> · A&amp;B &lt;Co&gt; · Work &amp; Play\n');
    expect(text.html).toContain('\nIs &lt;b&gt;this&lt;/b&gt; &gt; that? 🎉\n');
    // The plain twin carries no entities and no tags at all.
    expect(text.plain).toContain('A&B <Co> · Work & Play');
    expect(text.plain).not.toContain('&amp;');
  });

  it('caps a long ask at 300 characters, ending in an ellipsis', () => {
    const text = buildCommsAsap({ sender: 'Dana', account: 'Gmail', ask: 'x'.repeat(2000) }, APP);
    const ask = text.plain.split('\n', 2)[1] ?? '';

    expect(ask).toHaveLength(ASK_CAP);
    expect(ask.endsWith('…')).toBe(true);
    expect(ASK_CAP).toBe(300);
  });

  it('tolerates a trailing slash on the app URL', () => {
    expect(buildCommsAsap({ sender: 's', account: 'a', ask: 'q' }, `${APP}/`).plain).toContain(
      `${APP}/comms`,
    );
  });
});

describe('buildTaskDue', () => {
  it('renders the due ping verbatim: the time, the title, a link to /today', () => {
    const text = buildTaskDue(
      { title: 'Call the dentist about the crown', dueTime: '15:00:00' },
      APP,
    );

    expect(text.html).toBe(
      '<b>Due 3:00 PM</b>\n' +
        'Call the dentist about the crown\n' +
        '<a href="https://alfred-six-gamma.vercel.app/today">Open Today</a>',
    );
    expect(text.plain).toBe(
      'Due 3:00 PM\nCall the dentist about the crown\nhttps://alfred-six-gamma.vercel.app/today',
    );
  });

  it('caps a long title at 200 characters', () => {
    const title = buildTaskDue({ title: 'y'.repeat(500), dueTime: '09:00' }, APP).plain.split(
      '\n',
      2,
    )[1];

    expect(title).toHaveLength(TITLE_CAP);
    expect(TITLE_CAP).toBe(200);
  });
});

describe('formatTime', () => {
  it.each([
    ['00:00', '12:00 AM'],
    ['00:05:00', '12:05 AM'],
    ['09:30', '9:30 AM'],
    ['11:59', '11:59 AM'],
    ['12:00', '12:00 PM'],
    ['15:00:00', '3:00 PM'],
    ['23:30', '11:30 PM'],
  ])('%s → %s', (time, expected) => {
    expect(formatTime(time)).toBe(expected);
  });
});

describe('escapeHtml', () => {
  it('escapes & first, so an entity is never double-escaped', () => {
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('cap', () => {
  it('leaves text at or under the cap untouched', () => {
    expect(cap('abc', 3)).toBe('abc');
  });

  it('never splits an emoji, even one built from several code points', () => {
    expect(cap('🎉'.repeat(10), 5)).toBe('🎉🎉🎉🎉…');
    // A family emoji is five code points joined by zero-width joiners — one character on screen.
    expect(cap('👨‍👩‍👧'.repeat(4), 3)).toBe('👨‍👩‍👧👨‍👩‍👧…');
  });
});
