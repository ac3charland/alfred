// Real-output demo for ALF-69: drive a stale in-store status through the SAME production
// projection the navigation refetch uses (`codeStoryStatusPatch`) and print before → after.
//
// This is the pull-refresh in miniature: `store` is what this tab holds (a status that drifted
// while the tab sat idle); `fetched` is what `GET /api/code` returns on navigation. Applying the
// status patch reconciles the store — exactly what `refreshStatuses` dispatches per story, and
// exactly why title/priority are shown to stay put (the projection omits them).
import { codeStoryStatusPatch } from '../../../frontend/lib/code/status.ts';

// A story this tab holds, with a status that went stale (still "in_development") plus local
// fields the refetch must NOT clobber.
const store = {
  ref: 'ALF-42',
  item_id: 'i1',
  factory_state: 'in_development',
  lane: 'human',
  blocked_reason: null,
  title: 'Refetch ticket statuses',
  priority: 3,
};

// The fresh row the server returns on navigation: moved to "ready_for_review" out of band, with
// a divergent title/priority we deliberately ignore (statuses only).
const fetched = {
  ...store,
  factory_state: 'ready_for_review',
  title: 'server-side title we ignore',
  priority: 99,
};

// The store patches each held story with just the status projection (the reducer merges it).
const reconciled = { ...store, ...codeStoryStatusPatch(fetched as never) };

console.log('before:', store.factory_state, '| title:', store.title, '| priority:', store.priority);
console.log('patch: ', JSON.stringify(codeStoryStatusPatch(fetched as never)));
console.log(
  'after: ',
  reconciled.factory_state,
  '| title:',
  reconciled.title,
  '| priority:',
  reconciled.priority,
);
