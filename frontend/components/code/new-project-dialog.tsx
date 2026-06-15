'use client';

import { Dialog } from 'radix-ui';
import * as React from 'react';

import { FieldLabel } from '@/components/atoms/field-label';
import { TextField } from '@/components/atoms/text-field';
import { Button } from '@/components/ui/button';
import type { CreateProjectInput } from '@/lib/api-client';
import { parseGithubRepo } from '@/lib/code/github';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The §4.2 key rule, mirrored client-side for a live validity check + preview. */
const KEY_REGEX = /^[A-Z][A-Z0-9]{2}$/;

interface NewProjectDialogProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * How to persist the project — injected so the dialog serves BOTH contexts: the gate
   * (calls `lib/api-client.createProject` directly, no CodeProvider) and ProjectNav's `+`
   * (the optimistic `useCodeActions().createProject`). Resolves with the created row.
   */
  onCreateProject: (input: CreateProjectInput) => Promise<Project>;
  /** Called with the created project after a successful create (select it / route to it). */
  onCreated: (project: Project) => void;
  /** Existing keys, lower-cased compare, to reject a duplicate before hitting the server. */
  existingKeys: string[];
}

/**
 * The form body — a separate component so it MOUNTS FRESH each time the dialog opens
 * (Radix only renders Content while open). That resets the fields without a
 * setState-in-effect, and lets the first field auto-focus on mount via a ref.
 */
function NewProjectForm({
  onOpenChange,
  onCreateProject,
  onCreated,
  existingKeys,
}: Omit<NewProjectDialogProperties, 'open'>) {
  const [name, setName] = React.useState('');
  const [githubUrl, setGithubUrl] = React.useState('');
  const [key, setKey] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);

  // Focus the first field on mount (Radix preventDefault'd its own autofocus).
  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const keyValid = KEY_REGEX.test(key);
  const existingKeySet = new Set(existingKeys.map((k) => k.toUpperCase()));
  const keyDuplicate = keyValid && existingKeySet.has(key);
  const repo = parseGithubRepo(githubUrl);
  const showUrlError = githubUrl.trim() !== '' && repo === null;
  const canSubmit = name.trim() !== '' && repo !== null && keyValid && !keyDuplicate && !isSaving;

  const handleSubmit = async () => {
    setError(null);
    setIsSaving(true);
    try {
      const project = await onCreateProject({
        name: name.trim(),
        github_url: githubUrl.trim(),
        key,
      });
      onCreated(project);
      onOpenChange(false);
    } catch {
      setError('Could not create the project. Check the key is unique and try again.');
      setIsSaving(false);
    }
  };

  return (
    <>
      <Dialog.Title className="text-base font-semibold text-foreground">New project</Dialog.Title>
      <Dialog.Description className="mt-1 text-sm text-muted-foreground">
        A project is a GitHub repo. Its key prefixes every ref in the project.
      </Dialog.Description>

      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="new-project-name">Name</FieldLabel>
          <TextField
            id="new-project-name"
            ref={nameRef}
            value={name}
            onChange={(event_) => {
              setName(event_.target.value);
            }}
            placeholder="Alfred"
            className="px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="new-project-github">GitHub link</FieldLabel>
          <TextField
            id="new-project-github"
            value={githubUrl}
            onChange={(event_) => {
              setGithubUrl(event_.target.value);
            }}
            placeholder="https://github.com/ac3charland/alfred"
            className="px-3 py-2"
          />
          {showUrlError && (
            <p className="text-xs text-accent-amber">Enter a valid github.com repository URL.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="new-project-key">Ticket key</FieldLabel>
          <TextField
            id="new-project-key"
            value={key}
            maxLength={3}
            onChange={(event_) => {
              // Force uppercase as the user types so the live preview always matches.
              setKey(event_.target.value.toUpperCase());
            }}
            placeholder="ALF"
            className="px-3 py-2 font-mono uppercase"
            aria-describedby="new-project-key-help"
          />
          <p id="new-project-key-help" className="text-xs text-muted-foreground">
            {keyDuplicate ? (
              <span className="text-accent-amber">That key is already in use.</span>
            ) : keyValid ? (
              <>
                Refs will look like <span className="font-mono text-foreground">{key}-12</span>
              </>
            ) : (
              'Exactly 3 characters: a letter then two letters or digits.'
            )}
          </p>
        </div>

        {error !== null && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onOpenChange(false);
          }}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (canSubmit) void handleSubmit();
          }}
          disabled={!canSubmit}
          className="bg-accent-teal text-background hover:bg-accent-teal/90"
        >
          {isSaving ? 'Creating…' : 'Create project'}
        </Button>
      </div>
    </>
  );
}

/**
 * The New-project sub-dialog (§8.1): Name + GitHub link + a 3-char uppercase Ticket key
 * with a live "Refs will look like ALF-12" preview. On submit it parses the URL into
 * repo_owner/repo_name (server-side, but validated here too), creates the project via the
 * injected callback, and hands the row back so the caller can select/route to it.
 */
export function NewProjectDialog({ open, onOpenChange, ...rest }: NewProjectDialogProperties) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[55] -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-md rounded-2xl border border-border bg-surface p-6',
            'shadow-[0_0_40px_0_rgba(79,209,224,0.08)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none',
          )}
          onOpenAutoFocus={(event_) => {
            // Focus the first field, not the close button (which Radix would pick).
            event_.preventDefault();
          }}
        >
          <NewProjectForm onOpenChange={onOpenChange} {...rest} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
