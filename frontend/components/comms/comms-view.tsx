'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { CommsExamplesView } from '@/components/comms/comms-examples-view';
import { CommsPeopleView } from '@/components/comms/comms-people-view';
import { CommsQueueView } from '@/components/comms/comms-queue-view';
import { CommsRubricView } from '@/components/comms/comms-rubric-view';

/** The module's root; everything else hangs off it as `/comms/<segment>`. */
export const COMMS_PREFIX = '/comms';

const PEOPLE_SEGMENT = 'people';
const RUBRIC_SEGMENT = 'rubric';
const EXAMPLES_SEGMENT = 'examples';

/**
 * Client-side view router for the Comms module — the counterpart to `TaskViews` and `CodeView`.
 *
 * Every Comms page renders this one component, which derives the active view purely from the
 * URL and renders it from the shell-seeded stores. Because it is the SAME mounted component on
 * every `/comms` route, moving between the queue and the settings pages via `ViewLink` (a
 * History push, no RSC round-trip) just re-derives the view; a hard load of any path renders the
 * match server-side.
 *
 * The bare `/comms` is the queue — the module's default and the reason it exists. Anything
 * beneath it that isn't one of the three named settings segments falls back to the queue too,
 * so a stale link lands somewhere useful rather than blank.
 */
export function CommsView() {
  const pathname = usePathname();
  const segment = pathname.startsWith(`${COMMS_PREFIX}/`)
    ? pathname.slice(COMMS_PREFIX.length + 1)
    : '';

  if (segment === PEOPLE_SEGMENT) return <CommsPeopleView />;
  if (segment === RUBRIC_SEGMENT) return <CommsRubricView />;
  if (segment === EXAMPLES_SEGMENT) return <CommsExamplesView />;
  return <CommsQueueView />;
}
