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

create table if not exists public.song_changes (
  id text primary key,
  record_type text not null check (record_type in ('custom', 'override')),
  source_song_id text,
  category text not null check (category in ('K-POP', 'J-POP', 'POP/OST', '숙제곡')),
  title text not null,
  artist text not null default '',
  cover_url text not null default '',
  inst_url text not null default '',
  jeongwa_clip_url text not null default '',
  skill_level smallint not null default 0 check (skill_level between 0 and 5),
  tags text[] not null default '{}'::text[],
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint song_changes_override_source check (
    (record_type = 'override' and source_song_id is not null)
    or (record_type = 'custom' and source_song_id is null)
  )
);

alter table public.song_changes add column if not exists cover_url text not null default '';
alter table public.song_changes add column if not exists tags text[] not null default '{}'::text[];

create index if not exists song_changes_tags_idx
on public.song_changes using gin (tags);

create unique index if not exists song_changes_source_song_id_key
on public.song_changes (source_song_id)
where source_song_id is not null;

alter table public.song_changes enable row level security;

revoke all on table public.song_changes from anon;
grant select on table public.song_changes to anon;
grant select, insert, update, delete on table public.song_changes to authenticated;

drop policy if exists "Everyone can read song changes" on public.song_changes;
create policy "Everyone can read song changes"
on public.song_changes
for select
to anon, authenticated
using (true);

drop policy if exists "Editors can add song changes" on public.song_changes;
create policy "Editors can add song changes"
on public.song_changes
for insert
to authenticated
with check (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Editors can update song changes" on public.song_changes;
create policy "Editors can update song changes"
on public.song_changes
for update
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor())
with check (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Editors can remove song changes" on public.song_changes;
create policy "Editors can remove song changes"
on public.song_changes
for delete
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor());

create table if not exists public.up_events (
  id text primary key,
  tab_name text not null default 'UP 이벤트',
  title text not null,
  soop_url text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  show_on_startup boolean not null default false,
  start_date date,
  end_date date,
  status text not null default '진행중' check (status in ('예정', '진행중', '종료')),
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);

alter table public.up_events add column if not exists tab_name text not null default 'UP 이벤트';
alter table public.up_events add column if not exists soop_url text not null default '';
alter table public.up_events add column if not exists sort_order integer not null default 0;
alter table public.up_events add column if not exists is_active boolean not null default true;
alter table public.up_events add column if not exists show_on_startup boolean not null default false;

create index if not exists up_events_active_order_idx
on public.up_events (is_active, sort_order);

create table if not exists public.up_entries (
  id text primary key,
  event_id text not null references public.up_events(id) on delete cascade,
  nickname text not null default '',
  song_title text not null default '',
  up_count integer not null default 0 check (up_count >= 0),
  memo text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint up_entries_name_or_song check (nickname <> '' or song_title <> '')
);

alter table public.up_events enable row level security;
alter table public.up_entries enable row level security;

revoke all on table public.up_events from anon;
revoke all on table public.up_entries from anon;
grant select on table public.up_events to anon;
grant select, insert, update, delete on table public.up_events to authenticated;
grant select, insert, update, delete on table public.up_entries to authenticated;

drop policy if exists "Editors can read UP events" on public.up_events;
create policy "Editors can read UP events"
on public.up_events
for select
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Everyone can read active UP events" on public.up_events;
create policy "Everyone can read active UP events"
on public.up_events
for select
to anon, authenticated
using (is_active = true);

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

drop policy if exists "Editors can read UP entries" on public.up_entries;
create policy "Editors can read UP entries"
on public.up_entries
for select
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Editors can add UP entries" on public.up_entries;
create policy "Editors can add UP entries"
on public.up_entries
for insert
to authenticated
with check (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Editors can update UP entries" on public.up_entries;
create policy "Editors can update UP entries"
on public.up_entries
for update
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor())
with check (public.jeongwa_is_owner() or public.jeongwa_is_editor());

drop policy if exists "Editors can remove UP entries" on public.up_entries;
create policy "Editors can remove UP entries"
on public.up_entries
for delete
to authenticated
using (public.jeongwa_is_owner() or public.jeongwa_is_editor());

create table if not exists public.song_reactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id text not null,
  liked boolean not null default false,
  favorited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, song_id),
  constraint song_reactions_has_value check (liked or favorited)
);

create index if not exists song_reactions_liked_song_idx
on public.song_reactions (song_id)
where liked = true;

alter table public.song_reactions enable row level security;

revoke all on table public.song_reactions from anon;
grant select, insert, update, delete on table public.song_reactions to authenticated;

drop policy if exists "Users can read own song reactions" on public.song_reactions;
create policy "Users can read own song reactions"
on public.song_reactions
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can add own song reactions" on public.song_reactions;
create policy "Users can add own song reactions"
on public.song_reactions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update own song reactions" on public.song_reactions;
create policy "Users can update own song reactions"
on public.song_reactions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can remove own song reactions" on public.song_reactions;
create policy "Users can remove own song reactions"
on public.song_reactions
for delete
to authenticated
using (user_id = auth.uid());

create or replace function public.jeongwa_song_like_counts()
returns table (song_id text, like_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select reactions.song_id, count(*)::bigint as like_count
  from public.song_reactions as reactions
  where reactions.liked = true
  group by reactions.song_id;
$$;

revoke all on function public.jeongwa_song_like_counts() from public;
grant execute on function public.jeongwa_song_like_counts() to anon, authenticated;
