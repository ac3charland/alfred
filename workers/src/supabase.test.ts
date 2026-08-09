import { spyOnFetch } from './fetch-stub';
import {
  type SupabaseEnv,
  fetchClosedWorld,
  fetchEligibleItems,
  fetchRecentCorrections,
  patchCodeItem,
  patchEpic,
  patchItem,
} from './supabase';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

function mockFetch(response: Response): jest.SpyInstance {
  return spyOnFetch().mockResolvedValue(response);
}

/** For `fetchClosedWorld`'s three concurrent reads: one mocked response per call, in call order. */
function mockFetchSequence(responses: Response[]): jest.SpyInstance {
  const spy = spyOnFetch();
  for (const response of responses) {
    spy.mockResolvedValueOnce(response);
  }
  return spy;
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

describe('patchCodeItem', () => {
  it('PATCHes the row keyed by ref with service-role auth and returns the row count', async () => {
    const spy = mockFetch(Response.json([{ ref: 'ALF-42' }], { status: 200 }));

    const count = await patchCodeItem(env, 'ALF-42', { factory_state: 'ready_for_dev' });

    expect(count).toBe(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/rest/v1/code_items?ref=eq.ALF-42');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ factory_state: 'ready_for_dev' }));
    const headers = init.headers as Record<string, string>;
    expect(headers['apikey']).toBe('service-role-key');
    expect(headers['Authorization']).toBe('Bearer service-role-key');
    expect(headers['Prefer']).toBe('return=representation');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('returns 0 when no row matched the ref (a ticket we do not track)', async () => {
    mockFetch(new Response('[]', { status: 200 }));
    await expect(patchCodeItem(env, 'XXX-1', { factory_state: 'done' })).resolves.toBe(0);
  });

  it('throws on a non-2xx response', async () => {
    mockFetch(new Response('permission denied', { status: 403 }));
    await expect(patchCodeItem(env, 'ALF-42', { factory_state: 'done' })).rejects.toThrow(
      /403 permission denied/,
    );
  });
});

describe('patchEpic', () => {
  it('PATCHes the epics table keyed by ref, with the same auth and row count', async () => {
    const spy = mockFetch(Response.json([{ ref: 'ALF-12' }], { status: 200 }));

    const count = await patchEpic(env, 'ALF-12', { spec_path: 'docs/specs/epics/ALF-12.html' });

    expect(count).toBe(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/rest/v1/epics?ref=eq.ALF-12');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ spec_path: 'docs/specs/epics/ALF-12.html' }));
    const headers = init.headers as Record<string, string>;
    expect(headers['apikey']).toBe('service-role-key');
    expect(headers['Authorization']).toBe('Bearer service-role-key');
    expect(headers['Prefer']).toBe('return=representation');
  });

  it('returns 0 when no epic matched the ref', async () => {
    mockFetch(new Response('[]', { status: 200 }));
    await expect(patchEpic(env, 'XXX-1', { spec_path: 'x.html' })).resolves.toBe(0);
  });

  it('names the epics table in the error thrown on a non-2xx response', async () => {
    mockFetch(new Response('permission denied', { status: 403 }));
    await expect(patchEpic(env, 'ALF-12', { spec_path: 'x.html' })).rejects.toThrow(
      /epics \(ALF-12\).*403 permission denied/,
    );
  });
});

describe('fetchEligibleItems', () => {
  it('GETs items with every eligibility predicate, the select list, oldest-first order, and the limit', async () => {
    const spy = mockFetch(new Response('[]', { status: 200 }));

    await fetchEligibleItems(env, { limit: 25, attemptCeiling: 3 });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://proj.supabase.co/rest/v1/items');
    expect(parsed.searchParams.get('parent_id')).toBe('is.null');
    expect(parsed.searchParams.get('dispatched_at')).toBe('is.null');
    expect(parsed.searchParams.get('classified_at')).toBe('is.null');
    expect(parsed.searchParams.get('classify_attempts')).toBe('lt.3');
    expect(parsed.searchParams.get('select')).toBe(
      'id,title,notes,raw_capture,source_url,item_type,priority,due_date,folder_id,intended_project_id,intended_epic_id,classify_attempts',
    );
    expect(parsed.searchParams.get('order')).toBe('created_at.asc');
    expect(parsed.searchParams.get('limit')).toBe('25');
    const headers = headersOf(init);
    expect(headers['apikey']).toBe('service-role-key');
    expect(headers['Authorization']).toBe('Bearer service-role-key');
  });

  it('converts JSON nulls on the row to undefined', async () => {
    // Raw JSON text, not an object literal: the package bans the `null` literal, and this is
    // exactly the shape PostgREST sends over the wire for an unset column.
    const body = `[
      {
        "id": "item-1",
        "title": "Buy milk",
        "notes": null,
        "raw_capture": null,
        "source_url": null,
        "item_type": "unclassified",
        "priority": null,
        "due_date": null,
        "folder_id": null,
        "intended_project_id": null,
        "intended_epic_id": null,
        "classify_attempts": 0
      }
    ]`;
    mockFetch(new Response(body, { status: 200 }));

    const items = await fetchEligibleItems(env, { limit: 10, attemptCeiling: 3 });

    expect(items).toEqual([
      {
        id: 'item-1',
        title: 'Buy milk',
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
      },
    ]);
  });

  it('returns an empty array when nothing is eligible', async () => {
    mockFetch(new Response('[]', { status: 200 }));
    await expect(fetchEligibleItems(env, { limit: 10, attemptCeiling: 3 })).resolves.toEqual([]);
  });

  it('throws with the status and body on a non-2xx response', async () => {
    mockFetch(new Response('permission denied', { status: 403 }));
    await expect(fetchEligibleItems(env, { limit: 10, attemptCeiling: 3 })).rejects.toThrow(
      /GET items failed: 403 permission denied/,
    );
  });
});

describe('fetchClosedWorld', () => {
  it('reads folders, projects, and epics concurrently with the right select/order/exclusions', async () => {
    const spy = mockFetchSequence([
      new Response('[{"id":"folder-1","name":"Home","description":null}]', { status: 200 }),
      Response.json(
        [{ id: 'project-1', key: 'ALF', name: 'alfred', description: 'The app itself' }],
        { status: 200 },
      ),
      Response.json([{ id: 'epic-1', ref: 'ALF-1', name: 'Epic one', project_id: 'project-1' }], {
        status: 200,
      }),
    ]);

    const world = await fetchClosedWorld(env);

    expect(world).toEqual({
      folders: [{ id: 'folder-1', name: 'Home', description: undefined }],
      projects: [{ id: 'project-1', key: 'ALF', name: 'alfred', description: 'The app itself' }],
      epics: [{ id: 'epic-1', ref: 'ALF-1', name: 'Epic one', project_id: 'project-1' }],
    });

    expect(spy).toHaveBeenCalledTimes(3);

    const [foldersUrl] = spy.mock.calls[0] as [string, RequestInit];
    const foldersParsed = new URL(foldersUrl);
    expect(foldersParsed.pathname).toBe('/rest/v1/folders');
    expect(foldersParsed.searchParams.get('select')).toBe('id,name,description');
    expect(foldersParsed.searchParams.get('order')).toBe('name.asc');

    const [projectsUrl] = spy.mock.calls[1] as [string, RequestInit];
    const projectsParsed = new URL(projectsUrl);
    expect(projectsParsed.pathname).toBe('/rest/v1/projects');
    expect(projectsParsed.searchParams.get('select')).toBe('id,key,name,description');
    expect(projectsParsed.searchParams.get('order')).toBe('key.asc');

    // The exclusion that keeps an archived epic off the board: PostgREST filters it out
    // server-side, so pinning the predicate is what proves this call asks for it.
    const [epicsUrl] = spy.mock.calls[2] as [string, RequestInit];
    const epicsParsed = new URL(epicsUrl);
    expect(epicsParsed.pathname).toBe('/rest/v1/epics');
    expect(epicsParsed.searchParams.get('select')).toBe('id,ref,name,project_id');
    expect(epicsParsed.searchParams.get('archived_at')).toBe('is.null');
    expect(epicsParsed.searchParams.get('order')).toBe('ref.asc');
  });

  it('returns empty lists when nothing exists yet', async () => {
    mockFetchSequence([
      new Response('[]', { status: 200 }),
      new Response('[]', { status: 200 }),
      new Response('[]', { status: 200 }),
    ]);

    await expect(fetchClosedWorld(env)).resolves.toEqual({ folders: [], projects: [], epics: [] });
  });

  it('throws with the status and body when a read fails', async () => {
    mockFetchSequence([
      new Response('[]', { status: 200 }),
      new Response('service unavailable', { status: 503 }),
      new Response('[]', { status: 200 }),
    ]);
    await expect(fetchClosedWorld(env)).rejects.toThrow(
      /GET projects failed: 503 service unavailable/,
    );
  });
});

describe('fetchRecentCorrections', () => {
  it('reads the most recent corrections newest-first with the given limit', async () => {
    const spy = mockFetch(
      Response.json(
        [
          {
            captured_text: 'Buy milk',
            field: 'priority',
            direction: 'changed',
            guessed_value: 'low',
            chosen_value: 'high',
          },
        ],
        { status: 200 },
      ),
    );

    const corrections = await fetchRecentCorrections(env, 5);

    expect(corrections).toEqual([
      {
        captured_text: 'Buy milk',
        field: 'priority',
        direction: 'changed',
        guessed_value: 'low',
        chosen_value: 'high',
      },
    ]);
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/rest/v1/classification_corrections');
    expect(parsed.searchParams.get('select')).toBe(
      'captured_text,field,direction,guessed_value,chosen_value',
    );
    expect(parsed.searchParams.get('order')).toBe('created_at.desc');
    expect(parsed.searchParams.get('limit')).toBe('5');
  });

  it('converts a null guessed_value (an abstention) to undefined', async () => {
    const body = `[
      {
        "captured_text": "Ship it",
        "field": "due_date",
        "direction": "filled_in",
        "guessed_value": null,
        "chosen_value": "2026-08-01"
      }
    ]`;
    mockFetch(new Response(body, { status: 200 }));

    const corrections = await fetchRecentCorrections(env, 5);

    expect(corrections).toEqual([
      {
        captured_text: 'Ship it',
        field: 'due_date',
        direction: 'filled_in',
        guessed_value: undefined,
        chosen_value: '2026-08-01',
      },
    ]);
  });

  it('returns an empty array when there are no corrections yet', async () => {
    mockFetch(new Response('[]', { status: 200 }));
    await expect(fetchRecentCorrections(env, 5)).resolves.toEqual([]);
  });

  it('throws with the status and body on a non-2xx response', async () => {
    mockFetch(new Response('permission denied', { status: 403 }));
    await expect(fetchRecentCorrections(env, 5)).rejects.toThrow(
      /GET classification_corrections failed: 403 permission denied/,
    );
  });
});

describe('patchItem', () => {
  it('PATCHes the item by id with service-role auth and returns the row count', async () => {
    const spy = mockFetch(Response.json([{ id: 'item-1' }], { status: 200 }));

    const count = await patchItem(env, 'item-1', { item_type: 'task', priority: 'high' });

    expect(count).toBe(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/rest/v1/items?id=eq.item-1');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ item_type: 'task', priority: 'high' }));
    const headers = headersOf(init);
    expect(headers['apikey']).toBe('service-role-key');
    expect(headers['Authorization']).toBe('Bearer service-role-key');
    expect(headers['Prefer']).toBe('return=representation');
  });

  it('returns 0 when the row vanished between being read and being written back', async () => {
    mockFetch(new Response('[]', { status: 200 }));
    await expect(patchItem(env, 'item-1', { item_type: 'task' })).resolves.toBe(0);
  });

  it('throws with the item id, status, and body on a non-2xx response', async () => {
    mockFetch(new Response('check constraint violated', { status: 400 }));
    await expect(patchItem(env, 'item-1', { item_type: 'task' })).rejects.toThrow(
      /PATCH items \(item-1\) failed: 400 check constraint violated/,
    );
  });
});
