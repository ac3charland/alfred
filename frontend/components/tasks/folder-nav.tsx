'use client';

import { Check, FolderOpen, MoreHorizontal, Plus } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { IconButton } from '@/components/atoms/icon-button';
import { TextField } from '@/components/atoms/text-field';
import { FolderDropZone } from '@/components/tasks/folder-drop-zone';
import { ViewLink } from '@/components/tasks/view-link';
import { useInlineEdit } from '@/lib/hooks/use-inline-edit';
import { useFolderActions, useFolders } from '@/lib/stores/folders-store';
import { navLinkClass } from '@/lib/ui/nav-link-class';
import { cn } from '@/lib/utils';

interface FolderNavProperties {
  /** Called after a nav link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
}

/** Shared inline form used by both create and rename. Handles min-w-0 so the save button is never clipped. */
function FolderNameForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  className,
  submitLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  placeholder?: string;
  className?: string;
  submitLabel: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  // Focus the input on mount without the autoFocus prop (jsx-a11y/no-autofocus)
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Dismiss when the user clicks outside this form
  React.useEffect(() => {
    const handlePointerDown = (event_: PointerEvent) => {
      if (formRef.current && !formRef.current.contains(event_.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onCancel]);

  return (
    <form
      ref={formRef}
      onSubmit={(event_) => {
        event_.preventDefault();
        onSubmit();
      }}
      className={cn('flex min-w-0 items-center gap-1', className)}
    >
      <TextField
        ref={inputRef}
        value={value}
        onChange={(event_) => {
          onChange(event_.target.value);
        }}
        onKeyDown={(event_) => {
          if (event_.key === 'Escape') onCancel();
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0"
      />
      <IconButton type="submit" tone="affirm" disabled={!value.trim()} aria-label={submitLabel}>
        <Check size={13} />
      </IconButton>
    </form>
  );
}

/**
 * Sidebar navigation: folder list with CRUD, plus a Completed link.
 *
 * No Inbox link (removed): the `alfred` wordmark is the way into the inbox/capture
 * screen (it navigates to `/`), and the inbox list still opens via `?view=inbox`. Folders
 * remain a drop target for moving an item back to the Inbox (the FolderDropZone wrapping
 * each folder), so removing the standalone Inbox link doesn't affect drag-to-inbox.
 *
 * Reads the folder list from the FoldersProvider store and mutates through its
 * optimistic actions — the list updates instantly and reconciles with the server
 * (no router.refresh()).
 */
export function FolderNav({ onClose }: FolderNavProperties) {
  const pathname = usePathname();
  const router = useRouter();
  const folders = useFolders();
  const { addFolder, renameFolder, removeFolder } = useFolderActions();

  // Create stays on plain local state (an empty initial value, its own optimistic add +
  // re-open-on-failure flow below); only RENAME runs through the shared useInlineEdit save
  // machine. `editingFolderId` owns which row shows the rename form; useInlineEdit owns the
  // draft + trim/no-op/rollback. (Per the spec's 1.1: rename via useInlineEdit, create local.)
  const [isCreating, setIsCreating] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');
  const [editingFolderId, setEditingFolderId] = React.useState<string | undefined>();
  const editingFolder = folders.find((f) => f.id === editingFolderId);

  const isActive = (path: string) => pathname === path;

  // exactOptionalPropertyTypes: only spread onClick if onClose is defined,
  // otherwise `(() => void) | undefined` is not assignable to `MouseEventHandler`.
  const closeProperty = onClose ? { onClick: onClose } : {};

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setNewFolderName('');
    setIsCreating(false);
    try {
      await addFolder(name);
    } catch {
      // Store rolled back; re-open the form so the user can retry.
      setNewFolderName(name);
      setIsCreating(true);
    }
  };

  // The rename save machine: trims, no-ops on empty/unchanged, exits + closes the form
  // immediately (optimistic), and rolls the draft back on throw. `editingFolder?.name` seeds
  // the "current value" so the no-op-on-unchanged + rollback compare against the live name.
  const renameEdit = useInlineEdit(editingFolder?.name ?? '', async (next) => {
    const id = editingFolderId;
    if (id === undefined) return;
    // Close the rename form the instant the user commits — the optimistic store patch shows
    // the new name without waiting on the server.
    setEditingFolderId(undefined);
    try {
      await renameFolder(id, next);
    } catch {
      // Store restored the previous name; re-open the editor so the user can retry. Rethrow
      // so useInlineEdit resets its draft to the (rolled-back) current name.
      setEditingFolderId(id);
      throw new Error('rename failed');
    }
  });

  const handleDeleteFolder = async (id: string) => {
    const wasActive = pathname === `/folders/${id}`;
    try {
      await removeFolder(id);
      // Leave the deleted folder's page only once the delete succeeds.
      if (wasActive) {
        router.push('/');
      }
    } catch {
      // Store already restored the folder.
    }
  };

  return (
    <nav aria-label="Navigation" className="flex flex-col gap-1 py-2">
      {/* Folders section */}
      <div>
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
            Folders
          </span>
          <IconButton
            size="sm"
            onClick={() => {
              setIsCreating(true);
            }}
            aria-label="Create folder"
          >
            <Plus size={13} />
          </IconButton>
        </div>

        {/* New folder form */}
        {isCreating && (
          <FolderNameForm
            value={newFolderName}
            onChange={setNewFolderName}
            onSubmit={() => {
              void handleCreateFolder();
            }}
            onCancel={() => {
              setIsCreating(false);
              setNewFolderName('');
            }}
            placeholder="Folder name…"
            submitLabel="Save folder"
            className="px-2 py-1"
          />
        )}

        {/* Folder list */}
        <div className="mt-1 flex flex-col gap-0.5">
          {folders.map((folder) => (
            <FolderDropZone key={folder.id} id={folder.id}>
              <div className="group/folder flex items-center gap-1 pr-1">
                {editingFolderId === folder.id ? (
                  <FolderNameForm
                    value={renameEdit.draft}
                    onChange={renameEdit.setDraft}
                    onSubmit={() => {
                      void renameEdit.save();
                    }}
                    onCancel={() => {
                      setEditingFolderId(undefined);
                    }}
                    submitLabel="Save rename"
                    className="flex-1 px-3"
                  />
                ) : (
                  <>
                    <ViewLink
                      href={`/folders/${folder.id}`}
                      className={cn(
                        navLinkClass(isActive(`/folders/${folder.id}`)),
                        'flex-1 min-w-0',
                      )}
                      {...closeProperty}
                    >
                      <FolderOpen size={14} className="shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </ViewLink>

                    {/* Folder actions — on hover */}
                    <div className="shrink-0 opacity-0 group-hover/folder:opacity-100 transition-opacity duration-100 motion-reduce:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton size="sm" aria-label={`Options for ${folder.name}`}>
                            <MoreHorizontal size={12} />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditingFolderId(folder.id);
                              // Seed the draft directly (not via begin(), whose closure would
                              // read the pre-update editingFolder name).
                              renameEdit.setDraft(folder.name);
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              void handleDeleteFolder(folder.id);
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </>
                )}
              </div>
            </FolderDropZone>
          ))}
        </div>
      </div>

      {/* Completed */}
      <div className="mt-4 border-t border-border/50 pt-2">
        <ViewLink
          href="/completed"
          className={navLinkClass(isActive('/completed'))}
          {...closeProperty}
        >
          <Check size={15} className="shrink-0" />
          <span>Completed</span>
        </ViewLink>
      </div>
    </nav>
  );
}
