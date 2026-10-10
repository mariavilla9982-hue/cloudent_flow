-- Repair only media ownership proven by publication records.
update public.instagram_media m set platform_account_id=s.platform_account_id from public.schedules s
where m.ig_media_id=s.instagram_media_id and m.platform_account_id is null and s.platform_account_id is not null;
update public.instagram_media m set platform_account_id=a.id from public.reel_test_publications t join public.platform_accounts a
on a.id::text=t.meta->>'platform_account_id'
where m.ig_media_id=t.instagram_media_id and m.platform_account_id is null;
create or replace view public.latest_instagram_metrics with (security_invoker=true) as
select distinct on(m.id) m.id as instagram_media_record_id,m.ig_media_id,m.caption,m.permalink,m.thumbnail_url,
 m.media_type,m.media_product_type,m.posted_at,ms.collected_at,ms.views,ms.reach,ms.likes,ms.comments,ms.shares,ms.saves,
 m.media_url,m.platform_account_id
from public.instagram_media m join public.metrics_snapshots ms on ms.instagram_media_record_id=m.id
where nullif(ms.raw->>'insights_error','') is null
order by m.id,ms.collected_at desc,ms.id desc;
create table public.instagram_metrics_sync_state (
 account_id uuid primary key references public.platform_accounts(id) on delete cascade,
 followers_error text,last_followers_attempt_at timestamptz,
 metrics_error text,last_metrics_attempt_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.instagram_metrics_sync_state enable row level security;
revoke all on public.instagram_metrics_sync_state from anon,authenticated;
grant all on public.instagram_metrics_sync_state to service_role;
