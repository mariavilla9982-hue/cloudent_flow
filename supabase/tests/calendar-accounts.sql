begin;
do $$
declare a uuid; b uuid; v uuid; s uuid; s2 uuid; j uuid; at_time timestamptz:=now()+interval '60 days';
begin
select id into a from platform_accounts where platform='instagram' and enabled order by created_at limit 1;
select id into b from platform_accounts where platform='instagram' and enabled and id<>a order by created_at limit 1;
select id into v from videos where platform='instagram' limit 1;
if a is null or b is null or v is null then raise exception 'test_fixtures_missing'; end if;
insert into schedules(video_id,platform,platform_account_id,scheduled_at,status,smart_mode) values(v,'instagram',a,at_time,'scheduled','manual') returning id into s;
insert into schedules(video_id,platform,platform_account_id,scheduled_at,status,smart_mode) values(v,'instagram',b,at_time,'scheduled','manual') returning id into s2;
begin
insert into schedules(video_id,platform,platform_account_id,scheduled_at,status,smart_mode) values(v,'instagram',a,at_time,'scheduled','manual');
raise exception 'same_account_duplicate_accepted';
exception when unique_violation then null; end;
begin
insert into schedules(video_id,platform,scheduled_at,status,smart_mode) values(v,'instagram',at_time+interval '1 minute','scheduled','manual');
raise exception 'missing_account_accepted';
exception when check_violation then null; end;
begin
update schedules set platform_account_id=b where id=s;
raise exception 'account_reassignment_accepted';
exception when check_violation then null; end;
insert into job_queue(job_type,schedule_id,run_at) values('publish_reel',s,at_time) returning id into j;
if not exists(select 1 from job_queue where id=j and platform_account_id=a and platform='instagram') then raise exception 'job_account_not_bound'; end if;
begin
insert into job_queue(job_type,schedule_id,run_at,platform_account_id) values('publish_reel',s,at_time,b);
raise exception 'wrong_job_account_accepted';
exception when check_violation then null; end;
if exists(select 1 from reel_test_publications where linked_schedule_id in(s,s2) and meta->>'platform_account_id' is distinct from (case when linked_schedule_id=s then a else b end)::text) then raise exception 'pretrial_account_not_bound'; end if;
end $$;
rollback;

