---
branch: claude/alf-22-create-code-story-migration
---

# ALF-22 — create_code_story RPC (migration slice)

*2026-06-23T16:34:28.956Z*

The Software Factory board mints a code story today **only by gating an existing inbox item** (`enter_code_module`, migration 0002 §7). ALF-22 adds a `+` on each epic header to create a brand-new story straight from the project view — which needs a sibling RPC that **inserts** a fresh `items` row plus its `code_items` sidecar in one transaction (the gate only *flips* an existing row, so it can't be reused). This demo covers the **migration slice only** — the `create_code_story` RPC in `0004`. The API shape, optimistic store action, board UI, and tests (spec §2–§5) are a separate, still-unbuilt slice and are **not** in this PR.

```bash
cat database/migrations/0004_create_code_story.sql
```

```output
-- Create a brand-new code story from the project view: insert the item AND its
-- code_items sidecar in one transaction, landing at needs_refinement. Mirrors
-- enter_code_module (0002 §7) but inserts a fresh item instead of flipping an
-- existing one — there is no inbox row to admit. notes is optional (NULL).
create or replace function create_code_story(
  p_project uuid, p_epic uuid, p_title text, p_notes text default null
) returns code_items language plpgsql security invoker as $$
declare n int; k text; v_item uuid; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  insert into items (title, notes, item_type)
  values (p_title, p_notes, 'code')
  returning id into v_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref)
  values (v_item, p_project, p_epic, n, k || '-' || n) returning * into row;
  return row;
end; $$;

grant execute on function create_code_story(uuid, uuid, text, text)
  to anon, authenticated, service_role;
```

**Applied & verified against the live project 2026-06-22** (credentialed, local — `supabase db push` needs creds a CI/web sandbox lacks, per spec §1). Applied directly with `psql` over the session pooler, then verified the function landed exactly as specified:
> `create_code_story` — **SECURITY INVOKER** ✓ · **returns code_items** ✓ · **EXECUTE** granted to anon / authenticated / service_role ✓
No `database.types.ts` regeneration is required: the RPC returns the existing `code_items` row type, so `supabase gen types` would only add the function signature, which the client does not depend on. Re-running the migration is a safe no-op (`create or replace function`).
