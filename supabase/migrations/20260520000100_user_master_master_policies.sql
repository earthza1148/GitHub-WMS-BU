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

create or replace function public.is_user_master()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_master_rank() = 'Master', false)
$$;

create or replace function public.prevent_non_master_user_master_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_user_master() then
    return new;
  end if;

  if (to_jsonb(new) - 'login_at') is distinct from (to_jsonb(old) - 'login_at') then
    raise exception 'Only Master users can edit User Master fields other than login_at';
  end if;

  return new;
end;
$$;

revoke all on function public.current_user_master_rank() from public;
revoke all on function public.is_user_master() from public;
grant execute on function public.current_user_master_rank() to authenticated;
grant execute on function public.is_user_master() to authenticated;

alter table public."User Master" enable row level security;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select pol.polname
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'User Master'
  loop
    execute format('drop policy if exists %I on %I.%I', policy_name, 'public', 'User Master');
  end loop;
end $$;

drop trigger if exists prevent_non_master_user_master_changes
on public."User Master";

create trigger prevent_non_master_user_master_changes
before update on public."User Master"
for each row
execute function public.prevent_non_master_user_master_changes();

create policy "User Master select own row or master"
on public."User Master"
for select
to authenticated
using (
  uid::text = auth.uid()::text
  or public.is_user_master()
);

create policy "User Master insert master only"
on public."User Master"
for insert
to authenticated
with check (public.is_user_master());

create policy "User Master update master or own login_at"
on public."User Master"
for update
to authenticated
using (
  public.is_user_master()
  or uid::text = auth.uid()::text
)
with check (
  public.is_user_master()
  or uid::text = auth.uid()::text
);

create policy "User Master delete master only"
on public."User Master"
for delete
to authenticated
using (public.is_user_master());
