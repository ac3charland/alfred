import { createLogger } from './log.ts';

const AT = new Date('2026-09-09T12:00:00.000Z');

describe('createLogger', () => {
  it('writes a timestamped, levelled line to stdout for info', () => {
    const out: string[] = [];
    const logger = createLogger({ now: () => AT, out: (line) => out.push(line) });

    logger.info('polling started');

    expect(out).toEqual(['2026-09-09T12:00:00.000Z info polling started\n']);
  });

  it('appends structured fields as JSON', () => {
    const out: string[] = [];
    const logger = createLogger({ now: () => AT, out: (line) => out.push(line) });

    logger.info('sent batch', { source: 'imessage', messages: 3 });

    expect(out[0]).toBe(
      '2026-09-09T12:00:00.000Z info sent batch {"source":"imessage","messages":3}\n',
    );
  });

  it('routes warn and error to stderr, leaving stdout clean for --dry-run output', () => {
    const out: string[] = [];
    const err: string[] = [];
    const logger = createLogger({
      now: () => AT,
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });

    logger.warn('ingest POST failed');
    logger.error('config unreadable');

    expect(out).toEqual([]);
    expect(err).toEqual([
      '2026-09-09T12:00:00.000Z warn ingest POST failed\n',
      '2026-09-09T12:00:00.000Z error config unreadable\n',
    ]);
  });
});
