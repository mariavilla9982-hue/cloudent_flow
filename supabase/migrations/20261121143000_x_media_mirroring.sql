-- References only: no media transfer, no publishing and no changes to source jobs.
create table public.x_media_mirrors (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 source_user_id uuid not null references auth.users(id),
 destination_user_id uuid not null references auth.users(id),
 destination_account_id uuid references public.platform_accounts(id),
 status text not null default 'AGUARDANDO_VINCULACAO' check(status in ('AGUARDANDO_VINCULACAO','ATIVO')),
 confirmed_at timestamptz,
 last_error text,
 created_at timestamptz not null default now(),
 unique(source_user_id,destination_user_id),
 check(source_user_id<>destination_user_id),
 check(status<>'ATIVO' or (destination_account_id is not null and confirmed_at is not null))
);
create table public.x_media_mirror_items (
 id uuid primary key default gen_random_uuid(),
 mirror_id uuid not null references public.x_media_mirrors(id),
 source_post_id uuid not null,
 source_account_id uuid not null,
 storage_provider text not null,
 storage_path text not null,
 destination_post_id uuid,
 status text not null check(status in ('SYNCED','ERROR')),
 last_error text,
 updated_at timestamptz not null default now(),
 unique(mirror_id,storage_provider,storage_path)
);
create index x_mirror_destination_post on public.x_media_mirror_items(destination_post_id);
alter table public.x_media_mirrors enable row level security;
alter table public.x_media_mirror_items enable row level security;
revoke all on public.x_media_mirrors,public.x_media_mirror_items from public,anon,authenticated;
grant all on public.x_media_mirrors,public.x_media_mirror_items to service_role;

create function public.x_mirror_copy(p_mirror uuid,p_source uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.x_media_mirrors; s public.x_drive_posts; item public.x_media_mirror_items; dest uuid;
begin
 select * into r from public.x_media_mirrors where id=p_mirror for update;
 if not found or r.status<>'ATIVO' then return false; end if;
 if not exists(select 1 from public.platform_accounts a join public.app_members m on m.user_id=r.destination_user_id
   where a.id=r.destination_account_id and a.owner_user_id=r.destination_user_id and a.workspace_id=r.workspace_id
   and m.workspace_id=r.workspace_id and m.enabled and a.enabled and a.platform='x'
   and a.config->>'publish_provider'='buffer' and a.config->>'status'='connected'
   and public.cloudent_x_access(r.destination_user_id,a.id)) then return false; end if;
 select * into s from public.x_drive_posts where id=p_source;
 if not found or s.user_id<>r.source_user_id or s.workspace_id<>r.workspace_id
  or s.drive_file_id not like 'upload:%' or coalesce(s.meta->>'source','')<>'upload'
  or s.drive_mime_type not in ('video/mp4','video/quicktime') or s.status='skipped'
  or coalesce(s.meta->>'storage_provider','') not in ('r2','supabase')
  or s.meta->>'storage_path' not like r.source_user_id::text||'/x-uploads/%'
  or not public.cloudent_x_access(r.source_user_id,s.platform_account_id)
  or not exists(select 1 from public.platform_accounts where id=s.platform_account_id and owner_user_id=r.source_user_id and enabled)
 then return false; end if;
 select * into item from public.x_media_mirror_items where mirror_id=r.id
  and storage_provider=s.meta->>'storage_provider' and storage_path=s.meta->>'storage_path';
 -- Keep tombstones when destination items are removed: never resurrect them on replay.
 if found and item.status='SYNCED' then return false; end if;
 begin
  insert into public.x_drive_posts(user_id,workspace_id,platform_account_id,drive_file_id,drive_file_name,
    drive_mime_type,drive_size_bytes,status,post_text,reply_text,scheduled_at,meta)
  values(r.destination_user_id,r.workspace_id,r.destination_account_id,'mirror:'||r.id||':'||(s.meta->>'storage_path'),
    s.drive_file_name,s.drive_mime_type,s.drive_size_bytes,'queued','',null,null,
    jsonb_build_object('source','upload','storage_provider',s.meta->>'storage_provider',
     'storage_path',s.meta->>'storage_path','thumbnail_path',s.meta->>'thumbnail_path',
     'gallery',true,'mirror_id',r.id,'mirror_source_post_id',s.id))
  on conflict(user_id,drive_file_id,platform_account_id) do nothing returning id into dest;
  if dest is null then
   select id into dest from public.x_drive_posts where user_id=r.destination_user_id
    and platform_account_id=r.destination_account_id and drive_file_id='mirror:'||r.id||':'||(s.meta->>'storage_path');
  end if;
  insert into public.x_media_mirror_items(mirror_id,source_post_id,source_account_id,storage_provider,storage_path,destination_post_id,status)
   values(r.id,s.id,s.platform_account_id,s.meta->>'storage_provider',s.meta->>'storage_path',dest,'SYNCED')
   on conflict(mirror_id,storage_provider,storage_path) do update set status='SYNCED',destination_post_id=excluded.destination_post_id,last_error=null,updated_at=now();
  update public.x_media_mirrors set last_error=null where id=r.id;
  return true;
 exception when others then
  insert into public.x_media_mirror_items(mirror_id,source_post_id,source_account_id,storage_provider,storage_path,status,last_error)
   values(r.id,s.id,s.platform_account_id,s.meta->>'storage_provider',s.meta->>'storage_path','ERROR','sync_failed:'||sqlstate)
   on conflict(mirror_id,storage_provider,storage_path) do update set status='ERROR',last_error=excluded.last_error,updated_at=now();
  update public.x_media_mirrors set last_error='sync_failed:'||sqlstate where id=r.id;
  return false;
 end;
end $$;

create function public.x_mirror_after_upload() returns trigger
language plpgsql security definer set search_path='' as $$
declare r record;
begin
 if new.drive_file_id like 'upload:%' and new.drive_mime_type in ('video/mp4','video/quicktime') then
  for r in select id from public.x_media_mirrors where source_user_id=new.user_id and status='ATIVO' loop
   -- Failure cannot roll back the source upload. Worker backfill retries it.
   begin perform public.x_mirror_copy(r.id,new.id);
   exception when others then
    update public.x_media_mirrors set last_error='sync_failed:'||sqlstate where id=r.id;
   end;
  end loop;
 end if;
 return new;
end $$;
create trigger x_mirror_completed_upload after insert on public.x_drive_posts
 for each row execute function public.x_mirror_after_upload();

create function public.x_mirror_backfill(p_mirror uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare s record; n integer:=0;
begin
 for s in select p.id from public.x_drive_posts p join public.x_media_mirrors r
  on r.id=p_mirror and r.source_user_id=p.user_id and r.workspace_id=p.workspace_id and r.status='ATIVO'
  where p.drive_file_id like 'upload:%' and p.drive_mime_type in ('video/mp4','video/quicktime') and p.status<>'skipped'
  and not exists(select 1 from public.x_media_mirror_items i where i.mirror_id=r.id
   and i.storage_provider=p.meta->>'storage_provider' and i.storage_path=p.meta->>'storage_path' and i.status='SYNCED')
  order by p.created_at,p.id limit 100
 loop if public.x_mirror_copy(p_mirror,s.id) then n:=n+1; end if; end loop;
 return n;
end $$;

create function public.x_mirror_activate(p_user uuid,p_mirror uuid,p_account uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.x_media_mirrors;
begin
 select * into r from public.x_media_mirrors where id=p_mirror and destination_user_id=p_user for update;
 if not found or not public.cloudent_x_access(p_user,p_account) or not exists(
  select 1 from public.platform_accounts where id=p_account and owner_user_id=p_user and workspace_id=r.workspace_id
   and platform='x' and enabled and config->>'publish_provider'='buffer' and config->>'status'='connected'
   and coalesce(config->>'buffer_channel_id','')<>'' and coalesce(config->>'buffer_key_cipher','')<>'')
 then raise exception 'mirror_destination_forbidden'; end if;
 if r.destination_account_id is not null and r.destination_account_id<>p_account then raise exception 'mirror_destination_already_bound'; end if;
 update public.x_media_mirrors set destination_account_id=p_account,status='ATIVO',confirmed_at=coalesce(confirmed_at,now()) where id=r.id;
 return public.x_mirror_backfill(r.id);
end $$;

-- Authorize only the exact mirrored destination object, never a caller-provided path.
create function public.x_mirror_can_read(p_user uuid,p_post uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.x_drive_posts p join public.x_media_mirror_items i on i.destination_post_id=p.id
  join public.x_media_mirrors r on r.id=i.mirror_id
  where p.id=p_post and p.user_id=p_user and r.destination_user_id=p_user
   and p.platform_account_id=r.destination_account_id and public.cloudent_x_access(p_user,p.platform_account_id)
   and i.status='SYNCED' and i.storage_path=p.meta->>'storage_path' and i.storage_provider=p.meta->>'storage_provider'
   and p.meta->>'mirror_id'=r.id::text and p.meta->>'mirror_source_post_id'=i.source_post_id::text)
$$;
revoke all on function public.x_mirror_copy(uuid,uuid),public.x_mirror_after_upload(),public.x_mirror_backfill(uuid),public.x_mirror_activate(uuid,uuid,uuid),public.x_mirror_can_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.x_mirror_copy(uuid,uuid),public.x_mirror_backfill(uuid),public.x_mirror_activate(uuid,uuid,uuid),public.x_mirror_can_read(uuid,uuid) to service_role;
