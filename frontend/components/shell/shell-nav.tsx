'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ProjectNav } from '@/components/code/project-nav';
import { CommsNav } from '@/components/comms/comms-nav';
import { FolderNav } from '@/components/tasks/folder-nav';
import { activeModule } from '@/lib/modules';

/**
 * The shell's desktop sidebar navigation. With every module seeded under one shared shell
 * layout, the nav must follow the URL client-side instead of being chosen by a per-module
 * layout: it derives the active module (`activeModule`) and renders that module's nav —
 * `ProjectNav` for Code, `CommsNav` for Comms, `FolderNav` for Tasks — each reading from its
 * already-seeded store. Switching modules re-derives this with no remount or refetch.
 */
export function ShellNav() {
  // Named `current`, not `module`: Next forbids assigning a variable called `module`.
  const current = activeModule(usePathname());
  if (current === 'code') return <ProjectNav />;
  if (current === 'comms') return <CommsNav />;
  return <FolderNav />;
}
