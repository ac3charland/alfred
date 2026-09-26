/**
 * The read-through cache behind `useWikiPageBody`: page bodies keyed by `path@blob_oid`, so a
 * body is fetched once per version of a page and dropped the moment a refresh reports a new blob.
 *
 * An external store (subscribe + snapshot) rather than React state, so a component reads it
 * through `useSyncExternalStore` — the sanctioned seam for mutable data outside React — and the
 * provider can prune it from a refresh without re-rendering every wiki consumer.
 */

export type WikiBodyEntry =
  | { status: 'loading' }
  | { status: 'ready'; body: string }
  | { status: 'error' };

type Listener = () => void;

export class WikiBodyCache {
  private readonly entries = new Map<string, WikiBodyEntry>();
  private readonly listeners = new Set<Listener>();
  /** Which loads are in the air, so a re-render mid-fetch never doubles the request. */
  private readonly inFlight = new Map<string, Promise<void>>();

  /** The entry for a key, or `undefined` when nothing has been asked for yet. */
  get(key: string): WikiBodyEntry | undefined {
    return this.entries.get(key);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Fetch a body once. A key already loading or loaded is left alone; a key that failed is
   * retried. The entry moves loading → ready | error, notifying subscribers at each step.
   */
  load(key: string, fetcher: () => Promise<string>): Promise<void> {
    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending;
    if (this.entries.get(key)?.status === 'ready') return Promise.resolve();
    this.set(key, { status: 'loading' });
    const run = fetcher()
      .then((body) => {
        this.set(key, { status: 'ready', body });
      })
      .catch(() => {
        this.set(key, { status: 'error' });
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, run);
    return run;
  }

  /**
   * Drop every entry whose key is not in `keep` — what a refresh calls with the current
   * `path@blob_oid` set, so a page whose blob changed is fetched afresh on its next open.
   */
  retain(keep: ReadonlySet<string>): void {
    let changed = false;
    for (const key of this.entries.keys()) {
      if (!keep.has(key)) {
        this.entries.delete(key);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  private set(key: string, entry: WikiBodyEntry): void {
    this.entries.set(key, entry);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The cache key for one version of one page. */
export function wikiBodyKey(path: string, blobOid: string): string {
  return `${path}@${blobOid}`;
}
