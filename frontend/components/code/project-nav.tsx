'use client';

import { GitBranch, LayoutDashboard, ListOrdered, Plus, UserCheck } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { IconButton } from '@/components/atoms/icon-button';
import { NewProjectDialog } from '@/components/code/new-project-dialog';
import { ViewLink } from '@/components/tasks/view-link';
import { projectBoardHref } from '@/lib/code/board-links';
import { projectBadgeClasses, projectColorFor, projectTextClasses } from '@/lib/code/project-color';
import {
  useCodeActions,
  useProjectIdsWithActiveWork,
  useProjects,
  useRankedProjects,
} from '@/lib/stores/code-store';
import type { Project } from '@/lib/types';
import { navLinkClass } from '@/lib/ui/nav-link-class';
import { cn } from '@/lib/utils';

interface ProjectNavProperties {
  /** Called after a nav link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
}

/**
 * A project with no active items: dimmed and desaturated so the list reads as "where the work is".
 * It stays a live link — hover or keyboard focus brings its colour back at full strength.
 */
const IDLE_PROJECT_CLASS =
  'opacity-50 grayscale hover:opacity-100 hover:grayscale-0 focus-visible:opacity-100 focus-visible:grayscale-0';

/**
 * Code-module sidebar navigation: the project list. Mirrors FolderNav's folder list
 * — each project is a `ViewLink` to `/code/[projectId]` (client-side nav), highlighted when
 * that's the active route. Reads the project list from the CodeProvider store.
 *
 * Above the project list sit the module's three cross-project views, in the order the owner
 * reads them: the **Dashboard** first — the module's landing view, so it leads the menu and
 * carries the highlight for the bare `/code` — then **Needs human action**, then the full ranked
 * **Backlog**.
 *
 * A project with no active items (no outstanding story) is grayed out, unless it's the board
 * you're on. Each project shows its 3-char key as the ref-prefix hint, since refs everywhere read
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
  // Projects holding no outstanding story (or none at all) are grayed out below (ALF-273).
  const activeProjectIds = useProjectIdsWithActiveWork();
  const { createProject } = useCodeActions();
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);

  // exactOptionalPropertyTypes: only forward onClick when a handler was given.
  const closeProperty = onClose ? { onClick: onClose } : {};

  const handleCreated = (project: Project) => {
    // Route to the new board (a client-side History push, like ViewLink) and close any
    // open mobile drawer.
    globalThis.history.pushState(null, '', projectBoardHref(project.id));
    onClose?.();
  };

  // The Dashboard is the module's landing view: the bare `/code` renders it too, so it carries
  // the highlight for both paths.
  const dashboardActive = pathname === '/code' || pathname === '/code/dashboard';
  // Each queue is now highlighted on its exact route only.
  const needsHumanActionActive = pathname === '/code/needs-human-action';
  // The Backlog is now a destination like any other, highlighted on its exact route.
  const backlogActive = pathname === '/code/backlog';

  return (
    <nav aria-label="Projects" className="flex flex-col gap-1 py-2">
      <ViewLink
        href="/code/dashboard"
        className={cn(navLinkClass(dashboardActive), 'min-w-0')}
        {...closeProperty}
      >
        <LayoutDashboard size={14} className="shrink-0" />
        <span className="truncate">Dashboard</span>
      </ViewLink>

      <ViewLink
        href="/code/needs-human-action"
        className={cn(navLinkClass(needsHumanActionActive), 'min-w-0')}
        {...closeProperty}
      >
        <UserCheck size={14} className="shrink-0" />
        <span className="truncate">Needs human action</span>
      </ViewLink>

      <ViewLink
        href="/code/backlog"
        className={cn(navLinkClass(backlogActive), 'min-w-0')}
        {...closeProperty}
      >
        <ListOrdered size={14} className="shrink-0" />
        <span className="truncate">Backlog</span>
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
            const href = projectBoardHref(project.id);
            // One colour per project (its pick, else its stable creation slot) shared by the icon and the
            // key pill, so the sidebar reads with the same tinted-badge treatment as the Backlog.
            const color = projectColorFor(projectsByCreation, project.id);
            const selected = pathname === href;
            // The board you're on keeps its full-strength highlight even with nothing active.
            const idle = !selected && !activeProjectIds.has(project.id);
            return (
              <ViewLink
                key={project.id}
                href={href}
                className={cn(navLinkClass(selected), 'min-w-0', idle && IDLE_PROJECT_CLASS)}
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
