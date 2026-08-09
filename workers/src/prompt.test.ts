import {
  type ClassifyRequest,
  type Correction,
  EXAMPLE_LIMIT,
  PROMPT_VERSION,
  buildRequest,
  buildSchema,
  referenceDate,
  selectExamples,
} from './prompt';
import type { ClosedWorld, SweepItem } from './verdict';

const WORLD: ClosedWorld = {
  folders: [
    { id: 'folder-health', name: 'Health', description: 'Appointments and checkups' },
    { id: 'folder-errands', name: 'Errands', description: undefined },
  ],
  projects: [{ id: 'project-alf', key: 'ALF', name: 'alfred', description: 'The task app itself' }],
  epics: [
    { id: 'epic-classifier', ref: 'ALF-171', name: 'LLM classifier', project_id: 'project-alf' },
  ],
};

const EMPTY_WORLD: ClosedWorld = { folders: [], projects: [], epics: [] };

function makeItem(overrides: Partial<SweepItem> = {}): SweepItem {
  return {
    id: 'item-1',
    title: 'Book dentist appointment',
    notes: undefined,
    raw_capture: undefined,
    source_url: undefined,
    item_type: 'unclassified',
    priority: undefined,
    due_date: undefined,
    folder_id: undefined,
    intended_project_id: undefined,
    intended_epic_id: undefined,
    classify_attempts: 0,
    ...overrides,
  };
}

function makeCorrection(overrides: Partial<Correction> = {}): Correction {
  return {
    captured_text: 'call the vet',
    field: 'priority',
    direction: 'filled_in',
    guessed_value: undefined,
    chosen_value: 'high',
    ...overrides,
  };
}

function requestFor(overrides: {
  item?: SweepItem;
  world?: ClosedWorld;
  corrections?: Correction[];
}): ClassifyRequest {
  return buildRequest({
    item: overrides.item ?? makeItem(),
    world: overrides.world ?? WORLD,
    examples: overrides.corrections ?? [],
    timeZone: 'America/Chicago',
    now: new Date('2024-01-01T05:30:00Z'),
  });
}

describe('constants', () => {
  it('pins the prompt version and the example limit', () => {
    expect(PROMPT_VERSION).toBe(1);
    expect(EXAMPLE_LIMIT).toBe(12);
  });
});

describe('buildSchema', () => {
  it('produces the exact schema shape from a fully populated world', () => {
    expect(buildSchema(WORLD)).toEqual({
      type: 'object',
      additionalProperties: false,
      required: [
        'item_type',
        'priority',
        'due_date',
        'folder_id',
        'intended_project_id',
        'intended_epic_id',
      ],
      properties: {
        item_type: { anyOf: [{ enum: ['task', 'code'] }, { type: 'null' }] },
        priority: { anyOf: [{ enum: ['high', 'medium', 'low'] }, { type: 'null' }] },
        due_date: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
        folder_id: { anyOf: [{ enum: ['folder-health', 'folder-errands'] }, { type: 'null' }] },
        intended_project_id: { anyOf: [{ enum: ['project-alf'] }, { type: 'null' }] },
        intended_epic_id: { anyOf: [{ enum: ['epic-classifier'] }, { type: 'null' }] },
      },
    });
  });

  it('collapses an empty id list to a bare null type, never an empty enum', () => {
    const schema = buildSchema(EMPTY_WORLD);
    const properties = schema['properties'] as Record<string, unknown>;
    expect(properties['folder_id']).toEqual({ type: 'null' });
    expect(properties['intended_project_id']).toEqual({ type: 'null' });
    expect(properties['intended_epic_id']).toEqual({ type: 'null' });
    // item_type / priority always have a fixed, non-empty set — an empty world must not touch them.
    expect(properties['item_type']).toEqual({
      anyOf: [{ enum: ['task', 'code'] }, { type: 'null' }],
    });
  });
});

describe('referenceDate', () => {
  it('renders today in the zone as YYYY-MM-DD plus the spelled-out weekday', () => {
    // Jan 1 2024 was a Monday.
    expect(referenceDate('UTC', new Date('2024-01-01T12:00:00Z'))).toEqual({
      date: '2024-01-01',
      weekday: 'Monday',
    });
  });

  it('resolves against the target zone, not the UTC day the instant falls in', () => {
    // 05:30 UTC on Jan 1 is 23:30 the day before in America/Chicago (UTC-6 in winter).
    const now = new Date('2024-01-01T05:30:00Z');
    expect(referenceDate('America/Chicago', now)).toEqual({
      date: '2023-12-31',
      weekday: 'Sunday',
    });
    // The same instant, read in UTC, is still "today" — proving the zone, not the clock, decides.
    expect(referenceDate('UTC', now)).toEqual({ date: '2024-01-01', weekday: 'Monday' });
  });
});

describe('the closed-world block', () => {
  it('renders a described folder as "id  name — description"', () => {
    const { system } = requestFor({});
    expect(system).toContain('folder-health  Health — Appointments and checkups');
  });

  it('renders an undescribed folder as the name alone — no dash, no placeholder', () => {
    const { system } = requestFor({});
    expect(system).toContain('folder-errands  Errands');
    expect(system).not.toContain('Errands —');
    expect(system).not.toContain('Errands (no description)');
  });

  it('treats an empty-string description the same as an absent one', () => {
    const world: ClosedWorld = {
      ...WORLD,
      folders: [{ id: 'folder-work', name: 'Work', description: '' }],
    };
    const { system } = requestFor({ world });
    expect(system).toContain('folder-work  Work');
    expect(system).not.toContain('Work —');
  });

  it('renders a project as "id  KEY · name — description"', () => {
    const { system } = requestFor({});
    expect(system).toContain('project-alf  ALF · alfred — The task app itself');
  });

  it('renders an epic as "id  REF · name" only — never a description or notes', () => {
    const { system } = requestFor({});
    expect(system).toContain('epic-classifier  ALF-171 · LLM classifier');
    expect(system).not.toContain('ALF-171 · LLM classifier —');
  });

  it('omits a section entirely when its list is empty, independently per section', () => {
    const world: ClosedWorld = { folders: [], projects: WORLD.projects, epics: WORLD.epics };
    const { system } = requestFor({ world });
    expect(system).not.toContain('Folders');
    expect(system).toContain('Projects');
    expect(system).toContain('Epics');
  });

  it('omits all three sections for a fresh, fully empty world', () => {
    const { system } = requestFor({ world: EMPTY_WORLD });
    expect(system).not.toContain('Folders');
    expect(system).not.toContain('Projects');
    expect(system).not.toContain('Epics');
  });
});

describe('the system preamble', () => {
  // The model has no prior about alfred, so the preamble has to carry the setting itself. Each
  // assertion below stands for one thing a reader with zero context needs before the rules that
  // follow mean anything — not the wording, which is free to change, but the fact being stated.
  it('establishes where this is happening, without assuming the reader knows alfred', () => {
    const { system } = requestFor({});
    expect(system).toContain("alfred is one person's personal task system");
    expect(system).toContain('holding list');
    expect(system).toContain('Inbox');
  });

  it('says what this step produces and that it is only a suggestion the owner reviews', () => {
    const { system } = requestFor({});
    expect(system).toContain('exactly one captured item');
    expect(system).toContain('files nothing, completes nothing');
    expect(system).toContain('overwrite anything you set');
  });

  it('explains why a blank beats a wrong answer, which is what the rules below rest on', () => {
    const { system } = requestFor({});
    expect(system).toContain('null is always a legal answer');
    expect(system).toContain('a wrong answer costs more than a blank one');
  });

  it('grounds both item_type values, so "work on alfred itself" below is readable', () => {
    const { system } = requestFor({});
    expect(system).toContain('ordinary to-do (`task`)');
    expect(system).toContain("alfred's own codebase (`code`)");
  });
});

describe('the abstention rules', () => {
  it('states every field-specific abstention rule and the no-rewrite rule', () => {
    const { system } = requestFor({});
    expect(system).toContain('item_type: answer only when the text clearly reads as a task');
    expect(system).toContain('Never infer it from urgency');
    expect(system).toContain('No default guess');
    expect(system).toContain('Never invent a folder');
    expect(system).toContain('Never invent either');
    expect(system).toContain('Never rewrite, tidy, or summarise the captured text');
    expect(system).toContain('writing metadata only');
  });
});

describe('the per-item user message', () => {
  it('always carries the title, and omits notes/raw_capture/source_url when absent', () => {
    const { user } = requestFor({ item: makeItem({ title: 'Water the plants' }) });
    expect(user).toBe('Title: Water the plants');
  });

  it('carries notes, raw_capture and source_url when present', () => {
    const { user } = requestFor({
      item: makeItem({
        title: 'Renew passport',
        notes: 'Expires next spring',
        raw_capture: 'renew passport before the trip',
        source_url: 'https://example.com/passport',
      }),
    });
    expect(user).toBe(
      [
        'Title: Renew passport',
        'Notes: Expires next spring',
        'Captured text: renew passport before the trip',
        'Source: https://example.com/passport',
      ].join('\n'),
    );
  });
});

describe('selectExamples', () => {
  it('keeps all three directions represented when the log is lopsided', () => {
    const filledIn = Array.from({ length: 10 }, (_, index) =>
      makeCorrection({ captured_text: `filled-${String(index)}`, direction: 'filled_in' }),
    );
    const corrections = [
      makeCorrection({
        captured_text: 'the-one-blank',
        direction: 'blanked',
        guessed_value: 'high',
        chosen_value: undefined,
      }),
      makeCorrection({
        captured_text: 'the-one-change',
        direction: 'changed',
        guessed_value: 'low',
        chosen_value: 'high',
      }),
      ...filledIn,
    ];

    const examples = selectExamples(corrections, WORLD);

    expect(examples).toHaveLength(EXAMPLE_LIMIT);
    expect(examples.filter((example) => example.direction === 'blanked')).toHaveLength(1);
    expect(examples.filter((example) => example.direction === 'changed')).toHaveLength(1);
    expect(examples.filter((example) => example.direction === 'filled_in')).toHaveLength(10);
  });

  it('respects recency inside a bucket and skips an exhausted bucket instead of stalling', () => {
    const corrections = [
      makeCorrection({ captured_text: 'the-blank', direction: 'blanked' }),
      makeCorrection({ captured_text: 'the-change', direction: 'changed' }),
      makeCorrection({ captured_text: 'newest', direction: 'filled_in' }),
      makeCorrection({ captured_text: 'middle', direction: 'filled_in' }),
      makeCorrection({ captured_text: 'oldest', direction: 'filled_in' }),
    ];

    const examples = selectExamples(corrections, WORLD);

    // Fewer than EXAMPLE_LIMIT survivors: every one comes back, and the draw terminates rather than
    // looping forever once every bucket has run dry.
    expect(examples).toHaveLength(5);
    const filledInOrder = examples
      .filter((example) => example.direction === 'filled_in')
      .map((e) => e.captured_text);
    expect(filledInOrder).toEqual(['newest', 'middle', 'oldest']);
  });

  it('drops unresolvable examples before the draw, so a full 12 still comes back', () => {
    const resolvable = (['blanked', 'changed', 'filled_in'] as const).flatMap((direction) =>
      Array.from({ length: 4 }, (_, index) =>
        makeCorrection({
          captured_text: `ok-${direction}-${String(index)}`,
          direction,
          field: 'priority',
        }),
      ),
    );
    const unresolvable = Array.from({ length: 3 }, (_, index) =>
      makeCorrection({
        captured_text: `ghost-${String(index)}`,
        direction: 'blanked',
        field: 'folder_id',
        guessed_value: 'folder-deleted-long-ago',
        chosen_value: undefined,
      }),
    );

    const examples = selectExamples([...unresolvable, ...resolvable], WORLD);

    expect(examples).toHaveLength(12);
    expect(examples.some((example) => example.captured_text.startsWith('ghost'))).toBe(false);
  });

  it('drops an id-field example only when a non-absent side fails to resolve, not a scalar field', () => {
    const corrections = [
      makeCorrection({
        field: 'folder_id',
        guessed_value: 'folder-health',
        chosen_value: 'folder-errands',
      }),
      makeCorrection({
        field: 'folder_id',
        guessed_value: 'folder-ghost',
        chosen_value: undefined,
      }),
      makeCorrection({ field: 'priority', guessed_value: undefined, chosen_value: 'low' }),
    ];

    const examples = selectExamples(corrections, WORLD);

    expect(examples).toHaveLength(2);
    expect(examples.some((example) => example.guessed_value === 'folder-ghost')).toBe(false);
  });
});

describe('the example block', () => {
  it('resolves ids to human names rather than echoing the raw id', () => {
    const { system } = requestFor({
      corrections: [
        makeCorrection({
          captured_text: 'file the health form',
          field: 'folder_id',
          direction: 'changed',
          guessed_value: 'folder-errands',
          chosen_value: 'folder-health',
        }),
      ],
    });

    expect(system).toContain('Chosen: Health');
    expect(system).toContain('Guessed: Errands');
    expect(system).not.toContain('Chosen: folder-health');
  });

  it('renders an absent side as "none"', () => {
    const { system } = requestFor({
      corrections: [
        makeCorrection({
          captured_text: 'call the plumber',
          field: 'priority',
          direction: 'filled_in',
          guessed_value: undefined,
          chosen_value: 'high',
        }),
      ],
    });

    expect(system).toContain('Guessed: none');
  });

  it('is entirely absent for an empty corrections log', () => {
    const { system } = requestFor({ corrections: [] });
    expect(system).not.toContain('Examples of past corrections');
  });
});
