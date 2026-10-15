-- Motion-only storage protection. All state/RPC access is service-role only.
create table if not exists public.motion_storage_health (
 id boolean primary key default true check(id),
 phase text not null default 'unknown' check(phase in ('unknown','healthy','blocked')),
 reason text, last_error text, checked_at timestamptz, next_probe_at timestamptz not null default now(),
 probe_owner text, probe_until timestamptz,
 counter_day date not null default (now() at time zone 'UTC')::date,
 managed_reads integer not null default 0 check(managed_reads>=0),
 daily_read_budget integer not null default 1000 check(daily_read_budget between 100 and 10000),
 updated_at timestamptz not null default now()
);
alter table public.motion_storage_health enable row level security;
revoke all on public.motion_storage_health from public,anon,authenticated;
grant select,insert,update,delete on public.motion_storage_health to service_role;
insert into public.motion_storage_health(id,phase,reason,last_error,next_probe_at)
values(true,'blocked','provider_cap','Backblaze bloqueou leituras por limite diário.',now()) on conflict(id) do nothing;

create table if not exists public.motion_storage_reservations (
 job_id uuid primary key,user_id uuid not null references auth.users(id),
 input_bytes bigint not null default 0 check(input_bytes>=0),
 allocated_bytes bigint not null check(allocated_bytes>0),
 state text not null default 'held' check(state in ('held','committed','released')),
 input_prefix text not null,result_path text,
 expires_at timestamptz not null default now()+interval '1 hour',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.motion_storage_reservations enable row level security;
revoke all on public.motion_storage_reservations from public,anon,authenticated;
grant select,insert,update,delete on public.motion_storage_reservations to service_role;

create or replace function public.motion_storage_notify(p_suffix text,p_title text,p_body text,p_severity text default 'warn')
returns void language sql security invoker set search_path=public as $$
 insert into public.system_notifications(user_id,severity,category,title,body,source_event_type,dedupe_key,next_attempt_at,meta)
 select distinct user_id,p_severity,'system',p_title,p_body,'motion_storage_protection',
 'motion-storage:'||(now() at time zone 'UTC')::date||':'||p_suffix||':'||user_id,now(),
 jsonb_build_object('workflow_key','motion_control','measured_by','cloudent_managed_operations')
 from public.production_jobs where meta->>'workflow_key'='motion_control' and hidden_at is null
 on conflict(dedupe_key) do nothing;
$$;

create or replace function public.motion_storage_claim_probe(p_owner text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s public.motion_storage_health; today date:=(now() at time zone 'UTC')::date;
begin
 select * into s from public.motion_storage_health where id=true for update;
 if s.counter_day<>today then
  update public.motion_storage_health set counter_day=today,managed_reads=0,
   phase=case when reason='preventive_budget' then 'unknown' else phase end,
   next_probe_at=case when reason='preventive_budget' then now() else next_probe_at end,
   reason=case when reason='preventive_budget' then null else reason end where id=true returning * into s;
 end if;
 if s.next_probe_at>now() or s.probe_until>now() then
  return to_jsonb(s)||jsonb_build_object('should_probe',false,'allow_primary',s.phase='healthy' and s.next_probe_at>now());
 end if;
 update public.motion_storage_health set probe_owner=p_owner,probe_until=now()+interval '45 seconds',updated_at=now() where id=true returning * into s;
 return to_jsonb(s)||jsonb_build_object('should_probe',true,'allow_primary',false);
end; $$;

create or replace function public.motion_storage_record_read(p_count integer default 1)
returns boolean language plpgsql security invoker set search_path=public as $$
declare s public.motion_storage_health; today date:=(now() at time zone 'UTC')::date; n integer:=greatest(1,least(10,p_count));
begin
 select * into s from public.motion_storage_health where id=true for update;
 if s.counter_day<>today then s.counter_day:=today;s.managed_reads:=0;end if;
 if s.managed_reads+n>s.daily_read_budget then
  update public.motion_storage_health set phase='blocked',reason='preventive_budget',
   last_error='Orçamento preventivo de leituras monitoradas atingido.',counter_day=today,
   next_probe_at=((today+1)::timestamp at time zone 'UTC'),probe_owner=null,probe_until=null,updated_at=now() where id=true;
  perform public.motion_storage_notify('budget','Motion pausado por proteção','A fila foi preservada. O orçamento preventivo de leituras monitoradas chegou ao limite; retomada automática após a renovação diária.');
  return false;
 end if;
 update public.motion_storage_health set counter_day=today,managed_reads=s.managed_reads+n,updated_at=now() where id=true;
 if s.managed_reads<floor(s.daily_read_budget*.75) and s.managed_reads+n>=floor(s.daily_read_budget*.75) then
  perform public.motion_storage_notify('early','Atenção ao armazenamento do Motion','O Cloudent atingiu 75% do orçamento preventivo de leituras monitoradas. Esta é uma estimativa local, não o consumo total da conta Backblaze.');
 end if;
 return true;
end; $$;

create or replace function public.motion_storage_finish_probe(p_owner text,p_ok boolean,p_reason text default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s public.motion_storage_health; was_blocked boolean;
begin
 select * into s from public.motion_storage_health where id=true for update;
 if s.probe_owner is distinct from p_owner then return to_jsonb(s)||jsonb_build_object('allow_primary',s.phase='healthy' and s.next_probe_at>now());end if;
 was_blocked:=s.phase<>'healthy';
 update public.motion_storage_health set phase=case when p_ok then 'healthy' else 'blocked' end,
 reason=case when p_ok then null else coalesce(p_reason,'storage_unavailable') end,
 last_error=case when p_ok then null else left(coalesce(p_error,'Armazenamento indisponível'),240) end,
 checked_at=now(),next_probe_at=now()+interval '5 minutes',probe_owner=null,probe_until=null,updated_at=now()
 where id=true returning * into s;
 if p_ok and was_blocked then
  perform public.motion_storage_notify('resumed','Motion retomado','A leitura do armazenamento voltou a funcionar. A fila do Motion será retomada automaticamente.','info');
 elsif not p_ok then
  perform public.motion_storage_notify('blocked','Armazenamento do Motion protegido','O armazenamento principal bloqueou leituras. Novas gerações foram pausadas, a fila foi preservada e a recuperação será verificada automaticamente.');
 end if;
 return to_jsonb(s)||jsonb_build_object('allow_primary',p_ok,'just_recovered',p_ok and was_blocked);
end; $$;

create or replace function public.motion_storage_block(p_reason text,p_error text)
returns void language plpgsql security invoker set search_path=public as $$
begin
 update public.motion_storage_health set phase='blocked',reason=p_reason,last_error=left(p_error,240),checked_at=now(),
 next_probe_at=now()+interval '5 minutes',probe_owner=null,probe_until=null,updated_at=now() where id=true;
 perform public.motion_storage_notify('blocked','Armazenamento do Motion protegido','O armazenamento principal bloqueou leituras. A fila foi preservada e a retomada será automática.');
end; $$;

create or replace function public.motion_storage_reserve(p_job_id uuid,p_user_id uuid,p_input_bytes bigint default 0,p_output_bytes bigint default 41943040)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare used bigint; reserved bigint; needed bigint; current public.motion_storage_reservations; r record;
begin
 perform pg_advisory_xact_lock(hashtext('motion-storage-reserve'));
 if p_input_bytes<0 or p_input_bytes>12582912 or p_output_bytes<1 or p_output_bytes>41943040 then raise exception 'Reserva aceita entradas até 12 MB e resultado até 40 MB.';end if;
 -- Only abandon a ticket when no job exists and its hour-long upload lease expired.
 for r in select * from public.motion_storage_reservations x where x.state='held' and x.expires_at<now() and not exists(select 1 from public.production_jobs j where j.id=x.job_id) loop
  select coalesce(sum((metadata->>'size')::bigint),0) into needed from storage.objects where bucket_id='production' and name like r.input_prefix||'%';
  update public.motion_storage_reservations set state=case when needed>0 then 'committed' else 'released' end,allocated_bytes=greatest(1,needed),updated_at=now() where job_id=r.job_id;
 end loop;
 -- Reclaim accounting only after the corresponding objects were actually removed by normal cleanup.
 for r in select * from public.motion_storage_reservations where state='committed' loop
  select coalesce(sum((metadata->>'size')::bigint),0) into needed from storage.objects
  where (bucket_id='production' and name like r.input_prefix||'%') or (bucket_id='videos' and name=r.result_path);
  update public.motion_storage_reservations set allocated_bytes=greatest(1,needed),state=case when needed=0 then 'released' else 'committed' end where job_id=r.job_id;
 end loop;
 select * into current from public.motion_storage_reservations where job_id=p_job_id for update;
 if found and current.user_id<>p_user_id then raise exception 'Reserva de outro usuário.';end if;
 needed:=p_input_bytes+p_output_bytes+1048576;
 if current.job_id is not null and current.state='held' then needed:=greatest(needed,current.allocated_bytes);end if;
 select coalesce(sum((metadata->>'size')::bigint),0) into used from storage.objects;
 select coalesce(sum(allocated_bytes),0) into reserved from public.motion_storage_reservations where state<>'released' and job_id<>p_job_id;
 if reserved+needed>167772160 or used+reserved+needed>838860800 then
  perform public.motion_storage_notify('reserve-full','Reserva do Motion próxima do limite','A reserva não pode receber mais arquivos sem ultrapassar o teto de segurança. A fila foi preservada.');
  return jsonb_build_object('ok',false,'used_bytes',used,'allocated_bytes',reserved,'budget_bytes',167772160,'total_ceiling_bytes',838860800);
 end if;
 insert into public.motion_storage_reservations(job_id,user_id,input_bytes,allocated_bytes,input_prefix)
 values(p_job_id,p_user_id,p_input_bytes,needed,p_user_id||'/motion-control-reserve/'||p_job_id||'/')
 on conflict(job_id) do update set input_bytes=greatest(motion_storage_reservations.input_bytes,excluded.input_bytes),allocated_bytes=excluded.allocated_bytes,
 state='held',expires_at=now()+interval '1 hour',updated_at=now();
 return jsonb_build_object('ok',true,'allocated_bytes',needed,'budget_bytes',167772160,'total_ceiling_bytes',838860800);
end; $$;

create or replace function public.motion_storage_commit(p_job_id uuid,p_result_path text,p_result_bytes bigint)
returns void language plpgsql security invoker set search_path=public as $$
declare r public.motion_storage_reservations; actual bigint;
begin
 select * into r from public.motion_storage_reservations where job_id=p_job_id for update;
 if not found or p_result_bytes<1 or p_result_bytes>41943040 or p_result_path not like r.user_id||'/production-results/%' then raise exception 'Resultado fora da reserva.';end if;
 select coalesce(sum((metadata->>'size')::bigint),0) into actual from storage.objects where bucket_id='production' and name like r.input_prefix||'%';
 update public.motion_storage_reservations set state='committed',result_path=p_result_path,allocated_bytes=actual+p_result_bytes,updated_at=now() where job_id=p_job_id;
end; $$;

create or replace function public.motion_storage_status()
returns jsonb language sql security invoker set search_path=public as $$
 select jsonb_build_object('phase',s.phase,'reason',s.reason,'message',s.last_error,'checked_at',s.checked_at,'next_probe_at',s.next_probe_at,
 'managed_reads',s.managed_reads,'daily_read_budget',s.daily_read_budget,'usage_is_estimate',true,
 'reserve_budget_bytes',167772160,'reserve_input_max_bytes',12582912,'reserve_output_max_bytes',41943040,
 'reserve_allocated_bytes',(select coalesce(sum(allocated_bytes),0) from public.motion_storage_reservations where state<>'released'),
 'supabase_used_bytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects),'supabase_ceiling_bytes',838860800)
 from public.motion_storage_health s where id=true;
$$;

create or replace function public.release_motion_storage_claim(p_job_id uuid,p_worker text)
returns void language sql security invoker set search_path=public as $$
 update public.production_jobs set status='motion_waiting',attempt_count=greatest(0,attempt_count-1),progress=0,started_at=null,
 locked_at=null,locked_by=null,last_error=null,next_attempt_at=now()+interval '1 minute',updated_at=now()
 where id=p_job_id and locked_by=p_worker and runninghub_task_id is null and meta->>'workflow_key'='motion_control';
$$;

revoke all on function public.motion_storage_notify(text,text,text,text),public.motion_storage_claim_probe(text),public.motion_storage_record_read(integer),public.motion_storage_finish_probe(text,boolean,text,text),public.motion_storage_block(text,text),public.motion_storage_reserve(uuid,uuid,bigint,bigint),public.motion_storage_commit(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.motion_storage_notify(text,text,text,text),public.motion_storage_claim_probe(text),public.motion_storage_record_read(integer),public.motion_storage_finish_probe(text,boolean,text,text),public.motion_storage_block(text,text),public.motion_storage_reserve(uuid,uuid,bigint,bigint),public.motion_storage_commit(uuid,text,bigint) to service_role;
revoke all on function public.motion_storage_status(),public.release_motion_storage_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.motion_storage_status(),public.release_motion_storage_claim(uuid,text) to service_role;
