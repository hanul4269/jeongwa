-- Adds a lyrics link to the shared song catalog.
-- Safe to run more than once.

alter table public.song_changes
  add column if not exists lyrics_url text not null default '';
