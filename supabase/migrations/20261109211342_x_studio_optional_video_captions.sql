CREATE OR REPLACE FUNCTION public.claim_x_account_post(p_account uuid, p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.x_account_configs; p public.x_drive_posts; caption_row public.x_caption_queue;
begin
 perform pg_advisory_xact_lock(hashtextextended('x-account:'||p_account::text,0));
 select * into c from public.x_account_configs where platform_account_id=p_account for update;
 if not found or not c.enabled then return null; end if;
 if not exists(select 1 from public.platform_accounts where id=p_account and enabled and config->>'status'='connected') then return null; end if;
 if c.queue_mode='daily_slots' and c.next_publish_at is null then
 update public.x_account_configs set next_publish_at=public.x_next_daily_slot(c.daily_slots,now()-interval '1 minute') where platform_account_id=p_account returning * into c;
 end if;
 if exists(select 1 from public.x_drive_posts where platform_account_id=p_account and status='processing') then return null; end if;
 select * into p from public.x_drive_posts where platform_account_id=p_account and status='queued' and x_post_id is null
 and not coalesce((meta->>'publish_uncertain')::boolean,false) and attempts<max_attempts
 and (nullif(btrim(post_text),'') is not null or meta->'allow_empty_caption' = 'true'::jsonb or exists(select 1 from public.x_caption_queue q where q.platform_account_id=p_account and q.user_id=x_drive_posts.user_id and q.status='pending'))
 and public.cloudent_x_access(user_id,p_account) and next_attempt_at<=now()
 and (scheduled_at<=now() or (scheduled_at is null and coalesce(c.next_publish_at,now())<=now()))
 order by scheduled_at nulls last,created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 if nullif(btrim(p.post_text),'') is null and p.meta->'allow_empty_caption' is distinct from 'true'::jsonb then
 select * into caption_row from public.x_caption_queue where platform_account_id=p_account and user_id=p.user_id and status='pending' order by created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update public.x_caption_queue set status='reserved',post_id=p.id where id=caption_row.id;
 update public.x_drive_posts set post_text=caption_row.caption,meta=meta||jsonb_build_object('caption_queue_id',caption_row.id) where id=p.id;
 end if;
 update public.x_drive_posts set status='processing',attempts=attempts+1,locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=p.id returning * into p;
 return to_jsonb(p);
end $function$;
