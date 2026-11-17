-- Keep captions reusable and preserve existing reserved/used history.
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
 select * into p from public.x_drive_posts where platform_account_id=p_account and status='queued' and x_post_id is null and published_at is null
 and not coalesce((meta->>'publish_uncertain')::boolean,false) and attempts<max_attempts
 and (nullif(btrim(post_text),'') is not null or meta->'allow_empty_caption' = 'true'::jsonb or exists(select 1 from public.x_caption_queue q where q.platform_account_id=p_account and q.user_id=x_drive_posts.user_id and q.workspace_id=x_drive_posts.workspace_id and q.status<>'removed'))
 and public.cloudent_x_access(user_id,p_account) and next_attempt_at<=now()
 -- Gallery uploads are drafts until explicitly scheduled, even with a pending caption.
 and (scheduled_at<=now() or (scheduled_at is null and meta->'gallery' is distinct from 'true'::jsonb and coalesce(c.next_publish_at,now())<=now()))
 order by scheduled_at nulls last,created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 if nullif(btrim(p.post_text),'') is null and p.meta->'allow_empty_caption' is distinct from 'true'::jsonb then
 select * into caption_row from public.x_caption_queue where platform_account_id=p_account and user_id=p.user_id and workspace_id=p.workspace_id and status<>'removed' order by used_at nulls first,created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update public.x_caption_queue set used_at=now() where id=caption_row.id;
 update public.x_drive_posts set post_text=caption_row.caption,meta=meta||jsonb_build_object('caption_queue_id',caption_row.id) where id=p.id;
 end if;
 update public.x_drive_posts set status='processing',attempts=attempts+1,locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=p.id returning * into p;
 return to_jsonb(p);
end $function$;

CREATE OR REPLACE FUNCTION public.schedule_x_gallery_shuffle(p_user uuid, p_account uuid, p_workspace uuid, p_from date, p_until date)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  slots timestamptz[];
  posts uuid[];
  captions uuid[];
  caption_id uuid;
  replies jsonb;
  total integer;
  i integer;
begin
  if p_from is null or p_until is null or p_until <= p_from or p_until - p_from > 31 then
    raise exception 'Período inválido.';
  end if;
  if not public.cloudent_x_access(p_user,p_account) or not exists (
    select 1 from public.platform_accounts a where a.id=p_account and a.workspace_id=p_workspace
      and a.platform='x' and a.enabled and a.config->>'status'='connected'
  ) then raise exception 'Conta indisponível.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('x-account:'||p_account::text,0));

  select array(
    select slot from (
      select distinct (((p_from+n)+t::time) at time zone 'America/Sao_Paulo') as slot
      from generate_series(0,p_until-p_from-1) n
      cross join unnest(coalesce((select daily_slots from public.x_account_configs
        where platform_account_id=p_account),array['12:00','18:00']::text[])) t
    ) times
    where slot>now() and not exists (
      select 1 from public.x_drive_posts p where p.platform_account_id=p_account and p.scheduled_at=slot
        and p.status in ('queued','processing','failed','published')
    ) order by slot
  ) into slots;
  if cardinality(slots)=0 then return 0; end if;

  select array(
    select p.id from public.x_drive_posts p where p.user_id=p_user and p.workspace_id=p_workspace
      and p.platform_account_id=p_account and p.scheduled_at is null and p.status='queued'
      and p.x_post_id is null and p.published_at is null and p.meta->'gallery'='true'::jsonb
      and p.meta->'publish_uncertain' is distinct from 'true'::jsonb
      and p.meta->>'caption_queue_id' is null
    order by random() limit cardinality(slots) for update skip locked
  ) into posts;
  select array(
    select c.id from public.x_caption_queue c where c.user_id=p_user and c.workspace_id=p_workspace
      and c.platform_account_id=p_account and c.status<>'removed'
    order by random() limit cardinality(posts) for update skip locked
  ) into captions;
  select value into replies from public.app_settings where key='x_fixed_replies:'||p_workspace::text||':'||p_user::text;
  if cardinality(captions)=0 then return 0; end if;
  total:=cardinality(posts);
  for i in 1..total loop
    caption_id:=captions[1+((i-1)%cardinality(captions))];
    update public.x_drive_posts p set scheduled_at=slots[i],next_attempt_at=slots[i],updated_at=now(),
      post_text=c.caption,reply_text=coalesce(nullif(btrim(p.reply_text),''),(
        select reply from jsonb_array_elements_text(coalesce(replies,'[]'::jsonb)) reply order by random() limit 1
      )),meta=coalesce(p.meta,'{}'::jsonb)||jsonb_build_object('caption_queue_id',c.id,'allow_empty_caption',false)
    from public.x_caption_queue c where p.id=posts[i] and c.id=caption_id;
    update public.x_caption_queue set used_at=now() where id=caption_id;
  end loop;
  return total;
end
$function$;
