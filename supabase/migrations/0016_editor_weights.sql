-- ═══════════════════════════════════════════════════════════════════════════
-- Editors may set a material's weight (the user, 2026-11-16).
--
-- The catalog stays the admins' - only they insert, rename, resize or delete -
-- but the weight of a part is something whoever draws needs right, for the
-- PDF's სულ წონა. One narrow door, like set_stock: this function changes the
-- weight and nothing else, for an admin or an editor.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.set_material_weight(
  p_material_id text,
  p_weight      numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_edit() then
    raise exception 'only an admin or an editor may change a weight' using errcode = '42501';
  end if;
  if p_weight is null or p_weight < 0 then
    raise exception 'weight must be 0 or more' using errcode = '22023';
  end if;
  update public.materials set weight = p_weight where id = p_material_id;
  if not found then
    raise exception 'no material %', p_material_id using errcode = 'P0002';
  end if;
  return p_weight;
end;
$$;

grant execute on function public.set_material_weight(text, numeric) to authenticated;

notify pgrst, 'reload schema';
