-- Alfred — a respacing jump replies with every rank it renumbered, not just the story it moved (ALF-250).
--
-- `move_code_priority_in_project` (0031) may call `respace_code_priorities()` before it takes its
-- midpoint, which rewrites EVERY story's rank to 1..N. Its reply, though, was only the moved story's
-- row. A tab hears the other stories' new ranks from Realtime — which usually trails the HTTP reply
-- — so for that window it showed the moved story on the new rank scale and every other story on
-- the old one: the Backlog misordered, and a click in that window hit the wrong neighbour.
--
-- The reply is the one channel a tab hears in order, so a respace's renumbered rows belong in it,
-- not only on the stream. When the loop respaced, the function now updates the moved row and
-- replies with every `code_items` row (each at its final rank and `priority_rev`); a jump that
-- didn't respace still replies with just the row it moved. The signature is unchanged, so the
-- generated types don't move.
--
-- Body copied from 0031 (the migration that last defined it) — re-deriving from an older one
-- silently reverts later fixes (0025's trap) — with only `v_respaced` and the tail changed.
create or replace function move_code_priority_in_project(p_ref text, p_to_top boolean)
returns setof code_items language plpgsql security invoker as $$
declare
  v_project uuid; v_extreme double precision; v_neighbour double precision; v_new double precision;
  v_pass int; v_midpoint boolean; v_respaced boolean := false;
begin
  select project_id into v_project from code_items where ref = p_ref;
  if v_project is null then
    raise exception 'move_code_priority_in_project: unknown ref (%)', p_ref;
  end if;

  for v_pass in 1..2 loop
    -- `v_midpoint` records whether this pass actually took a midpoint: the "no peer" branches
    -- step a whole 1 away from an extreme and can never collide, so only the midpoint needs the
    -- exhaustion check below.
    v_midpoint := false;
    if p_to_top then
      -- ALF-120: extreme over the project's OUTSTANDING stories only (exclude done/abandoned).
      select min(priority) into v_extreme
        from code_items
        where project_id = v_project and ref <> p_ref
          and factory_state not in ('done', 'abandoned');
      if v_extreme is null then
        select coalesce(min(priority), 0) - 1 into v_new from code_items where ref <> p_ref;
      else
        select max(priority) into v_neighbour
          from code_items where priority < v_extreme and ref <> p_ref;
        if v_neighbour is null then
          v_new := v_extreme - 1;
        else
          v_new := (v_neighbour + v_extreme) / 2.0;
          v_midpoint := true;
        end if;
      end if;
    else
      select max(priority) into v_extreme
        from code_items
        where project_id = v_project and ref <> p_ref
          and factory_state not in ('done', 'abandoned');
      if v_extreme is null then
        select coalesce(max(priority), 0) + 1 into v_new from code_items where ref <> p_ref;
      else
        select min(priority) into v_neighbour
          from code_items where priority > v_extreme and ref <> p_ref;
        if v_neighbour is null then
          v_new := v_extreme + 1;
        else
          v_new := (v_neighbour + v_extreme) / 2.0;
          v_midpoint := true;
        end if;
      end if;
    end if;
    exit when not v_midpoint or (v_new <> v_neighbour and v_new <> v_extreme);
    if v_pass = 2 then
      raise exception 'move_code_priority_in_project: ranks still exhausted after respacing';
    end if;
    perform respace_code_priorities();
    v_respaced := true;
  end loop;

  if v_respaced then
    -- Every story's rank was rewritten, so every story's row goes back: the moved row (updated
    -- here, so it carries its final rank and revision) and each one the respace renumbered.
    update code_items set priority = v_new where ref = p_ref;
    return query select * from code_items;
  else
    return query
      update code_items set priority = v_new where ref = p_ref returning *;
  end if;
end; $$;

grant execute on function move_code_priority_in_project(text, boolean)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
