
begin;
do $$
declare u uuid; a uuid; before_count integer; after_count integer;
begin
 select user_id into u from app_members where enabled and role='admin';
 select id into a from platform_accounts where platform='instagram' and enabled order by created_at limit 1;
 perform generate_cloudent_patch_notifications('2030-01-02 08:59:00+00');
 if exists(select 1 from system_notifications where category='daily_summary' and meta->>'date'='2030-01-02') then raise exception 'Summary before 06:00'; end if;
 perform generate_cloudent_patch_notifications('2030-01-02 09:00:00+00');
 perform generate_cloudent_patch_notifications('2030-01-02 10:00:00+00');
 if (select count(*) from system_notifications where category='daily_summary' and meta->>'date'='2030-01-02')<>(select count(*) from app_members where enabled) then raise exception 'Daily dedupe or recipient scope'; end if;
 perform claim_story_monitor_accounts();
 insert into instagram_story_monitor(account_id) values(a) on conflict do nothing;
 update instagram_story_monitor set last_known_status='active',empty_since=null where account_id=a;
 select count(*) into before_count from system_notifications where category='stories_empty' and source_ref=a::text;
 perform record_story_monitor_result(a,0,null);
 perform record_story_monitor_result(a,0,null);
 perform record_story_monitor_result(a,null,'Synthetic test API unavailable');
 perform record_story_monitor_result(a,0,null);
 select count(*) into after_count from system_notifications where category='stories_empty' and source_ref=a::text;
 if after_count-before_count<>1 then raise exception 'Repeated empty or unknown generated duplicate'; end if;
 perform record_story_monitor_result(a,1,null);
 perform record_story_monitor_result(a,0,null);
 select count(*) into after_count from system_notifications where category='stories_empty' and source_ref=a::text;
 if after_count-before_count<>2 then raise exception 'New empty episode missed'; end if;
 if exists(select 1 from claim_story_monitor_accounts()) then raise exception 'Story account concurrently reclaimable'; end if;
 if has_function_privilege('authenticated','public.record_story_monitor_result(uuid,integer,text)','EXECUTE') then raise exception 'Client can spoof monitor'; end if;
 if exists(select 1 from system_notifications where category in ('daily_summary','stories_empty','stories_access') and user_id in (select user_id from app_members where not enabled)) then raise exception 'Disabled recipient'; end if;
end $$;
select 'PASS: 06:00 Brazil, daily dedupe, recipient scope, story episodes, API failure, claim lock, RPC permissions' as checks;
rollback;