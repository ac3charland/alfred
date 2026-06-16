import { GitBranch } from 'lucide-react';
import * as React from 'react';

/**
 * The Code module's empty/landing state — shown at `/code` when no project is
 * selected. The board lives at `/code/[project-id]`; this guides the user to pick a project
 * from the sidebar (or, once M4 lands, to create one).
 */
export function CodeLanding() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-accent-teal">
          <GitBranch size={22} />
        </div>
        <h2 className="font-serif text-2xl text-foreground">The Software Factory</h2>
        <p className="text-sm text-muted-foreground">
          Pick a project from the sidebar to see its board — epics, swimlanes, and the stories
          moving through refinement and development.
        </p>
      </div>
    </div>
  );
}
