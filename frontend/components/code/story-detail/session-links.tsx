import { type DetailLayout, SECTION_HEADING_CLASS } from '@/components/code/story-detail/layout';
import { ExternalAnchor } from '@/components/code/story-detail/pr-link';
import { sessionLabel } from '@/lib/code/launch-lane';
import { sessionUrl } from '@/lib/code/links';
import { formatShortDateTime } from '@/lib/date-utils';
import { useStorySessions } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The story detail's Sessions section: every Claude Code session recorded against the story,
 * newest first, each opening that session on claude.ai in a new tab. A row reads its launch lane
 * ("Refinement session", or plain "Session" when the lane is unknown) and its local start time.
 * Absent — heading and all — while the story has no sessions.
 */
export function SessionLinks({ story, layout }: { story: CodeStory; layout: DetailLayout }) {
  const sessions = useStorySessions(story);
  if (sessions.length === 0) return null;

  return (
    // The card's scroll column spaces its sections itself; the sheet's body spaces each one.
    <section className={cn('flex flex-col gap-2', layout === 'sheet' && 'mt-6')}>
      <h3 className={SECTION_HEADING_CLASS[layout]}>Sessions</h3>
      <ul className="flex flex-col gap-1.5">
        {sessions.map((session) => (
          <li key={session.session_id}>
            <ExternalAnchor href={sessionUrl(session.session_id)}>
              {sessionLabel(session.launch_lane)}
              {session.session_created_at === null ? null : (
                // The space keeps the accessible name "<label> <time>"; the flex gap draws it.
                <>
                  {' '}
                  <span className="text-xs text-muted-foreground">
                    {formatShortDateTime(session.session_created_at)}
                  </span>
                </>
              )}
            </ExternalAnchor>
          </li>
        ))}
      </ul>
    </section>
  );
}
