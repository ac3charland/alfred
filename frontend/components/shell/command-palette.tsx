'use client';

import {
  Check,
  Code2,
  FolderOpen,
  GitBranch,
  Inbox,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Search,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { Input } from '@/components/atoms/input';
import {
  type Destination,
  type DestinationIcon,
  buildDestinations,
  destinationDomId,
  flattenDestinations,
} from '@/components/shell/command-destinations';
import { useCommandPaletteShortcut } from '@/components/shell/use-command-palette-shortcut';
import { useProjects } from '@/lib/stores/code-store';
import { useFolders } from '@/lib/stores/folders-store';
import { cn } from '@/lib/utils';

const LISTBOX_ID = 'command-palette-destinations';

/** Each icon token resolves to the same lucide icon its sidebar entry uses. */
const ICONS: Record<DestinationIcon, LucideIcon> = {
  tasks: ListTodo,
  inbox: Inbox,
  priority: ListOrdered,
  completed: Check,
  code: Code2,
  backlog: ListOrdered,
  folder: FolderOpen,
  project: GitBranch,
};

const GROUP_LABELS = {
  go: 'Go to',
  folders: 'Folders',
  projects: 'Projects',
} as const;

/** One destination row — active when it's the current keyboard/hover target. */
function DestinationRow({
  destination,
  active,
  onSelect,
  onHover,
}: {
  destination: Destination;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const Icon = ICONS[destination.icon];
  return (
    <li
      id={destinationDomId(destination)}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      // Keep focus on the input: a mousedown would otherwise blur it before the click fires.
      onMouseDown={(event_) => {
        event_.preventDefault();
      }}
      onMouseEnter={onHover}
      onClick={onSelect}
      // The combobox drives selection from the input (arrows + Enter), but keep the option
      // independently operable for any client that focuses it directly.
      onKeyDown={(event_) => {
        if (event_.key === 'Enter' || event_.key === ' ') {
          event_.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        active && 'bg-secondary ring-1 ring-inset ring-accent-teal',
      )}
    >
      <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-foreground">{destination.label}</span>
      {destination.key !== undefined && (
        <Badge variant="plain" className="ml-auto font-mono">
          {destination.key}
        </Badge>
      )}
    </li>
  );
}

/** A labelled group with its options; renders nothing when the group has no matches. */
function DestinationGroup({
  label,
  destinations,
  baseIndex,
  activeIndex,
  onSelect,
  onHover,
}: {
  label: string;
  destinations: Destination[];
  baseIndex: number;
  activeIndex: number;
  onSelect: (destination: Destination) => void;
  onHover: (index: number) => void;
}) {
  if (destinations.length === 0) return null;
  return (
    <li>
      <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        {label}
      </div>
      <ul>
        {destinations.map((destination, offset) => {
          const index = baseIndex + offset;
          return (
            <DestinationRow
              key={destination.id}
              destination={destination}
              active={index === activeIndex}
              onSelect={() => {
                onSelect(destination);
              }}
              onHover={() => {
                onHover(index);
              }}
            />
          );
        })}
      </ul>
    </li>
  );
}

/**
 * The ⌘K navigation palette — a centered modal combobox mounted once in the shell. It lists
 * every navigation *destination* (the two modules, the cross-cutting views, every folder, every
 * project), filterable by typing and driven entirely by the keyboard. Selecting one performs the
 * same client-side `pushState` switch the sidebar links use, then closes.
 *
 * This is the ⌘P combobox pattern re-applied to destinations in a modal shell: the pure filter/
 * rank/group layer lives in `command-destinations.ts`, this component is the thin UI over it,
 * reusing the ↑↓/↵/Esc + hover-follows-active interaction contract. It owns its own `open` state
 * locally — nothing else reads it, so no store is added.
 */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const folders = useFolders();
  const projects = useProjects();

  // The palette opens only via the shortcut (no trigger), so resetting here covers every open:
  // each invocation starts from the full list.
  const toggle = React.useCallback(() => {
    setQuery('');
    setActiveIndex(0);
    setOpen((prev) => !prev);
  }, []);
  useCommandPaletteShortcut(toggle);

  const grouped = React.useMemo(
    () => buildDestinations(query, folders, projects),
    [query, folders, projects],
  );
  const flat = React.useMemo(() => flattenDestinations(grouped), [grouped]);

  // Reset the active row to the first match whenever the query changes (derive-during-render —
  // no setState effect), then clamp it as the list shrinks under the cursor.
  const [lastQuery, setLastQuery] = React.useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setActiveIndex(0);
  }
  const clampedIndex = flat.length === 0 ? 0 : Math.min(activeIndex, flat.length - 1);
  const activeOption = flat.length > 0 ? flat[clampedIndex] : undefined;

  const select = React.useCallback((destination: Destination) => {
    // Client-side view switch (ViewLink convention), then close. Every view re-derives from the
    // URL via ModuleRouter, so there's no reload and no RSC round-trip.
    globalThis.history.pushState(null, '', destination.href);
    setOpen(false);
  }, []);

  const handleKeyDown = (event_: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event_.key) {
      case 'ArrowDown': {
        event_.preventDefault();
        if (flat.length > 0) setActiveIndex((index) => Math.min(index + 1, flat.length - 1));
        return;
      }
      case 'ArrowUp': {
        event_.preventDefault();
        if (flat.length > 0) setActiveIndex((index) => Math.max(index - 1, 0));
        return;
      }
      case 'Enter': {
        const destination = flat[clampedIndex];
        if (destination !== undefined) {
          event_.preventDefault();
          select(destination);
        }
        return;
      }
      default:
      // Esc + overlay click are handled by the Dialog itself (onOpenChange → close).
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      className="max-w-lg gap-0 overflow-hidden p-0"
      // No prose description — the labelled combobox is self-describing; opt out explicitly.
      aria-describedby={undefined}
    >
      {/* Radix wires the content's accessible name to this title via aria-labelledby. */}
      <DialogTitle className="sr-only">Go to…</DialogTitle>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search size={15} className="shrink-0 text-muted-foreground" aria-hidden />
        {/* Radix Dialog auto-focuses the first focusable element on open — that's this input,
            so it lands focused with no explicit autoFocus. */}
        <Input
          type="text"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? destinationDomId(activeOption) : undefined}
          aria-label="Go to a place"
          placeholder="Go to…"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(event_) => {
            setQuery(event_.target.value);
          }}
          onKeyDown={handleKeyDown}
          className="h-11 border-0 bg-transparent px-0 focus-visible:ring-0"
        />
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-1">
        {flat.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No destinations match “{query.trim()}”
          </p>
        ) : (
          <ul id={LISTBOX_ID} role="listbox" aria-label="Destinations">
            <DestinationGroup
              label={GROUP_LABELS.go}
              destinations={grouped.go}
              baseIndex={0}
              activeIndex={clampedIndex}
              onSelect={select}
              onHover={setActiveIndex}
            />
            <DestinationGroup
              label={GROUP_LABELS.folders}
              destinations={grouped.folders}
              baseIndex={grouped.go.length}
              activeIndex={clampedIndex}
              onSelect={select}
              onHover={setActiveIndex}
            />
            <DestinationGroup
              label={GROUP_LABELS.projects}
              destinations={grouped.projects}
              baseIndex={grouped.go.length + grouped.folders.length}
              activeIndex={clampedIndex}
              onSelect={select}
              onHover={setActiveIndex}
            />
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground/70">
        <span>↑↓ navigate</span>
        <span>↵ go</span>
        <span>esc close</span>
        <span className="ml-auto">
          {flat.length} result{flat.length === 1 ? '' : 's'}
        </span>
      </div>
    </FormDialog>
  );
}
