create or replace function public.claim_x_upload_post(p_user_id uuid,p_worker_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.x_publish_configs; p public.x_drive_posts;
begin
 perform pg_advisory_xact_lock(hashtextextended('x-publish:'||p_user_id::text,0));
 select * into c from public.x_publish_configs where user_id=p_user_id for update;
 if not found or not c.enabled or (c.next_publish_at is not null and c.next_publish_at>now()) then return null; end if;
 if exists(select 1 from public.x_drive_posts where user_id=p_user_id and status='processing') then return null; end if;
 select * into p from public.x_drive_posts where user_id=p_user_id and status='queued'
 order by created_at,id limit 1 for update;
 if not found or p.next_attempt_at>now() then return null; end if;
 update public.x_drive_posts set status='processing',attempts=attempts+1,locked_at=now(),locked_by=p_worker_id,last_error=null,updated_at=now() where id=p.id returning * into p;
 return to_jsonb(p);
end $$;
revoke all on function public.claim_x_upload_post(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_x_upload_post(uuid,text) to service_role;

create or replace function public.complete_x_upload_post(p_id uuid,p_worker_id text,p_account_id uuid,p_text text,p_media_id text,p_post_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid;
begin
 update public.x_drive_posts set status='published',platform_account_id=p_account_id,post_text=p_text,x_media_id=p_media_id,x_post_id=p_post_id,published_at=now(),locked_at=null,locked_by=null,last_error=null,meta=meta||'{"publish_uncertain":false}'::jsonb,updated_at=now()
 where id=p_id and status='processing' and locked_by=p_worker_id returning user_id into u;
 if not found then raise exception 'publication_claim_lost'; end if;
 update public.x_publish_configs set platform_account_id=p_account_id,next_publish_at=now()+make_interval(mins=>interval_minutes),last_worker_at=now(),last_error=null,updated_at=now() where user_id=u;
end $$;
revoke all on function public.complete_x_upload_post(uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_x_upload_post(uuid,text,uuid,text,text,text) to service_role;
create or replace function public.release_stale_x_drive_posts()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 update public.x_drive_posts set status=case when coalesce((meta->>'publish_request_started')::boolean,false) then 'failed' else 'queued' end,
 meta=meta||jsonb_build_object('publish_uncertain',coalesce((meta->>'publish_request_started')::boolean,false)),
 locked_at=null,locked_by=null,last_error=case when coalesce((meta->>'publish_request_started')::boolean,false) then 'Envio interrompido após iniciar a publicação. Confira a conta X antes de repetir.' else 'worker_interrupted' end,updated_at=now()
 where status='processing' and locked_at<now()-interval '15 minutes' and x_post_id is null;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.release_stale_x_drive_posts() from public,anon,authenticated;
grant execute on function public.release_stale_x_drive_posts() to service_role;
do $$ declare j record;begin
 for j in select jobid,jobname from cron.job where jobname in ('cloudentflow-x-warmup-worker','cloudentflow-x-drive-publisher') loop
 if j.jobname='cloudentflow-x-warmup-worker' then perform cron.alter_job(j.jobid,active:=false);
 else perform cron.alter_job(j.jobid,schedule:='* * * * *');end if;
 end loop;
end $$;