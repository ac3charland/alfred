import { CLASSIFICATION_ORIGIN_LABEL, classificationOrigin } from './classification';

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
