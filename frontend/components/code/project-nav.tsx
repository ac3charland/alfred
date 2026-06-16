'use client';

import { GitBranch, Plus } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { NewProjectDialog } from '@/components/code/new-project-dialog';
import { ViewLink } from '@/components/tasks/view-link';
import { useCodeActions, useProjects } from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';
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
 * Code-module sidebar navigation: the project list. Mirrors FolderNav's folder list
 * — each project is a `ViewLink` to `/code/[projectId]` (client-side nav), highlighted when
 * that's the active route. Reads the project list from the CodeProvider store.
 *
 * Each project shows its 3-char key as the ref-prefix hint, since refs everywhere read
 * `KEY-N`. The `+` opens the same New-project dialog as the gate,
 * persisting through the optimistic `createProject` action and then routing to the new
 * board.
 */
export function ProjectNav({ onClose }: ProjectNavProperties) {
  const pathname = usePathname();
  const projects = useProjects();
  const { createProject } = useCodeActions();
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);

  // exactOptionalPropertyTypes: only forward onClick when a handler was given.
  const closeProperty = onClose ? { onClick: onClose } : {};

  const handleCreated = (project: Project) => {
    // Route to the new board (a client-side History push, like ViewLink) and close any
    // open mobile drawer.
    globalThis.history.pushState(null, '', `/code/${project.id}`);
    onClose?.();
  };

  return (
    <nav aria-label="Projects" className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          Projects
        </span>
        <IconButton
          size="sm"
          aria-label="New project"
          onClick={() => {
            setNewProjectOpen(true);
          }}
        >
          <Plus size={14} />
        </IconButton>
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

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreateProject={createProject}
        onCreated={handleCreated}
        existingKeys={projects.map((project) => project.key)}
      />
    </nav>
  );
}
