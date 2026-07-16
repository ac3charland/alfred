'use client';

import { GitBranch, ListOrdered, Plus, UserCheck } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { IconButton } from '@/components/atoms/icon-button';
import { NewProjectDialog } from '@/components/code/new-project-dialog';
import { ViewLink } from '@/components/tasks/view-link';
import { projectBadgeClasses, projectColorFor, projectTextClasses } from '@/lib/code/project-color';
import { useCodeActions, useProjects, useRankedProjects } from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';
import { navLinkClass } from '@/lib/ui/nav-link-class';
import { cn } from '@/lib/utils';

interface ProjectNavProperties {
  /** Called after a nav link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
}

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
  // Ranked by best outstanding-story priority so the sidebar leads with the project holding the
  // highest-priority open work (ALF-49), matching the board's epic ranking one level up.
  const projects = useRankedProjects();
  // Colour is keyed to a project's STABLE creation order (ALF-50), not the priority ranking above —
  // so a project keeps the same colour even as its rank (and thus its row position) shifts.
  const projectsByCreation = useProjects();
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

  // The Backlog is the default Code view (bare `/code` renders it too), so highlight the link
  // for both `/code` and `/code/backlog`.
  const backlogActive = pathname === '/code' || pathname === '/code/backlog';
  // The Needs-human-action queue (ALF-103) is its own destination, highlighted on its exact route.
  const needsHumanActionActive = pathname === '/code/needs-human-action';

  return (
    <nav aria-label="Projects" className="flex flex-col gap-1 py-2">
      <ViewLink
        href="/code/backlog"
        className={cn(navLinkClass(backlogActive), 'min-w-0')}
        {...closeProperty}
      >
        <ListOrdered size={14} className="shrink-0" />
        <span className="truncate">Backlog</span>
      </ViewLink>

      <ViewLink
        href="/code/needs-human-action"
        className={cn(navLinkClass(needsHumanActionActive), 'min-w-0')}
        {...closeProperty}
      >
        <UserCheck size={14} className="shrink-0" />
        <span className="truncate">Needs human action</span>
      </ViewLink>

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
            // One colour per project (its stable creation slot) shared by the branch icon and the
            // key pill, so the sidebar reads with the same tinted-badge treatment as the Backlog.
            const color = projectColorFor(projectsByCreation, project.id);
            return (
              <ViewLink
                key={project.id}
                href={href}
                className={cn(navLinkClass(pathname === href), 'min-w-0')}
                {...closeProperty}
              >
                <GitBranch size={14} className={cn('shrink-0', projectTextClasses(color))} />
                <span className="truncate">{project.name}</span>
                <Badge
                  variant="plain"
                  className={cn('ml-auto font-mono', projectBadgeClasses(color))}
                >
                  {project.key}
                </Badge>
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
