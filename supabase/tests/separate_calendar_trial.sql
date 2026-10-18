begin;
set local statement_timeout='8s';
set local lock_timeout='2s';
-- All changes roll back; no external publisher is called.
do $$
declare s schedules%rowtype; v videos%rowtype; actor uuid; p reel_test_publications%rowtype; n integer; original_video uuid; original_time timestamptz; original_account uuid; bad uuid;
begin
 select s0.* into strict s from schedules s0 join reel_test_publications t on t.linked_schedule_id=s0.id and t.trial_kind='prepost' where s0.scheduled_at>now() and s0.status='scheduled' and t.status='scheduled' and t.container_id is null and t.locked_at is null order by s0.scheduled_at limit 1;
 select user_id into strict actor from app_members where role='admin' and enabled limit 1;
 select v0.* into strict v from videos v0 join production_jobs j on j.result_video_id=v0.id where j.status='ready' and j.user_id=actor and v0.storage_provider='r2' and v0.storage_deleted_at is null and (v0.platform_account_id is null or v0.platform_account_id=s.platform_account_id) and v0.id<>s.video_id limit 1;
 original_video:=s.video_id;original_time:=s.scheduled_at;original_account:=s.platform_account_id;
 select count(*) into n from schedules;
 perform set_calendar_trial_video(s.id,null,actor);
 select * into strict p from reel_test_publications where linked_schedule_id=s.id and trial_kind='prepost';
 if p.source_video_id<>s.video_id or p.scheduled_at<>s.scheduled_at-interval '20 minutes' then raise exception 'default_same_video_or_time_failed';end if;
 perform set_calendar_trial_video(s.id,v.id,actor);
 select * into strict p from reel_test_publications where linked_schedule_id=s.id and trial_kind='prepost';
 if p.source_video_id<>v.id or p.storage_path<>v.storage_path or p.meta->>'platform_account_id'<>s.platform_account_id::text then raise exception 'separate_video_route_failed';end if;
 select * into strict s from schedules where id=s.id;
 if s.video_id<>original_video or s.scheduled_at<>original_time or s.platform_account_id<>original_account or n<>(select count(*) from schedules) then raise exception 'main_slot_modified';end if;
 update reel_test_publications set status='failed',last_error='QA only' where id=p.id;
 if (select status from schedules where id=s.id)<>'scheduled' then raise exception 'trial_failure_blocked_main';end if;
 update videos set platform_account_id=(select id from platform_accounts where platform='instagram' and id<>s.platform_account_id limit 1) where id=v.id;
 begin perform set_calendar_trial_video(s.id,v.id,actor);raise exception 'cross_account_accepted';exception when raise_exception then if sqlerrm<>'trial_video_account_mismatch' then raise;end if;end;
 begin perform set_calendar_trial_video(s.id,null,(select user_id from app_members where role='x_user' limit 1));raise exception 'x_user_accepted';exception when raise_exception then if sqlerrm<>'forbidden' then raise;end if;end;
 update reel_test_publications set status='processing',container_id='qa-container' where id=p.id;
 begin perform set_calendar_trial_video(s.id,null,actor);raise exception 'active_trial_swapped';exception when raise_exception then if sqlerrm<>'trial_already_started' then raise;end if;end;
 update schedules set scheduled_at=now()-interval '1 minute' where id=s.id;
 if not exists(select 1 from job_queue where schedule_id=s.id and job_type='publish_reel') then
   insert into job_queue(job_type,schedule_id,run_at,status,platform,platform_account_id) values('publish_reel',s.id,now(),'pending','instagram',s.platform_account_id);
 end if;
 update job_queue set locked_at=null,locked_by=null,status='pending' where schedule_id=s.id and job_type='publish_reel';
 if not exists(select 1 from claim_calendar_publish_schedule(s.id,'qa-a')) then raise exception 'main_claim_failed';end if;
 if exists(select 1 from claim_calendar_publish_schedule(s.id,'qa-b')) then raise exception 'main_double_claim';end if;
 update schedules set status='cancelled' where id=s.id;
 update job_queue set locked_at=null,locked_by=null where schedule_id=s.id;
 if exists(select 1 from claim_calendar_publish_schedule(s.id,'qa-c')) then raise exception 'cancelled_main_claimed';end if;
 if has_function_privilege('authenticated','public.set_calendar_trial_video(uuid,uuid,uuid)','execute') then raise exception 'service_rpc_exposed';end if;
end $$;
rollback;
