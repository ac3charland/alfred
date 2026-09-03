import {
  CLASSIFICATION_ORIGIN_LABEL,
  type ClassifiedRow,
  classificationOrigin,
  classifierVerdictPatch,
} from './classification';

describe('classificationOrigin', () => {
  it('reads a row the sweeper has not judged as unjudged', () => {
    expect(classificationOrigin({ classified_at: null, classified_provider: null })).toBe(
      'unjudged',
    );
  });

  // Defensive: `classified_at` is the marker, so a stray provider without a stamp is still a
  // row nothing has judged. Checking the provider first would misread it as the model's.
  it('reads a row with a provider but no stamp as unjudged', () => {
    expect(classificationOrigin({ classified_at: null, classified_provider: 'anthropic' })).toBe(
      'unjudged',
    );
  });

  it('reads a stamped row carrying a provider as the model’s', () => {
    expect(
      classificationOrigin({
        classified_at: '2026-08-01T09:00:00Z',
        classified_provider: 'anthropic',
      }),
    ).toBe('model');
  });

  it('reads a stamped row with no provider as claimed by the owner', () => {
    // What the claim trigger writes when a human edits a label before the sweeper arrives:
    // a stamp with the provenance columns left null, because no model produced it.
    expect(
      classificationOrigin({ classified_at: '2026-08-01T09:00:00Z', classified_provider: null }),
    ).toBe('claimed');
  });

  it('keeps a classifier-stamped row the model’s after the owner edits it', () => {
    // The claim trigger only fires while `classified_at` is null, so an edit made after the
    // classifier has stamped the row leaves the provider in place. The mark says where the
    // labels came from, and they came from the model.
    expect(
      classificationOrigin({
        classified_at: '2026-08-01T09:00:00Z',
        classified_provider: 'anthropic',
      }),
    ).toBe('model');
  });
});

describe('CLASSIFICATION_ORIGIN_LABEL', () => {
  it('names each origin in the words the row shows', () => {
    expect(CLASSIFICATION_ORIGIN_LABEL).toEqual({
      model: 'Labelled by the classifier',
      claimed: 'Labelled by you',
      unjudged: 'Not yet classified',
    });
  });
});

/** A row as the realtime stream delivers it: every column the classifier's write touches. */
function row(overrides: Partial<ClassifiedRow> = {}): ClassifiedRow {
  return {
    id: 'item-1',
    item_type: 'task',
    priority: 'high',
    due_date: '2026-09-04T00:00:00Z',
    folder_id: 'folder-1',
    intended_project_id: null,
    intended_epic_id: null,
    classified_at: '2026-09-03T09:00:00Z',
    classified_provider: 'anthropic',
    classified_model: 'claude-haiku-4-5',
    classified_prompt_version: 1,
    classified_guess: { item_type: 'task', priority: 'high' },
    classify_attempts: 0,
    ...overrides,
  };
}

describe('classifierVerdictPatch', () => {
  it('applies a model verdict to a row the tab still holds as unjudged', () => {
    expect(classifierVerdictPatch({ classified_at: null }, row())).toEqual({
      item_type: 'task',
      priority: 'high',
      due_date: '2026-09-04T00:00:00Z',
      folder_id: 'folder-1',
      intended_project_id: null,
      intended_epic_id: null,
      classified_at: '2026-09-03T09:00:00Z',
      classified_provider: 'anthropic',
      classified_model: 'claude-haiku-4-5',
      classified_prompt_version: 1,
      classified_guess: { item_type: 'task', priority: 'high' },
      classify_attempts: 0,
    });
  });

  // The patch carries the classifier's OWN columns and nothing else. A title or a sort order
  // riding along on the same payload could be older than an edit this tab has in flight, and
  // applying it would undo what the owner just typed.
  it('carries no column outside the classifier’s write', () => {
    const patch = classifierVerdictPatch({ classified_at: null }, row());
    // A set, so the claim is about WHICH columns travel, not the order they were written in.
    expect(new Set(Object.keys(patch ?? {}))).toEqual(
      new Set([
        'item_type',
        'priority',
        'due_date',
        'folder_id',
        'intended_project_id',
        'intended_epic_id',
        'classified_at',
        'classified_provider',
        'classified_model',
        'classified_prompt_version',
        'classified_guess',
        'classify_attempts',
      ]),
    );
  });

  it('ignores an update no model produced', () => {
    // The owner's own edit, a dispatch, a claim — every ordinary write echoes down this stream
    // too. Only a verdict may write labels the tab did not ask for.
    expect(
      classifierVerdictPatch(
        { classified_at: null },
        row({ classified_provider: null, classified_guess: null }),
      ),
    ).toBeNull();
  });

  it('ignores a verdict for a row this tab is not holding — the race rule', () => {
    expect(classifierVerdictPatch(undefined, row())).toBeNull();
  });

  it('ignores a verdict for a row this tab already knows is judged', () => {
    // Once the tab holds a judged row, its labels are either the model's (already applied) or
    // the owner's (claimed since). A re-delivered or out-of-order echo must not re-apply the
    // model's values over an answer that came later.
    expect(classifierVerdictPatch({ classified_at: '2026-09-03T09:00:00Z' }, row())).toBeNull();
  });

  it('applies a verdict that abstained on every field', () => {
    // Abstention is a first-class answer: the row's labels stay blank, but it stops being
    // unjudged — which is what flips the provenance mark and ends the sweeper's interest.
    expect(
      classifierVerdictPatch(
        { classified_at: null },
        row({
          item_type: 'unclassified',
          priority: null,
          due_date: null,
          folder_id: null,
          classified_guess: {},
        }),
      ),
    ).toMatchObject({
      item_type: 'unclassified',
      priority: null,
      due_date: null,
      folder_id: null,
      classified_at: '2026-09-03T09:00:00Z',
      classified_provider: 'anthropic',
    });
  });
});
