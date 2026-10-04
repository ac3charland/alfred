// Drives the real PrioritySync queue against a fake ranking server and prints what reaches it.
// Run: node --no-warnings --experimental-transform-types docs/demos/ALF-250-priority-sync/simulate.mts
import { PrioritySync } from '../../../frontend/lib/stores/code-priority-sync.ts';

let inFlight = 0;

const sync = new PrioritySync({
  send: (write) => {
    inFlight += 1;
    const label = write.kind === 'swap' ? `swap ${write.ref}↔${write.neighbourRef}` : `jump ${write.ref}`;
    console.log(`→ ${label}  (requests in flight: ${String(inFlight)})`);
    return new Promise((resolve) =>
      setTimeout(() => {
        inFlight -= 1;
        console.log(`← ${label} done`);
        resolve([{ item_id: write.touched[0].itemId, priority: 2 } as never]);
      }, 300),
    );
  },
  patchRow: (row, withPriority) => {
    console.log(`  patch ${row.item_id}: priority ${withPriority ? 'applied' : 'held (later write pending)'}`);
  },
  restorePriority: () => {},
});

const swap = (ref: string, neighbourRef: string) =>
  sync.enqueue({
    kind: 'swap',
    ref,
    neighbourRef,
    touched: [
      { itemId: ref, priorityBefore: 0 },
      { itemId: neighbourRef, priorityBefore: 0 },
    ],
  });

console.log('Clicks: ALF-238 down, RLP-1 up, ALF-238 down — two rows, inside one 200ms window');
swap('ALF-238', 'ALF-192');
swap('RLP-1', 'ALF-238');
swap('ALF-238', 'RLP-2');
console.log(`echo for ALF-238 while its writes are pending → apply priority? ${String(sync.acceptsEchoPriority({ item_id: 'ALF-238', priority: 9 } as never))}`);

setTimeout(() => {
  console.log(`echo of this tab's own write (ALF-238 @ 2) after the queue drained → apply? ${String(sync.acceptsEchoPriority({ item_id: 'ALF-238', priority: 2 } as never))}`);
  console.log(`external change (ALF-238 @ 42, e.g. another device) → apply? ${String(sync.acceptsEchoPriority({ item_id: 'ALF-238', priority: 42 } as never))}`);
}, 1500);
