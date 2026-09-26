import { WikiBodyCache, wikiBodyKey } from './body-cache';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('WikiBodyCache', () => {
  it('keys one version of one page', () => {
    expect(wikiBodyKey('wiki/concepts/a.md', 'b1')).toBe('wiki/concepts/a.md@b1');
  });

  it('moves a key loading → ready and notifies subscribers at each step', async () => {
    const cache = new WikiBodyCache();
    const listener = jest.fn();
    cache.subscribe(listener);
    const body = deferred<string>();

    const load = cache.load('a@1', () => body.promise);
    expect(cache.get('a@1')).toEqual({ status: 'loading' });
    expect(listener).toHaveBeenCalledTimes(1);

    body.resolve('# A');
    await load;
    expect(cache.get('a@1')).toEqual({ status: 'ready', body: '# A' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('records a failed fetch as error, and a later load retries it', async () => {
    const cache = new WikiBodyCache();
    const fetcher = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce('# A');

    await cache.load('a@1', fetcher);
    expect(cache.get('a@1')).toEqual({ status: 'error' });

    await cache.load('a@1', fetcher);
    expect(cache.get('a@1')).toEqual({ status: 'ready', body: '# A' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('never doubles an in-flight fetch, and never refetches a ready body', async () => {
    const cache = new WikiBodyCache();
    const body = deferred<string>();
    const fetcher = jest.fn(() => body.promise);

    const first = cache.load('a@1', fetcher);
    const second = cache.load('a@1', fetcher);
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);

    body.resolve('# A');
    await first;
    await cache.load('a@1', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retain drops every key not in the kept set — a page whose blob changed refetches', async () => {
    const cache = new WikiBodyCache();
    const listener = jest.fn();
    await cache.load('a@1', () => Promise.resolve('one'));
    await cache.load('b@1', () => Promise.resolve('two'));
    cache.subscribe(listener);

    cache.retain(new Set(['a@2', 'b@1']));

    expect(cache.get('a@1')).toBeUndefined();
    expect(cache.get('b@1')).toEqual({ status: 'ready', body: 'two' });
    expect(listener).toHaveBeenCalledTimes(1);

    // Nothing to drop: no notification, so subscribers don't re-render for nothing.
    cache.retain(new Set(['b@1']));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops the notifications', async () => {
    const cache = new WikiBodyCache();
    const listener = jest.fn();
    const unsubscribe = cache.subscribe(listener);
    unsubscribe();

    await cache.load('a@1', () => Promise.resolve('one'));

    expect(listener).not.toHaveBeenCalled();
  });
});
