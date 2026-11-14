-- Optional shared backend for post reactions and page views (Supabase /
-- Postgres). Run in the Supabase SQL editor, then put the project URL and the
-- anon (publishable) key in content/site.json under "reactions". The whole
-- file can be run again at any time (after an update, for the new parts).
--
-- One row per (post, visitor): a visitor can hold a single reaction per post.
-- The visitor is a random id generated in the browser; no personal data.
-- The table has no public policies: it is reachable only through the two
-- functions below, so visitor ids cannot be listed from outside.

create table if not exists public.reactions (
  post       text        not null check (length(post) between 1 and 120),
  voter      uuid        not null,
  kind       text        not null check (kind in ('sun','moon','rain','cloud','leaf','water','wind')),
  updated_at timestamptz not null default now(),
  primary key (post, voter)
);

alter table public.reactions enable row level security;

-- Set, change or (with p_kind = null) remove the visitor's reaction.
create or replace function public.react(p_post text, p_voter uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind is null then
    delete from public.reactions r where r.post = p_post and r.voter = p_voter;
  else
    insert into public.reactions (post, voter, kind)
    values (p_post, p_voter, p_kind)
    on conflict (post, voter)
    do update set kind = excluded.kind, updated_at = now();
  end if;
end;
$$;

-- Totals per reaction kind for one post.
create or replace function public.reaction_counts(p_post text)
returns table (kind text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select r.kind, count(*) from public.reactions r where r.post = p_post group by r.kind;
$$;

revoke all on function public.react(text, uuid, text) from public;
revoke all on function public.reaction_counts(text) from public;
grant execute on function public.react(text, uuid, text) to anon;
grant execute on function public.reaction_counts(text) to anon;

-- Totals for every post at once (home page reactions). Optional: without it
-- the site asks post by post.
create or replace function public.reaction_summary()
returns table (post text, kind text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select r.post, r.kind, count(*) from public.reactions r group by r.post, r.kind;
$$;

revoke all on function public.reaction_summary() from public;
grant execute on function public.reaction_summary() to anon;

-- Reactions set or changed after a moment in time, for the "new reactions"
-- note in the editor.
create or replace function public.reactions_since(p_since timestamptz)
returns table (post text, kind text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select r.post, r.kind, count(*) from public.reactions r
  where r.updated_at > p_since group by r.post, r.kind;
$$;

revoke all on function public.reactions_since(timestamptz) from public;
grant execute on function public.reactions_since(timestamptz) to anon;

-- Page views: one number per page per day (UTC). Nothing about the visitor
-- is stored: no id, no address, no browser. "page" is the post's folder
-- name, "@home" or "@about". Like reactions, the table is reachable only
-- through the functions below.
create table if not exists public.views (
  page  text    not null check (page ~ '^@?[a-z0-9][a-z0-9_-]{0,119}$'),
  day   date    not null default (now() at time zone 'utc')::date,
  count integer not null default 0,
  primary key (page, day)
);

alter table public.views enable row level security;

-- Count one view of a page, today.
create or replace function public.view(p_page text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.views (page, count) values (p_page, 1)
  on conflict (page, day) do update set count = public.views.count + 1;
$$;

-- Views per page: today, the last 7 days, ever. Shown in the editor.
create or replace function public.view_counts()
returns table (page text, today bigint, week bigint, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select v.page,
    coalesce(sum(v.count) filter (where v.day = (now() at time zone 'utc')::date), 0)::bigint,
    coalesce(sum(v.count) filter (where v.day > (now() at time zone 'utc')::date - 7), 0)::bigint,
    sum(v.count)::bigint
  from public.views v group by v.page;
$$;

revoke all on function public.view(text) from public;
revoke all on function public.view_counts() from public;
grant execute on function public.view(text) to anon;
grant execute on function public.view_counts() to anon;
