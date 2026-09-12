'use client';

import * as React from 'react';

import { StateChip } from '@/components/code/state-chip';
import { ViewLink } from '@/components/tasks/view-link';
import { storyBoardHref } from '@/lib/code/board-links';
import { type ProjectColor, projectTextClasses } from '@/lib/code/project-color';
import type { CodeStory } from '@/lib/types';
import { cn } from '@/lib/utils';

interface QueueWidgetRowProperties {
  story: CodeStory;
  /** The story's project colour (ALF-50), resolved by the pane from the project order. */
  projectColor: ProjectColor;
}

/**
 * One compact digest row: the story's ref, its title, and its factory state, linking to the
 * story's detail modal on its project board (`/code/<projectId>?story=<ref>`).
 *
 * Deliberately narrower than a `BacklogRow`: no project key pill, because the ref already
 * OPENS with the project key and the pill would print `ALF` twice on one line. The project
 * signal moves onto the ref instead, tinted with that project's colour — which buys back the
 * ~50px a two-up pane row needs for its title.
 */
export function QueueWidgetRow({ story, projectColor }: QueueWidgetRowProperties) {
  return (
    <li>
      <ViewLink
        href={storyBoardHref(story.project_id ?? '', story.ref ?? '')}
        className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 hover:bg-secondary/60"
      >
        <span
          className={cn('shrink-0 font-mono text-xs font-medium', projectTextClasses(projectColor))}
        >
          {story.ref}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{story.title}</span>
        <StateChip state={story.factory_state} />
      </ViewLink>
    </li>
  );
}
