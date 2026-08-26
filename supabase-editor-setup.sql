create table if not exists public.editors (
  email text primary key,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint editors_email_lowercase check (email = lower(email))
);

alter table public.editors enable row level security;

create or replace function public.jeongwa_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'riosniper12@gmail.com';
$$;

create or replace function public.jeongwa_is_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.editors
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.jeongwa_is_owner() from public;
revoke all on function public.jeongwa_is_editor() from public;
grant execute on function public.jeongwa_is_owner() to authenticated;
grant execute on function public.jeongwa_is_editor() to authenticated;

revoke all on table public.editors from anon;
grant select, insert, update, delete on table public.editors to authenticated;

drop policy if exists "Editors can read editor list" on public.editors;
create policy "Editors can read editor list"
on public.editors
for select
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Owner can add editors" on public.editors;
create policy "Owner can add editors"
on public.editors
for insert
to authenticated
with check (public.jeongwa_is_owner());

drop policy if exists "Owner can update editors" on public.editors;
create policy "Owner can update editors"
on public.editors
for update
to authenticated
using (public.jeongwa_is_owner())
with check (public.jeongwa_is_owner());

drop policy if exists "Owner can remove editors" on public.editors;
create policy "Owner can remove editors"
on public.editors
for delete
to authenticated
using (public.jeongwa_is_owner());

insert into public.editors (email)
values ('jeongwazzang@gmail.com')
on conflict (email) do nothing;
