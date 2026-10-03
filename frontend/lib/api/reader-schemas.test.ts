import {
  createReaderPublicationSchema,
  patchReaderPostSchema,
  researchReportSchema,
  updateReaderPublicationSchema,
} from './reader-schemas';

describe('createReaderPublicationSchema', () => {
  it('takes a handle on its own — the name is optional', () => {
    const parsed = createReaderPublicationSchema.safeParse({ handle: 'news@example.com' });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ handle: 'news@example.com' });
  });

  it('trims the handle, so a pasted address with a stray space still matches the roster', () => {
    const parsed = createReaderPublicationSchema.safeParse({ handle: '  news@example.com ' });

    expect(parsed.data?.handle).toBe('news@example.com');
  });

  it('rejects an empty or whitespace-only handle — the roster is keyed on it', () => {
    expect(createReaderPublicationSchema.safeParse({ handle: '' }).success).toBe(false);
    expect(createReaderPublicationSchema.safeParse({ handle: ' '.repeat(3) }).success).toBe(false);
  });

  it.each([
    ['no @ at all', 'newsatexample.com'],
    ['nothing before the @', '@example.com'],
    ['nothing after the @', 'news@'],
    ['more than one @', 'news@example@com'],
    ['wrapped in angle brackets, pasted from a mail client', '<news@example.com>'],
  ])('rejects a handle that is not local@domain — %s', (_name, handle) => {
    expect(createReaderPublicationSchema.safeParse({ handle }).success).toBe(false);
  });

  it('keeps a name when one is given', () => {
    const parsed = createReaderPublicationSchema.safeParse({
      handle: 'news@example.com',
      name: 'Example Weekly',
    });

    expect(parsed.data).toEqual({ handle: 'news@example.com', name: 'Example Weekly' });
  });

  it('leaves an absent kind absent — the column defaults it — and keeps a chosen one', () => {
    expect(createReaderPublicationSchema.parse({ handle: 'a@b.c' })).not.toHaveProperty(
      'summary_kind',
    );
    expect(
      createReaderPublicationSchema.parse({ handle: 'a@b.c', summary_kind: 'alerts' }).summary_kind,
    ).toBe('alerts');
  });

  it('rejects a kind the column does not allow', () => {
    expect(
      createReaderPublicationSchema.safeParse({ handle: 'a@b.c', summary_kind: 'promo' }).success,
    ).toBe(false);
  });
});

describe('updateReaderPublicationSchema', () => {
  it.each([
    ['the enabled toggle', { enabled: false }],
    ['a rename', { name: 'Renamed' }],
    ['a note', { notes: 'why this one is on the roster' }],
    ['a cleared note', { notes: null }],
    ['a kind change', { summary_kind: 'roundup' }],
  ])('accepts %s on its own', (_name, body) => {
    expect(updateReaderPublicationSchema.safeParse(body).success).toBe(true);
  });

  it('rejects a body with no fields — an empty PATCH has nothing to apply', () => {
    expect(updateReaderPublicationSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a blank rename rather than letting a card lose its name', () => {
    expect(updateReaderPublicationSchema.safeParse({ name: '  ' }).success).toBe(false);
  });

  it('rejects a kind the column does not allow', () => {
    expect(updateReaderPublicationSchema.safeParse({ summary_kind: 'promo' }).success).toBe(false);
  });
});

describe('patchReaderPostSchema', () => {
  it('accepts the re-summarise verb', () => {
    const parsed = patchReaderPostSchema.safeParse({ resummarize: true });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ resummarize: true });
  });

  it('still accepts the archive and opened verbs', () => {
    expect(patchReaderPostSchema.safeParse({ archived: true }).success).toBe(true);
    expect(patchReaderPostSchema.safeParse({ opened: true }).success).toBe(true);
  });

  it('rejects a body that names two verbs at once, which timestamp to write being ambiguous', () => {
    expect(patchReaderPostSchema.safeParse({ resummarize: true, archived: true }).success).toBe(
      false,
    );
  });

  it('rejects an un-resummarise — there is no such verb', () => {
    expect(patchReaderPostSchema.safeParse({ resummarize: false }).success).toBe(false);
  });
});

describe('researchReportSchema', () => {
  it('accepts a report and keeps it exactly as sent', () => {
    const report = '# Is it worth it?\n\n  Probably yes.  \n';
    expect(researchReportSchema.parse({ report })).toEqual({ report });
  });

  it.each([
    ['missing', {}],
    ['blank', { report: ' \n\t ' }],
    ['not a string', { report: 42 }],
    ['over the ceiling', { report: 'x'.repeat(200_001) }],
  ])('refuses a report that is %s', (_label, body) => {
    expect(researchReportSchema.safeParse(body).success).toBe(false);
  });

  it('drops NUL characters, which a Postgres text column cannot store', () => {
    // A NUL copied out of a fetched PDF would otherwise fail the write with 22P05 on every retry,
    // and the report would never land.
    expect(researchReportSchema.parse({ report: 'a\u0000b\u0000' })).toEqual({ report: 'ab' });
  });

  it('refuses a report that is nothing but NUL characters and whitespace', () => {
    expect(researchReportSchema.safeParse({ report: '\u0000 \u0000' }).success).toBe(false);
  });
});
