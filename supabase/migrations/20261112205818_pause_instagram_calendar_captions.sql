create function public.instagram_calendar_captions_paused(p_account_id uuid) returns boolean
language sql stable set search_path='' as $$
select exists(select 1 from public.app_settings s join public.platform_accounts a on a.id=p_account_id
where s.key='instagram_calendar_captions' and s.value->'enabled'='false'::jsonb and a.platform='instagram'
and (a.workspace_id::text=s.value->>'workspace_id' or (a.workspace_id is null and lower(ltrim(a.account_label,'@'))='sahryjapah')));
$$;
revoke all on function public.instagram_calendar_captions_paused(uuid) from public,anon,authenticated;
grant execute on function public.instagram_calendar_captions_paused(uuid) to service_role;
alter table public.instagram_feed_posts add column caption_suppressed boolean not null default false;