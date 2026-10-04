import type { CodeItem } from '@/lib/types';

/** A priority nudge re-ranks on screen instantly; only the network sync waits this long. */
export const MOVE_SYNC_DEBOUNCE_MS = 200;

/**
 * How long one ranking RPC may take before the queue gives up on it, rolls back and moves on. The
 * queue is strictly serial, so a request that never settles would otherwise stall every later
 * write (and hold its stories) forever. A late success still lands through its realtime echo.
 */
export const SEND_TIMEOUT_MS = 15_000;

/** How long a write's own realtime echo is expected; an older record is dropped unmatched. */
const OWN_ECHO_TTL_MS = 10_000;

/** One story's priority as it stood before an optimistic write — what a failed sync restores. */
interface Touched {
  itemId: string;
  priorityBefore: number | null;
}

/**
 * One Backlog ranking write, already applied to the store optimistically and waiting to reach the
 * server. A swap exchanges two stories' CURRENT priorities, so swaps only reproduce the on-screen
 * order if the server runs them in exactly the order they were clicked; a jump lands past the
 * other stories' extreme, whatever the story's own priority was.
 */
export type PriorityWrite =
  | { kind: 'swap'; ref: string; neighbourRef: string; touched: [Touched, Touched] }
  | { kind: 'move'; scope: 'backlog' | 'project'; ref: string; toTop: boolean; touched: [Touched] };

interface PrioritySyncDeps {
  /** Run one write's RPC; resolves to the `code_items` rows it wrote. */
  send: (write: PriorityWrite) => Promise<CodeItem[]>;
  /** Patch a returned row into the store, leaving `priority` alone when `withPriority` is false. */
  patchRow: (row: CodeItem, withPriority: boolean) => void;
  /** Restore one story's priority (a failed write's rollback). */
  restorePriority: (itemId: string, priority: number | null) => void;
}

/**
 * The Backlog's single ranking-sync queue (ALF-250). Every chevron, project jump and Backlog jump
 * — from any row, or the story detail modal — joins ONE queue in click order; the queue flushes
 * once the clicks settle and runs its writes strictly one at a time, so the server replays the
 * user's clicks in the order they were made. A story with a write still queued or in flight is
 * HELD: a server row describing it (an earlier write's response, or any realtime echo) is older
 * than what the screen shows, so its priority is not applied over the optimistic one. Realtime
 * echoes of this tab's own writes are recognised and skipped too, since one can land after a
 * later write already re-ranked the story.
 */
export class PrioritySync {
  private readonly queue: PriorityWrite[] = [];
  private readonly holds = new Map<string, number>();
  private readonly ownWrites = new Map<string, { priority: number; at: number }[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private draining = false;
  private onFailure: ((write: PriorityWrite) => void) | undefined;

  constructor(private readonly deps: PrioritySyncDeps) {}

  /** Tell the user a sync failed (naming the write that failed) and the list was put back. */
  setFailureHandler(handler: (write: PriorityWrite) => void): void {
    this.onFailure = handler;
  }

  /** Queue an already-applied write, and (re)start the settle timer. */
  enqueue(write: PriorityWrite): void {
    const last = this.queue.at(-1);
    // Two jumps of the same story in a row collapse into the later one: a jump's landing spot
    // depends only on the OTHER stories, so the earlier jump is fully overwritten. The first
    // jump's prior priority is kept — it is what a failure must restore.
    if (
      write.kind === 'move' &&
      last?.kind === 'move' &&
      last.touched[0].itemId === write.touched[0].itemId
    ) {
      this.queue[this.queue.length - 1] = { ...write, touched: last.touched };
    } else {
      this.queue.push(write);
      for (const { itemId } of write.touched) this.hold(itemId, 1);
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, MOVE_SYNC_DEBOUNCE_MS);
  }

  /** True while a queued or in-flight write will still re-rank this story. */
  isHeld(itemId: string): boolean {
    return this.holds.has(itemId);
  }

  /** Whether a realtime echo's `priority` should be applied (consumes a matched own write). */
  acceptsEchoPriority(row: CodeItem): boolean {
    const records = this.liveOwnWrites(row.item_id);
    const match = records.findIndex((record) => record.priority === row.priority);
    if (match !== -1) records.splice(match, 1);
    return match === -1 && !this.isHeld(row.item_id);
  }

  /** Send whatever is queued now, without waiting for the clicks to settle (provider unmount). */
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let write = this.queue.shift();
      while (write !== undefined) {
        let rows: CodeItem[];
        try {
          rows = await withTimeout(this.deps.send(write), SEND_TIMEOUT_MS);
        } catch {
          this.rollback([write, ...this.queue.splice(0)]);
          this.onFailure?.(write);
          return;
        }
        for (const { itemId } of write.touched) this.hold(itemId, -1);
        for (const row of rows) {
          this.recordOwnWrite(row);
          this.deps.patchRow(row, !this.isHeld(row.item_id));
        }
        write = this.queue.shift();
      }
    } finally {
      this.draining = false;
    }
  }

  /** Undo failed writes newest-first, so each restore lands on the state its write started from. */
  private rollback(failed: PriorityWrite[]): void {
    for (let i = failed.length - 1; i >= 0; i -= 1) {
      const touched = failed[i]?.touched ?? [];
      for (let j = touched.length - 1; j >= 0; j -= 1) {
        const entry = touched[j];
        if (entry === undefined) continue;
        this.deps.restorePriority(entry.itemId, entry.priorityBefore);
        this.hold(entry.itemId, -1);
      }
    }
  }

  private hold(itemId: string, delta: 1 | -1): void {
    const next = (this.holds.get(itemId) ?? 0) + delta;
    if (next > 0) this.holds.set(itemId, next);
    else this.holds.delete(itemId);
  }

  private recordOwnWrite(row: CodeItem): void {
    const records = this.liveOwnWrites(row.item_id);
    records.push({ priority: row.priority, at: Date.now() });
    this.ownWrites.set(row.item_id, records);
  }

  private liveOwnWrites(itemId: string): { priority: number; at: number }[] {
    const cutoff = Date.now() - OWN_ECHO_TTL_MS;
    const live = (this.ownWrites.get(itemId) ?? []).filter((record) => record.at >= cutoff);
    if (live.length === 0) this.ownWrites.delete(itemId);
    else this.ownWrites.set(itemId, live);
    return live;
  }
}

/** `promise`, or a rejection once `ms` pass without it settling. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ranking sync timed out after ${String(ms)}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
