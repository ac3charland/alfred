/** How many of its own server-written priorities the ledger remembers per story. */
const OWN_WRITES_KEPT = 8;

/**
 * The bookkeeping that keeps the Backlog's optimistic priority edits from being overwritten by
 * older server state (ALF-250). A chevron re-ranks a story locally at once and syncs later, so
 * three kinds of server news can arrive describing a rank the screen has already moved past: the
 * answer to an earlier step of the same burst, the answer to an earlier commit, and the realtime
 * echo of any write this tab made. Applying any of them puts the story back where it was — the
 * row snaps back, and the next click swaps from a position the user isn't looking at.
 *
 * - **touch / settle** — every optimistic change gets a token, and a commit carries the tokens of
 *   the changes it syncs. A story touched again since (by a later click, or another burst still
 *   waiting to sync) holds a newer local rank than the commit's answer, so the answer's priority
 *   is dropped for it; the commit carrying the newer touch reconciles it.
 * - **recordOwnWrite / acceptEcho** — a realtime priority that matches an OLDER write of this
 *   tab's is its own stale echo and is dropped (it can trail the answer, by then describing a rank
 *   the screen has moved past); one arriving while the story has an unsynced local rank is held
 *   back for the answer to claim. Anything else — the echo of the latest own write, another tab's
 *   change, a respace — applies.
 * - **serialize** — priority commits run one at a time in the order they are queued (each burst
 *   queues when its debounce flushes). Swaps don't commute, so two in flight together could land
 *   on the server in the other order.
 */
export class PriorityLedger {
  private sequence = 0;
  private readonly touched = new Map<string, number>();
  private readonly ownWrites = new Map<string, number[]>();
  /** Echoes held back while their story was touched, awaiting the answer that claims them. */
  private readonly earlyEchoes = new Map<string, number[]>();
  private chain: Promise<boolean> = Promise.resolve(true);

  /** Note a local, not-yet-synced priority change to `itemId`; returns that change's token. */
  touch(itemId: string): number {
    this.sequence += 1;
    this.touched.set(itemId, this.sequence);
    return this.sequence;
  }

  /**
   * A commit's answer has arrived for `itemId`, the commit carrying the local change `token`
   * (undefined when it carried none): true when no newer local change has happened since (the
   * answer is current and the story is synced), false when one has.
   */
  settle(itemId: string, token: number | undefined): boolean {
    const latest = this.touched.get(itemId);
    if (latest === undefined) return true;
    if (latest !== token) return false;
    this.touched.delete(itemId);
    // An early echo the answer didn't claim was an intermediate or foreign write the answer has
    // now superseded — nothing left to match it against.
    this.earlyEchoes.delete(itemId);
    return true;
  }

  /** Remember a priority the server wrote for this tab, so its realtime echo is recognised. */
  recordOwnWrite(itemId: string, priority: number): void {
    // Its echo may already have arrived (and been held back) while the commit was in flight —
    // then there is nothing left to wait for, and recording it would leave a stale entry that
    // swallows a later, legitimate write of the same rank.
    const early = this.earlyEchoes.get(itemId) ?? [];
    const seen = early.indexOf(priority);
    if (seen !== -1) {
      early.splice(0, seen + 1);
      return;
    }
    const writes = this.ownWrites.get(itemId) ?? [];
    writes.push(priority);
    this.ownWrites.set(itemId, writes.slice(-OWN_WRITES_KEPT));
  }

  /** Whether a realtime UPDATE's `priority` for `itemId` should be applied. */
  acceptEcho(itemId: string, priority: number): boolean {
    const writes = this.ownWrites.get(itemId) ?? [];
    const index = writes.indexOf(priority);
    if (index !== -1) {
      // Echoes arrive in commit order, so anything recorded before this one is spent too. The
      // echo of this tab's LATEST write still applies (it equals the answer, unless another
      // write — a respace's intermediate rank, say — landed on screen in between, which it then
      // corrects); an older one describes a rank the screen has moved past.
      const latest = index === writes.length - 1;
      writes.splice(0, index + 1);
      return latest && !this.touched.has(itemId);
    }
    if (this.touched.has(itemId)) {
      const early = this.earlyEchoes.get(itemId) ?? [];
      early.push(priority);
      this.earlyEchoes.set(itemId, early.slice(-OWN_WRITES_KEPT));
      return false;
    }
    return true;
  }

  /** Run `task` after every priority commit queued before it has finished. */
  serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    // A failed commit (its caller rolls back and toasts) must not stall the ones queued behind it.
    this.chain = run.then(
      () => true,
      () => false,
    );
    return run;
  }
}
