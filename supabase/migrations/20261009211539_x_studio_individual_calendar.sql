alter table public.x_drive_posts add column if not exists scheduled_at timestamptz;
alter table public.x_publish_configs add column if not exists daily_slots text[] not null default array['12:00','18:00'];
create index if not exists x_posts_calendar_lookup on public.x_drive_posts(user_id,scheduled_at) where scheduled_at is not null;
create unique index if not exists x_posts_reserved_slot on public.x_drive_posts(user_id,scheduled_at) where scheduled_at is not null and status in ('queued','processing','failed');

create or replace function public.claim_x_upload_post(p_user_id uuid,p_worker_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.x_publish_configs; p public.x_drive_posts;
begin
 perform pg_advisory_xact_lock(hashtextextended('x-publish:'||p_user_id::text,0));
 select * into c from public.x_publish_configs where user_id=p_user_id for update;
 if not found or not c.enabled then return null; end if;
 if exists(select 1 from public.x_drive_posts where user_id=p_user_id and status='processing') then return null; end if;
 -- Explicit calendar posts take priority when due, independently of the FIFO interval.
 select * into p from public.x_drive_posts
 where user_id=p_user_id and status='queued' and scheduled_at<=now()
 and coalesce(next_attempt_at,scheduled_at)<=now()
 order by scheduled_at,created_at,id limit 1 for update;
 if not found then
   if c.next_publish_at is not null and c.next_publish_at>now() then return null; end if;
   select * into p from public.x_drive_posts where user_id=p_user_id and status='queued' and scheduled_at is null
   order by created_at,id limit 1 for update;
   if not found or p.next_attempt_at>now() then return null; end if;
 end if;
 update public.x_drive_posts set status='processing',attempts=attempts+1,locked_at=now(),locked_by=p_worker_id,last_error=null,updated_at=now()
 where id=p.id returning * into p;
 return to_jsonb(p);
end $$;
revoke all on function public.claim_x_upload_post(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_x_upload_post(uuid,text) to service_role;

create or replace function public.complete_x_upload_post(p_id uuid,p_worker_id text,p_account_id uuid,p_text text,p_media_id text,p_post_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid; scheduled timestamptz;
begin
 update public.x_drive_posts set status='published',platform_account_id=p_account_id,post_text=p_text,x_media_id=p_media_id,x_post_id=p_post_id,published_at=now(),
 locked_at=null,locked_by=null,last_error=null,meta=meta||'{"publish_uncertain":false}'::jsonb,updated_at=now()
 where id=p_id and status='processing' and locked_by=p_worker_id returning user_id,scheduled_at into u,scheduled;
 if not found then raise exception 'publication_claim_lost'; end if;
 update public.x_publish_configs set platform_account_id=p_account_id,
 next_publish_at=case when scheduled is null then now()+make_interval(mins=>interval_minutes) else next_publish_at end,
 last_worker_at=now(),last_error=null,updated_at=now() where user_id=u;
end $$;
revoke all on function public.complete_x_upload_post(uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_x_upload_post(uuid,text,uuid,text,text,text) to service_role;
