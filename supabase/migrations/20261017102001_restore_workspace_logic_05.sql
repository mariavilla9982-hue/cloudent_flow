set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.enqueue_activity_problem_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION public.enqueue_activity_problem_notification() OWNER TO postgres;
revoke all on function public.enqueue_activity_problem_notification() from public,anon,authenticated; grant execute on function public.enqueue_activity_problem_notification() to service_role;
CREATE OR REPLACE FUNCTION public.ensure_instagram_caption_on_schedule_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.platform='instagram' then
    update public.videos
    set caption=public.pick_instagram_calendar_caption(),
        updated_at=now()
    where id=new.video_id
      and not public.is_instagram_calendar_caption(caption);
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.ensure_instagram_caption_on_schedule_insert() OWNER TO postgres;
revoke all on function public.ensure_instagram_caption_on_schedule_insert() from public,anon,authenticated; grant execute on function public.ensure_instagram_caption_on_schedule_insert() to service_role;

set check_function_bodies=true;
