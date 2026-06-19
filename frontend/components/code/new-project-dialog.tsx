'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { FieldLabel } from '@/components/atoms/field-label';
import { TextField } from '@/components/atoms/text-field';
import type { CreateProjectInput } from '@/lib/api-client';
import { parseGithubRepo } from '@/lib/code/github';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import type { Project } from '@/lib/types';

/** The key rule, mirrored client-side for a live validity check + preview. */
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

  const { error, isPending, submit } = useFormSubmit({
    onSubmit: () =>
      onCreateProject({
        name: name.trim(),
        github_url: githubUrl.trim(),
        key,
      }),
    onSuccess: (project) => {
      onCreated(project);
      onOpenChange(false);
    },
    errorMessage: 'Could not create the project. Check the key is unique and try again.',
  });

  const canSubmit = name.trim() !== '' && repo !== null && keyValid && !keyDuplicate && !isPending;

  const handleSubmit = () => {
    void submit();
  };

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">New project</DialogTitle>
      <DialogDescription className="mt-1 text-sm text-muted-foreground">
        A project is a GitHub repo. Its key prefixes every ref in the project.
      </DialogDescription>

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
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            if (canSubmit) handleSubmit();
          }}
          disabled={!canSubmit}
        >
          {isPending ? 'Creating…' : 'Create project'}
        </Button>
      </div>
    </>
  );
}

/**
 * The New-project sub-dialog: Name + GitHub link + a 3-char uppercase Ticket key
 * with a live "Refs will look like ALF-12" preview. On submit it parses the URL into
 * repo_owner/repo_name (server-side, but validated here too), creates the project via the
 * injected callback, and hands the row back so the caller can select/route to it.
 */
export function NewProjectDialog({ open, onOpenChange, ...rest }: NewProjectDialogProperties) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="md"
      overlayClassName="z-[55]"
      className="z-[55]"
      onOpenAutoFocus={(event_) => {
        // Focus the first field, not the close button (which Radix would pick).
        event_.preventDefault();
      }}
    >
      <NewProjectForm onOpenChange={onOpenChange} {...rest} />
    </FormDialog>
  );
}
