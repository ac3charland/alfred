'use client';

import { GitBranch } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ViewLink } from '@/components/tasks/view-link';
import { useProjects } from '@/lib/stores/code-store';
import { cn } from '@/lib/utils';

interface ProjectNavProperties {
  /** Called after a nav link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
}

/** Shared styling for a nav link, highlighted when it points at the active route. */
const navLinkClass = (active: boolean) =>
  cn(
    'flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors duration-100 motion-reduce:transition-none',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    active
      ? 'bg-secondary text-foreground font-medium'
      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
  );

/**
 * Code-module sidebar navigation: the project list (§9.1). Mirrors FolderNav's folder list
 * — each project is a `ViewLink` to `/code/[projectId]` (client-side nav), highlighted when
 * that's the active route. Reads the project list from the CodeProvider store.
 *
 * Each project shows its 3-char key as the ref-prefix hint, since refs everywhere read
 * `KEY-N` (§3). The `+ New project` create control is deferred to M4 (the gate's
 * New-project dialog, §8.1) — its seam is marked below.
 */
export function ProjectNav({ onClose }: ProjectNavProperties) {
  const pathname = usePathname();
  const projects = useProjects();

  // exactOptionalPropertyTypes: only forward onClick when a handler was given.
  const closeProperty = onClose ? { onClick: onClose } : {};

  return (
    <nav aria-label="Projects" className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          Projects
        </span>
        {/* M4: + New project dialog (§8.1) — the create control lands with the gate. */}
      </div>

      {projects.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          No projects yet. A project is created when you send your first story to the Code module.
        </p>
      ) : (
        <div className="mt-1 flex flex-col gap-0.5">
          {projects.map((project) => {
            const href = `/code/${project.id}`;
            return (
              <ViewLink
                key={project.id}
                href={href}
                className={cn(navLinkClass(pathname === href), 'min-w-0')}
                {...closeProperty}
              >
                <GitBranch size={14} className="shrink-0" />
                <span className="truncate">{project.name}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground/70">
                  {project.key}
                </span>
              </ViewLink>
            );
          })}
        </div>
      )}
    </nav>
  );
}
