-- Isolated single-publication pilot. No scheduler or account is enabled here.
create table public.instagram_private_pilot (
 id boolean primary key default true check(id),
 user_id uuid not null references auth.users(id),
 phase text not null default 'new' check(phase in ('new','login_pending','two_factor','connected','blocked','publishing','uncertain','published')),
 settings_cipher text,
 lease uuid,
 login_at timestamptz,
 media_id text,
 permalink text,
 error_code text,
 updated_at timestamptz not null default now()
);
alter table public.instagram_private_pilot enable row level security;
revoke all on public.instagram_private_pilot from public,anon,authenticated;
grant all on public.instagram_private_pilot to service_role;

create function public.instagram_private_pilot_control(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.instagram_private_pilot; s public.schedules;
 aid uuid:='7160f95b-a23c-4f28-a5b8-9502a856e091';
 sid uuid:='1024cb8c-025b-4432-b830-ab8697a5d084';
begin
 if u is null or not exists(select 1 from public.app_members where user_id=u and enabled and role='admin')
 or not public.cloudent_auth_session_active(nullif(auth.jwt()->>'session_id','')::uuid,u) then
   raise exception 'forbidden' using errcode='42501';
 end if;
 insert into public.instagram_private_pilot(id,user_id) values(true,u) on conflict do nothing;
 select * into p from public.instagram_private_pilot where id=true for update;
 if p.user_id<>u then raise exception 'pilot_owner_mismatch' using errcode='42501'; end if;
 if p_action='status' then
   return jsonb_build_object('phase',p.phase,'media_id',p.media_id,'permalink',p.permalink,'error_code',p.error_code,
     'username','sahryjapah','schedule_id',sid,'file_name',(select file_name from public.videos where id=(select video_id from public.schedules where id=sid)));
 elsif p_action='login_claim' then
   if p.phase in ('publishing','uncertain','published') then raise exception 'pilot_already_dispatched'; end if;
   if p.login_at>now()-interval '60 seconds' then raise exception 'login_cooldown'; end if;
   update public.instagram_private_pilot set phase='login_pending',lease=gen_random_uuid(),login_at=now(),updated_at=now(),error_code=null where id=true returning * into p;
   return jsonb_build_object('lease',p.lease,'settings_cipher',p.settings_cipher);
 elsif p_action='login_finish' then
   if p.phase<>'login_pending' or p.lease::text is distinct from p_payload->>'lease' then raise exception 'lease_mismatch'; end if;
   if p_payload->>'phase' not in ('connected','two_factor','blocked') then raise exception 'invalid_phase'; end if;
   if length(coalesce(p_payload->>'settings_cipher',''))>100000 then raise exception 'settings_too_large'; end if;
   update public.instagram_private_pilot set phase=p_payload->>'phase',settings_cipher=nullif(p_payload->>'settings_cipher',''),
     error_code=left(p_payload->>'error_code',60),lease=null,updated_at=now() where id=true;
   return jsonb_build_object('ok',true);
 elsif p_action='publish_claim' then
   if p.phase<>'connected' or p.settings_cipher is null then raise exception 'pilot_not_ready'; end if;
   perform 1 from public.platform_accounts where id=aid and not enabled and config->>'status'='disconnected' for update;
   if not found then raise exception 'account_state_changed'; end if;
   select * into s from public.schedules where id=sid for update;
   if not found or s.platform_account_id<>aid or s.status<>'scheduled' or s.instagram_media_id is not null or s.published_at is not null then raise exception 'schedule_state_changed'; end if;
   if not exists(select 1 from public.videos where id=s.video_id and storage_provider='r2' and storage_deleted_at is null
     and media_clean_status='ready' and size_bytes between 1 and 50000000 and storage_path like u::text||'/%') then raise exception 'video_unavailable'; end if;
   if exists(select 1 from public.job_queue where schedule_id=sid and (status='running' or locked_at is not null)) then raise exception 'schedule_running'; end if;
   update public.instagram_private_pilot set phase='publishing',lease=gen_random_uuid(),updated_at=now(),error_code=null where id=true returning * into p;
   return jsonb_build_object('lease',p.lease,'settings_cipher',p.settings_cipher,'video_id',s.video_id);
 elsif p_action='publish_finish' then
   if p.phase<>'publishing' or p.lease::text is distinct from p_payload->>'lease' then raise exception 'lease_mismatch'; end if;
   if coalesce(p_payload->>'media_id','') ~ '^[0-9]+$' and coalesce(p_payload->>'code','') ~ '^[A-Za-z0-9_-]+$' then
     update public.schedules set status='published',instagram_media_id=p_payload->>'media_id',published_at=now(),last_error=null
       where id=sid and platform_account_id=aid and status='scheduled' and instagram_media_id is null and published_at is null;
     if not found then raise exception 'receipt_reconciliation_required'; end if;
     update public.job_queue set status='done',locked_at=null,locked_by=null,updated_at=now() where schedule_id=sid and job_type='publish_reel' and status in ('pending','failed');
     update public.instagram_private_pilot set phase='published',media_id=p_payload->>'media_id',permalink='https://www.instagram.com/reel/'||(p_payload->>'code')||'/',
       settings_cipher=null,lease=null,updated_at=now() where id=true;
   else
     update public.instagram_private_pilot set phase='uncertain',error_code=left(coalesce(p_payload->>'error_code','publish_uncertain'),60),updated_at=now() where id=true;
   end if;
   return jsonb_build_object('ok',true);
 end if;
 raise exception 'invalid_action';
end $$;
revoke all on function public.instagram_private_pilot_control(text,jsonb) from public,anon;
grant execute on function public.instagram_private_pilot_control(text,jsonb) to authenticated;
