/**
 * The chunked send a bulk dispatch uses for a destination that takes a bounded batch per request
 * (the wiki takes 50 ids, research 5).
 *
 * Every id in a dispatch is still its own bulk unit — `applyBulkSettled` settles and rolls back
 * per unit — but the units of one chunk all await that chunk's ONE shared send, so they succeed or
 * fail together. A chunk's send starts lazily, on its first unit's request: by then the dispatch
 * has registered every id, so the chunk holds all it will ever hold and the request goes out once.
 */
export function chunkedSend(max: number, send: (ids: string[]) => Promise<unknown>) {
  const ids: string[] = [];
  const sends = new Map<number, Promise<unknown>>();

  return {
    /** Every id registered so far, in order — what a caller removes optimistically. */
    ids,
    /** Register `id`; its request settles with its chunk's send and adds no rows of its own. */
    add(id: string): () => Promise<never[]> {
      const chunk = Math.floor(ids.length / max);
      ids.push(id);
      return async () => {
        let started = sends.get(chunk);
        if (started === undefined) {
          const start = chunk * max;
          started = send(ids.slice(start, start + max));
          sends.set(chunk, started);
        }
        await started;
        return [];
      };
    },
  };
}
