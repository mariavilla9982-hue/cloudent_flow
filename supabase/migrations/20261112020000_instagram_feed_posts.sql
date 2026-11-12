create table public.instagram_feed_posts (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  platform_account_id uuid not null references public.platform_accounts(id),
  scheduled_at timestamptz not null,
  caption text not null check (char_length(caption) <= 2200),
  photo_paths text[] not null check (cardinality(photo_paths) between 1 and 10),
  status text not null default 'scheduled' check (status in ('scheduled','processing','publishing','published','failed','cancelled')),
  child_ids text[] not null default '{}',
  container_id text,
  instagram_media_id text,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  lock_id uuid,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.instagram_feed_posts enable row level security;
revoke all on public.instagram_feed_posts from public, anon, authenticated;
grant select, insert, update on public.instagram_feed_posts to service_role;
create index instagram_feed_posts_due on public.instagram_feed_posts (next_attempt_at, scheduled_at)
  where status in ('scheduled','processing','publishing');
create index instagram_feed_posts_owner_calendar on public.instagram_feed_posts (user_id, platform_account_id, scheduled_at);
