'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ProjectNav } from '@/components/code/project-nav';
import { FolderNav } from '@/components/tasks/folder-nav';
import { isCodePath } from '@/lib/modules';

/**
 * The shell's desktop sidebar navigation. With both modules seeded under one shared shell
 * layout, the nav must follow the URL client-side instead of being chosen by a per-module
 * layout: it derives the active module (`isCodePath`) and renders that module's nav —
 * `ProjectNav` for Code, `FolderNav` for Tasks — both reading from their already-seeded
 * stores. Switching modules re-derives this with no remount or refetch.
 */
export function ShellNav() {
  const pathname = usePathname();
  return isCodePath(pathname) ? <ProjectNav /> : <FolderNav />;
}
