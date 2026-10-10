-- CloudentFlow Notifications Patch 1.0. All generation RPCs are service-only.
create table public.instagram_story_monitor (
 account_id uuid primary key references public.platform_accounts(id) on delete cascade,
 status text not null default 'unknown' check(status in ('unknown','active','empty')),
 last_known_status text not null default 'unknown', active_count integer,
 checked_at timestamptz, next_check_at timestamptz not null default now(),
 empty_since timestamptz, last_error text, updated_at timestamptz not null default now()
);
alter table public.instagram_story_monitor enable row level security;
revoke all on public.instagram_story_monitor from anon, authenticated;
grant all on public.instagram_story_monitor to service_role;

create or replace function public.notification_account_owner(p_account uuid)
returns uuid language sql stable security definer set search_path=public,pg_temp as $$
 select m.user_id from platform_accounts a join app_members m on m.enabled and (
  (a.config->>'owner_user_id'=m.user_id::text) or
  (nullif(a.config->>'owner_user_id','') is null and m.role='admin' and
   (select count(*) from app_members where enabled and role='admin')=1)
 ) where a.id=p_account limit 1
$$;

create or replace function public.claim_story_monitor_accounts(p_limit integer default 10)
returns table(account_id uuid,external_account_id text,account_label text,auth_mode text)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into instagram_story_monitor(account_id)
 select id from platform_accounts where enabled and platform='instagram'
 and notification_account_owner(id) is not null on conflict do nothing;
 return query with picked as (
 select m.account_id from instagram_story_monitor m join platform_accounts a on a.id=m.account_id
 where a.enabled and a.platform='instagram' and m.next_check_at<=now()
 and notification_account_owner(a.id) is not null
 order by m.next_check_at for update of m skip locked limit greatest(1,least(p_limit,10))
 ), claimed as (
 update instagram_story_monitor m set next_check_at=now()+interval '15 minutes',updated_at=now()
 from picked p where m.account_id=p.account_id returning m.account_id
 ) select a.id,a.external_account_id,a.account_label,coalesce(a.config->>'auth_mode','instagram_login')
 from claimed c join platform_accounts a on a.id=c.account_id;
end $$;

create or replace function public.record_story_monitor_result(p_account uuid,p_count integer,p_error text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare m instagram_story_monitor; u uuid; label text; episode timestamptz;
begin
 select * into m from instagram_story_monitor where account_id=p_account for update;
 if not found then return; end if;
 u:=notification_account_owner(p_account);
 select account_label into label from platform_accounts where id=p_account;
 if p_error is not null or p_count is null or p_count<0 then
 update instagram_story_monitor set status='unknown',active_count=null,checked_at=now(),
 last_error=left(coalesce(p_error,'Resposta inválida ao consultar Stories'),700),updated_at=now() where account_id=p_account;
 if u is not null then
 insert into system_notifications(user_id,severity,category,title,body,source_ref,dedupe_key,meta)
 values(u,'error','stories_access','Não foi possível verificar os Stories',
 '@'||coalesce(label,'Instagram')||': '||left(coalesce(p_error,'Resposta inválida'),500),p_account::text,
 'stories-access:'||p_account||':'||to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'),jsonb_build_object('account_id',p_account))
 on conflict(dedupe_key) do nothing;
 end if;
 return;
 end if;
 episode:=case when p_count=0 then coalesce(m.empty_since,now()) else null end;
 update instagram_story_monitor set status=case when p_count=0 then 'empty' else 'active' end,
 last_known_status=case when p_count=0 then 'empty' else 'active' end,active_count=p_count,
 empty_since=episode,checked_at=now(),last_error=null,updated_at=now() where account_id=p_account;
 if p_count=0 and m.last_known_status<>'empty' and u is not null then
 insert into system_notifications(user_id,severity,category,title,body,source_ref,dedupe_key,meta)
 values(u,'warn','stories_empty','Conta sem Stories ativos','@'||coalesce(label,'Instagram')||' está sem Stories ativos. Hora de publicar um novo Story.',
 p_account::text,'stories-empty:'||p_account||':'||episode::text,jsonb_build_object('account_id',p_account,'empty_since',episode))
 on conflict(dedupe_key) do nothing;
 end if;
end $$;

create or replace function public.generate_cloudent_patch_notifications(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare u record; w record; day date:=(p_now at time zone 'America/Sao_Paulo')::date;
 start_at timestamptz; end_at timestamptz; accounts jsonb; total integer; detail text; added integer:=0; n integer; issue text;
begin
 start_at:=day::timestamp at time zone 'America/Sao_Paulo';
 end_at:=(day+1)::timestamp at time zone 'America/Sao_Paulo';
 for u in select user_id,role from app_members where enabled loop
 if (p_now at time zone 'America/Sao_Paulo')::time >= time '06:00' then
 with counts as (
 select a.id,a.platform,a.account_label,
 (select count(*) from schedules s where a.platform='instagram' and s.platform_account_id=a.id and s.scheduled_at>=start_at and s.scheduled_at<end_at and s.status<>'cancelled') +
 (select count(*) from reel_test_publications t where a.platform='instagram' and t.user_id=u.user_id and t.linked_schedule_id is null
 and t.scheduled_at>=start_at and t.scheduled_at<end_at and t.status<>'cancelled'
 and coalesce(t.meta->>'platform_account_id',t.meta->>'account_id')=a.id::text) +
 (select count(*) from x_drive_posts x where a.platform='x' and x.platform_account_id=a.id and x.user_id=u.user_id
 and x.scheduled_at>=start_at and x.scheduled_at<end_at and x.status<>'cancelled') as posts
 from platform_accounts a where a.enabled and notification_account_owner(a.id)=u.user_id
 union all
 select null::uuid,'instagram','Reels teste (sem conta definida)',count(*) from reel_test_publications t
 where t.user_id=u.user_id and t.linked_schedule_id is null and t.scheduled_at>=start_at and t.scheduled_at<end_at
 and t.status<>'cancelled' and coalesce(t.meta->>'platform_account_id',t.meta->>'account_id') is null having count(*)>0
 ) select coalesce(jsonb_agg(jsonb_build_object('account_id',id,'platform',platform,'account',account_label,'posts',posts) order by platform,account_label),'[]'),
 coalesce(sum(posts),0)::integer,string_agg('@'||account_label||': '||posts,' · ' order by platform,account_label) into accounts,total,detail from counts;
 insert into system_notifications(user_id,severity,category,title,body,source_ref,dedupe_key,meta)
 values(u.user_id,'info','daily_summary','Programação de hoje: '||total||' posts',
 to_char(day,'DD/MM')||' · '||coalesce(detail,'Nenhum post com horário marcado para hoje.'),day::text,
 'daily-summary:'||u.user_id||':'||day,jsonb_build_object('date',day,'timezone','America/Sao_Paulo','total',total,'accounts',accounts,'generated_at',p_now))
 on conflict(dedupe_key) do nothing;
 get diagnostics n=row_count; added:=added+n;
 end if;
 if u.role='admin' then
 for w in select r.* from worker_runtime r join (values
 ('instagram_publish','cloudentflow-publish-worker',5),('trial_reels','cloudentflow-publish-worker',5),('automation','cloudentflow-automation-worker',15),
 ('followers','cloudentflow-follower-worker',15),('media_cleaner','cloudentflow-media-cleaner-worker',5),
 ('production','cloudentflow-production-worker',5),('x_drive_publisher','cloudentflow-x-drive-publisher',5),
 ('notifications','cloudentflow-notification-worker',5)
 ) cfg(worker,job,minutes) on r.worker_name=cfg.worker
 join cron.job j on j.jobname=cfg.job and j.active
 where nullif(r.last_error,'') is not null or r.last_heartbeat is null or r.last_heartbeat<p_now-make_interval(mins=>cfg.minutes)
 loop
 issue:=case when nullif(w.last_error,'') is not null then left(w.last_error,650) else 'Sem sinal de funcionamento no intervalo esperado.' end;
 insert into system_notifications(user_id,severity,category,title,body,source_ref,dedupe_key,meta)
 values(u.user_id,'error','worker_error','Falha detectada no CloudentFlow',w.worker_name||': '||issue,w.worker_name,
 'worker-error:'||u.user_id||':'||w.worker_name||':'||day||':'||md5(issue),jsonb_build_object('worker',w.worker_name,'heartbeat',w.last_heartbeat))
 on conflict(dedupe_key) do nothing;
 get diagnostics n=row_count; added:=added+n;
 end loop;
 end if;
 end loop;
 return added;
end $$;

update app_settings set value=value||jsonb_build_object('version','patch_1.0','errors_only',false,'notify_on_warnings',true,'daily_summary',true,'daily_summary_time','06:00','timezone','America/Sao_Paulo','stories_monitor',true,'stories_check_minutes',15),updated_at=now() where key='push_notifications';

revoke all on function public.notification_account_owner(uuid),public.claim_story_monitor_accounts(integer),public.record_story_monitor_result(uuid,integer,text),public.generate_cloudent_patch_notifications(timestamptz) from public,anon,authenticated;
grant execute on function public.notification_account_owner(uuid),public.claim_story_monitor_accounts(integer),public.record_story_monitor_result(uuid,integer,text),public.generate_cloudent_patch_notifications(timestamptz) to service_role;
CREATE OR REPLACE FUNCTION public.enqueue_activity_problem_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid;
  v_ref text;
  v_title text;
  v_category text;
  v_key text;
  v_user_count integer;
  v_body text;
  v_name text;
  v_when timestamptz;
  v_attempt integer;
  v_max_attempts integer;
  v_account text;
  v_day integer;
  v_action text;
  v_method text;
begin
  if new.level <> 'error' then return new; end if;

  begin
    if coalesce(new.meta->>'user_id','') <> '' then
      v_user := (new.meta->>'user_id')::uuid;
    end if;
  exception when others then v_user := null;
  end;

  v_ref := coalesce(
    new.meta->>'trial_publication_id',
    new.meta->>'schedule_id',
    new.meta->>'production_job_id',
    new.meta->>'warmup_account_id',
    new.meta->>'action_id',
    new.meta->>'publication_id'
  );

  begin
    if v_user is null and coalesce(new.meta->>'trial_publication_id','') <> '' then
      select user_id into v_user from public.reel_test_publications
      where id=(new.meta->>'trial_publication_id')::uuid;
    end if;
  exception when others then null;
  end;

  begin
    if v_user is null and coalesce(new.meta->>'production_job_id','') <> '' then
      select user_id into v_user from public.production_jobs
      where id=(new.meta->>'production_job_id')::uuid;
    end if;
  exception when others then null;
  end;

  begin
    if v_user is null and coalesce(new.meta->>'warmup_account_id','') <> '' then
      select user_id into v_user from public.x_warmup_accounts
      where id=(new.meta->>'warmup_account_id')::uuid;
    end if;
  exception when others then null;
  end;

  if v_user is null then
    select count(*),(array_agg(user_id order by created_at))[1] into v_user_count,v_user from public.app_members where enabled and role='admin';
    if v_user_count <> 1 then return new; end if;
  end if;

  if not exists(select 1 from public.app_members where user_id=v_user and enabled) then return new; end if;

  v_category := case
    when new.event_type like 'trial_%' then 'trial'
    when new.event_type like 'production_%' then 'production'
    when new.event_type like 'x_warmup_%' then 'x'
    when new.event_type like '%publish%' then 'publication'
    when new.event_type like 'backend_%' then 'backend'
    else 'system'
  end;

  v_title := case v_category
    when 'trial' then 'Reel teste deu erro'
    when 'production' then 'Produção IA deu erro'
    when 'x' then 'X deu erro'
    when 'publication' then 'Publicação deu erro'
    when 'backend' then 'Backend deu erro'
    else 'CloudentFlow deu erro'
  end;

  v_body := left(coalesce(new.message,'Erro sem descrição.'),650);

  if v_category='trial' and coalesce(new.meta->>'trial_publication_id','') <> '' then
    begin
      select coalesce(nullif(file_name,''),'Reel teste'),scheduled_at,attempt_count,max_attempts
      into v_name,v_when,v_attempt,v_max_attempts
      from public.reel_test_publications
      where id=(new.meta->>'trial_publication_id')::uuid;

      v_attempt := coalesce(nullif(new.meta->>'attempt','')::integer,v_attempt);
      v_body :=
        left(coalesce(v_name,'Reel teste'),45) ||
        case when v_when is not null then ' · '||to_char(v_when at time zone 'America/Recife','HH24:MI') else '' end ||
        case when v_attempt is not null then ' · tentativa '||v_attempt||case when v_max_attempts is not null then '/'||v_max_attempts else '' end else '' end ||
        '. ' || left(coalesce(new.message,'Erro sem descrição.'),360);
    exception when others then null;
    end;
  end if;

  if v_category='production' and coalesce(new.meta->>'production_job_id','') <> '' then
    begin
      select coalesce(nullif(original_file_name,''),'Job'),attempt_count,max_attempts
      into v_name,v_attempt,v_max_attempts
      from public.production_jobs
      where id=(new.meta->>'production_job_id')::uuid;

      v_attempt := coalesce(nullif(new.meta->>'attempt','')::integer,v_attempt);
      v_body :=
        left(coalesce(v_name,'Job'),45) ||
        case when v_attempt is not null then ' · tentativa '||v_attempt||case when v_max_attempts is not null then '/'||v_max_attempts else '' end else '' end ||
        '. ' || left(coalesce(new.message,'Erro sem descrição.'),360);
    exception when others then null;
    end;
  end if;

  if v_category='publication' and coalesce(new.meta->>'schedule_id','') <> '' then
    begin
      select coalesce(nullif(v.file_name,''),'Vídeo'),s.scheduled_at,s.attempt_count
      into v_name,v_when,v_attempt
      from public.schedules s
      join public.videos v on v.id=s.video_id
      where s.id=(new.meta->>'schedule_id')::uuid;

      v_attempt := coalesce(nullif(new.meta->>'attempt','')::integer,v_attempt);
      v_body :=
        left(coalesce(v_name,'Vídeo'),45) ||
        case when v_when is not null then ' · '||to_char(v_when at time zone 'America/Recife','HH24:MI') else '' end ||
        case when v_attempt is not null then ' · tentativa '||v_attempt else '' end ||
        '. ' || left(coalesce(new.message,'Erro sem descrição.'),360);
    exception when others then null;
    end;
  end if;

  if v_category='x' then
    begin
      if coalesce(new.meta->>'warmup_account_id','') <> '' then
        select coalesce(nullif(username,''),nullif(label,''),'Conta X'),current_day
        into v_account,v_day
        from public.x_warmup_accounts
        where id=(new.meta->>'warmup_account_id')::uuid;
      end if;
      if coalesce(new.meta->>'action_id','') <> '' then
        select action_type into v_action
        from public.x_warmup_actions
        where id=(new.meta->>'action_id')::uuid;
      end if;

      v_body :=
        case when v_account is not null then '@'||replace(v_account,'@','') else 'Conta X' end ||
        case when v_day is not null then ' · dia '||v_day else '' end ||
        case when v_action is not null then ' · '||v_action else '' end ||
        '. ' || left(coalesce(new.message,'Erro sem descrição.'),360);
    exception when others then null;
    end;
  end if;

  if v_category='backend' then
    v_method := upper(coalesce(new.meta->>'method','REQUISIÇÃO'));
    v_body := v_method || '. ' || left(coalesce(new.message,'Erro sem descrição.'),420);
  end if;

  v_key := md5(
    coalesce(new.event_type,'')||':'||
    coalesce(v_ref,'')||':'||
    coalesce(new.message,'')||':'||
    to_char(new.created_at at time zone 'UTC','YYYY-MM-DD')
  );

  insert into public.system_notifications(
    user_id,severity,category,title,body,source_event_id,source_event_type,source_ref,dedupe_key,meta
  )
  values(
    v_user,'error',v_category,v_title,left(v_body,850),new.id,new.event_type,v_ref,v_key,
    jsonb_build_object('activity_log_id',new.id,'source_meta',new.meta)
  )
  on conflict(dedupe_key) do update
  set updated_at=now(),
      body=excluded.body,
      title=excluded.title,
      meta=coalesce(public.system_notifications.meta,'{}'::jsonb)||
        jsonb_build_object('last_activity_log_id',new.id,'last_seen_at',now());

  return new;
exception when others then
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_due_system_notifications(p_worker text, p_limit integer DEFAULT 20)
 RETURNS SETOF system_notifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.system_notifications set status='pending',next_attempt_at=now(),updated_at=now() where status='processing' and updated_at<now()-interval '10 minutes';
  update public.system_notifications set status='failed',last_error='daily_summary_expired',updated_at=now() where status='pending' and category='daily_summary' and (meta->>'date')::date<(now() at time zone 'America/Sao_Paulo')::date;
  return query
  with picked as (
    select n.id
    from public.system_notifications n
    where n.status='pending'
      and n.severity in ('info','warn','error')
      and exists(select 1 from public.app_members m where m.user_id=n.user_id and m.enabled)
      and coalesce((select (value->>'enabled')::boolean from public.app_settings where key='push_notifications'),false)
      and coalesce(n.next_attempt_at,n.created_at) <= now()
      and exists (
        select 1 from public.push_subscriptions s
        where s.user_id=n.user_id and s.enabled=true
      )
    order by n.created_at
    for update of n skip locked
    limit greatest(1,least(coalesce(p_limit,20),50))
  ),
  updated as (
    update public.system_notifications n
    set status='processing',
        push_attempts=n.push_attempts+1,
        updated_at=now(),
        meta=coalesce(n.meta,'{}'::jsonb)||jsonb_build_object('worker_id',p_worker,'claimed_at',now())
    from picked
    where n.id=picked.id
    returning n.*
  )
  select * from updated;
end;
$function$;

