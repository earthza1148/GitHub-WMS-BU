create or replace function public.current_user_master_rank()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select um.rank
  from public."User Master" as um
  where um.uid::text = auth.uid()::text
  limit 1
$$;

create or replace function public.is_admin_or_master()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_master_rank() in ('Admin', 'Master'), false)
$$;

revoke all on function public.current_user_master_rank() from public;
revoke all on function public.is_admin_or_master() from public;
grant execute on function public.current_user_master_rank() to authenticated;
grant execute on function public.is_admin_or_master() to authenticated;

alter table public."Category Master" enable row level security;
alter table public."Item Master" enable row level security;
alter table public."Transection Inventory" enable row level security;

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'Category Master',
    'Item Master',
    'Transection Inventory'
  ]
  loop
    for policy_name in
      select pol.polname
      from pg_policy pol
      join pg_class cls on cls.oid = pol.polrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      where nsp.nspname = 'public'
        and cls.relname = table_name
    loop
      execute format('drop policy if exists %I on %I.%I', policy_name, 'public', table_name);
    end loop;
  end loop;
end $$;

create policy "Category Master select authenticated"
on public."Category Master"
for select
to authenticated
using (true);

create policy "Category Master insert admin or master"
on public."Category Master"
for insert
to authenticated
with check (public.is_admin_or_master());

create policy "Category Master update admin or master"
on public."Category Master"
for update
to authenticated
using (public.is_admin_or_master())
with check (public.is_admin_or_master());

create policy "Category Master delete admin or master"
on public."Category Master"
for delete
to authenticated
using (public.is_admin_or_master());

create policy "Item Master select authenticated"
on public."Item Master"
for select
to authenticated
using (true);

create policy "Item Master insert admin or master"
on public."Item Master"
for insert
to authenticated
with check (public.is_admin_or_master());

create policy "Item Master update admin or master"
on public."Item Master"
for update
to authenticated
using (public.is_admin_or_master())
with check (public.is_admin_or_master());

create policy "Item Master delete admin or master"
on public."Item Master"
for delete
to authenticated
using (public.is_admin_or_master());

create policy "Transection Inventory select authenticated"
on public."Transection Inventory"
for select
to authenticated
using (true);

create policy "Transection Inventory insert admin or master"
on public."Transection Inventory"
for insert
to authenticated
with check (public.is_admin_or_master());

create policy "Transection Inventory update admin or master"
on public."Transection Inventory"
for update
to authenticated
using (public.is_admin_or_master())
with check (public.is_admin_or_master());

create policy "Transection Inventory delete admin or master"
on public."Transection Inventory"
for delete
to authenticated
using (public.is_admin_or_master());
