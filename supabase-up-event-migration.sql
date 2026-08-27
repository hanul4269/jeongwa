-- Run this once in the Supabase SQL Editor for the existing Jeongwa project.
-- It upgrades both the UP event structure and album-cover support.

alter table public.song_changes add column if not exists cover_url text not null default '';

alter table public.up_events add column if not exists tab_name text not null default 'UP 이벤트';
alter table public.up_events add column if not exists soop_url text not null default '';
alter table public.up_events add column if not exists sort_order integer not null default 0;
alter table public.up_events add column if not exists is_active boolean not null default true;
alter table public.up_events add column if not exists show_on_startup boolean not null default false;

create index if not exists up_events_active_order_idx
on public.up_events (is_active, sort_order);

grant select on table public.up_events to anon;
grant select, insert, update, delete on table public.up_events to authenticated;

drop policy if exists "Everyone can read active UP events" on public.up_events;
create policy "Everyone can read active UP events"
on public.up_events
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Editors can read UP events" on public.up_events;
create policy "Editors can read UP events"
on public.up_events
for select
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Editors can add UP events" on public.up_events;
create policy "Editors can add UP events"
on public.up_events
for insert
to authenticated
with check (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Editors can update UP events" on public.up_events;
create policy "Editors can update UP events"
on public.up_events
for update
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor())
with check (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Editors can remove UP events" on public.up_events;
create policy "Editors can remove UP events"
on public.up_events
for delete
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor());
