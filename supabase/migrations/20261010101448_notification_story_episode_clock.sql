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
 episode:=case when p_count=0 then coalesce(m.empty_since,clock_timestamp()) else null end;
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

