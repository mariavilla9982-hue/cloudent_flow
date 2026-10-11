begin;
do $$
declare a uuid; v uuid; s uuid; t uuid; test_at timestamptz:=now()+interval '70 days';
begin
select id into a from platform_accounts where platform='instagram' and enabled limit 1;
select id into v from videos where platform='instagram' and coalesce(original_storage_path,storage_path) ~ '^[0-9a-fA-F-]{36}/' limit 1;
insert into schedules(video_id,platform,platform_account_id,scheduled_at,status,smart_mode) values(v,'instagram',a,test_at,'scheduled','manual') returning id into s;
select id into t from reel_test_publications where linked_schedule_id=s;
if t is null then raise exception 'pretrial_fixture_missing'; end if;
update reel_test_publications set attempt_count=3,status='scheduled',next_attempt_at=test_at+interval '2 minutes',last_error='Meta API 503' where id=t;
update schedules set status='queued' where id=s;
if not exists(select 1 from reel_test_publications where id=t and attempt_count=3 and last_error='Meta API 503' and next_attempt_at=test_at+interval '2 minutes') then raise exception 'retry_state_reset'; end if;
update reel_test_publications set status='failed',next_attempt_at=null,last_error='invalid access token',meta=meta||'{"failure_reason":"instagram_reconnect_required","retry_blocked":true}'::jsonb where id=t;
update schedules set status='scheduled' where id=s;
if not exists(select 1 from reel_test_publications where id=t and status='failed' and attempt_count=3 and next_attempt_at is null) then raise exception 'permanent_failure_reset'; end if;
end $$;
rollback;
