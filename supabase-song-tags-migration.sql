-- Run this once in the Supabase SQL Editor.
-- Existing song rows are preserved and start with no tags.

alter table public.song_changes
add column if not exists tags text[] not null default '{}'::text[];

create index if not exists song_changes_tags_idx
on public.song_changes using gin (tags);
