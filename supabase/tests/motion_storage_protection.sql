begin; set local statement_timeout='8s'; set local lock_timeout='2s';
do $test$
declare s jsonb; u uuid; j uuid:=gen_random_uuid(); r jsonb; before_count int;
begin
update public.motion_storage_health set phase='unknown',reason=null,next_probe_at=now(),probe_owner=null,probe_until=null,managed_reads=0,counter_day=(now() at time zone 'UTC')::date;
select user_id into u from public.production_jobs where meta->>'workflow_key'='motion_control' limit 1;
s:=public.motion_storage_claim_probe('test-a');
if not (s->>'should_probe')::boolean then raise exception 'first probe not leased';end if;
s:=public.motion_storage_claim_probe('test-b');if (s->>'should_probe')::boolean then raise exception 'concurrent probe leased';end if;
s:=public.motion_storage_finish_probe('test-b',true);if s->>'phase'='healthy' then raise exception 'wrong owner opened breaker';end if;
s:=public.motion_storage_finish_probe('test-a',true);if s->>'phase'<>'healthy' then raise exception 'verified probe did not resume';end if;
s:=public.motion_storage_claim_probe('test-c');if (s->>'should_probe')::boolean or not(s->>'allow_primary')::boolean then raise exception 'healthy TTL ignored';end if;
update public.motion_storage_health set managed_reads=999;
if public.motion_storage_record_read(2) then raise exception 'budget exceeded';end if;
select public.motion_storage_status() into s;if s->>'reason'<>'preventive_budget' then raise exception 'budget not blocked';end if;
update public.motion_storage_health set counter_day=current_date-1;
s:=public.motion_storage_claim_probe('test-day');if not(s->>'should_probe')::boolean then raise exception 'daily budget did not reset';end if;
r:=public.motion_storage_reserve(j,u,1024,41943040);if not(r->>'ok')::boolean then raise exception 'small reserve rejected';end if;
r:=public.motion_storage_reserve(j,u,1024,41943040);
select count(*) into before_count from public.motion_storage_reservations where job_id=j;if before_count<>1 then raise exception 'duplicate reservation';end if;
if has_function_privilege('authenticated','public.motion_storage_claim_probe(text)','EXECUTE') or has_table_privilege('authenticated','public.motion_storage_health','SELECT') then raise exception 'state exposed';end if;
if has_function_privilege('anon','public.motion_storage_reserve(uuid,uuid,bigint,bigint)','EXECUTE') then raise exception 'reserve exposed';end if;
end $test$;

do $reserve$
declare u uuid; a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d uuid:=gen_random_uuid();r jsonb;
begin
select user_id into u from public.production_jobs where meta->>'workflow_key'='motion_control' limit 1;
update public.motion_storage_reservations set state='released';
r:=public.motion_storage_reserve(a,u,12582912,41943040);if not(r->>'ok')::boolean then raise exception 'reservation1';end if;
r:=public.motion_storage_reserve(b,u,12582912,41943040);if not(r->>'ok')::boolean then raise exception 'reservation2';end if;
r:=public.motion_storage_reserve(c,u,12582912,41943040);if not(r->>'ok')::boolean then raise exception 'reservation3';end if;
r:=public.motion_storage_reserve(d,u,12582912,41943040);if (r->>'ok')::boolean then raise exception 'reserve budget exceeded';end if;
begin perform public.motion_storage_reserve(a,gen_random_uuid(),1,1);raise exception 'wrong-owner accepted';exception when others then if sqlerrm='wrong-owner accepted' then raise;end if;end;
end $reserve$;
rollback;