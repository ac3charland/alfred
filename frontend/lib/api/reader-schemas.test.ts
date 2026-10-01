import {
  createReaderPublicationSchema,
  patchReaderPostSchema,
  sendFurtherReadingSchema,
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
});

describe('updateReaderPublicationSchema', () => {
  it.each([
    ['the enabled toggle', { enabled: false }],
    ['a rename', { name: 'Renamed' }],
    ['a note', { notes: 'why this one is on the roster' }],
    ['a cleared note', { notes: null }],
  ])('accepts %s on its own', (_name, body) => {
    expect(updateReaderPublicationSchema.safeParse(body).success).toBe(true);
  });

  it('rejects a body with no fields — an empty PATCH has nothing to apply', () => {
    expect(updateReaderPublicationSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a blank rename rather than letting a card lose its name', () => {
    expect(updateReaderPublicationSchema.safeParse({ name: '  ' }).success).toBe(false);
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

describe('sendFurtherReadingSchema', () => {
  const urls = ['https://example.com/a', 'https://example.org/b'];

  it('accepts a destination with one to ten http(s) urls', () => {
    const parsed = sendFurtherReadingSchema.safeParse({ destination: 'reader', urls });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ destination: 'reader', urls });
    expect(
      sendFurtherReadingSchema.safeParse({
        destination: 'instapaper',
        urls: Array.from({ length: 10 }, (_, i) => `https://example.com/${String(i)}`),
      }).success,
    ).toBe(true);
  });

  it('rejects an empty urls list — a send with nothing in it has no meaning', () => {
    expect(sendFurtherReadingSchema.safeParse({ destination: 'reader', urls: [] }).success).toBe(
      false,
    );
  });

  it('rejects more than ten urls — a summary lists no more than that', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `https://example.com/${String(i)}`);
    expect(
      sendFurtherReadingSchema.safeParse({ destination: 'reader', urls: eleven }).success,
    ).toBe(false);
  });

  it.each(['javascript:alert(1)', 'ftp://example.com/a', 'mailto:a@example.com', 'not a url'])(
    'rejects %s — only web links go to Instapaper',
    (url) => {
      expect(
        sendFurtherReadingSchema.safeParse({ destination: 'reader', urls: [url] }).success,
      ).toBe(false);
    },
  );

  it('rejects an extra key rather than ignoring it', () => {
    expect(
      sendFurtherReadingSchema.safeParse({ destination: 'reader', urls, force: true }).success,
    ).toBe(false);
  });

  it('rejects an unknown or missing destination', () => {
    expect(sendFurtherReadingSchema.safeParse({ destination: 'wiki', urls }).success).toBe(false);
    expect(sendFurtherReadingSchema.safeParse({ urls }).success).toBe(false);
  });
});
