create or replace function public.schedule_x_gallery_shuffle(
  p_user uuid, p_account uuid, p_workspace uuid, p_from date, p_until date
) returns integer
language plpgsql set search_path = ''
as $function$
declare
  slots timestamptz[];
  posts uuid[];
  captions uuid[];
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
      and p.x_post_id is null and p.meta->'gallery'='true'::jsonb
      and p.meta->'publish_uncertain' is distinct from 'true'::jsonb
      and p.meta->>'caption_queue_id' is null
    order by random() limit cardinality(slots) for update skip locked
  ) into posts;
  select array(
    select c.id from public.x_caption_queue c where c.user_id=p_user and c.workspace_id=p_workspace
      and c.platform_account_id=p_account and c.status='pending'
    order by random() limit cardinality(posts) for update skip locked
  ) into captions;
  select value into replies from public.app_settings where key='x_fixed_replies:'||p_workspace::text||':'||p_user::text;
  total:=least(cardinality(posts),cardinality(captions));
  for i in 1..total loop
    update public.x_drive_posts p set scheduled_at=slots[i],next_attempt_at=slots[i],updated_at=now(),
      post_text=c.caption,reply_text=coalesce(nullif(btrim(p.reply_text),''),(
        select reply from jsonb_array_elements_text(coalesce(replies,'[]'::jsonb)) reply order by random() limit 1
      )),meta=coalesce(p.meta,'{}'::jsonb)||jsonb_build_object('caption_queue_id',c.id,'allow_empty_caption',false)
    from public.x_caption_queue c where p.id=posts[i] and c.id=captions[i];
    update public.x_caption_queue set status='reserved',post_id=posts[i] where id=captions[i];
  end loop;
  return total;
end
$function$;

revoke all on function public.schedule_x_gallery_shuffle(uuid,uuid,uuid,date,date) from public, anon, authenticated;
grant execute on function public.schedule_x_gallery_shuffle(uuid,uuid,uuid,date,date) to service_role;
