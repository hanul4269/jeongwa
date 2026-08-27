-- Run this once in the Supabase SQL Editor for the existing Jeongwa project.
-- Likes are counted publicly; each user's favorites remain private.

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
