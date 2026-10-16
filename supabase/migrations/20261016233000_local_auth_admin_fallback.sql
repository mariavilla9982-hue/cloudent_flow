create or replace function public.cloudent_x_local_login(p_email text,p_password text)
returns table(session_token text,expires_at timestamptz,user_id uuid,workspace_id uuid,role text,email text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_email text:=lower(btrim(coalesce(p_email,'')));
  v_now timestamptz:=now();
  v_window timestamptz:=date_trunc('hour',v_now)+floor(extract(minute from v_now)/15)*interval '15 minutes';
  v_attempts int;
  v_cred cloudent_private.x_local_credentials%rowtype;
  v_member cloudent_private.x_members%rowtype;
  v_token text;
  v_exp timestamptz;
begin
  if v_email='' or coalesce(p_password,'')='' then return; end if;
  insert into cloudent_private.x_local_login_attempts(email,window_start,attempts)
  values(v_email,v_window,1)
  on conflict(email,window_start) do update set attempts=cloudent_private.x_local_login_attempts.attempts+1
  returning attempts into v_attempts;
  delete from cloudent_private.x_local_login_attempts where window_start<v_now-interval '1 day';
  if v_attempts>10 then return; end if;

  select * into v_cred from cloudent_private.x_local_credentials c where c.email=v_email and c.enabled;
  if not found or extensions.crypt(p_password,v_cred.password_hash)<>v_cred.password_hash then return; end if;

  select * into v_member from cloudent_private.x_members m
  where m.principal_id=v_cred.bridge_user_id and m.workspace_id=v_cred.workspace_id and m.enabled and m.role in ('admin','x_user');
  if not found then return; end if;

  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_exp:=v_now+interval '30 days';
  insert into cloudent_private.x_local_sessions(token_hash,bridge_user_id,workspace_id,expires_at)
  values(encode(extensions.digest(v_token,'sha256'),'hex'),v_cred.bridge_user_id,v_cred.workspace_id,v_exp);

  delete from cloudent_private.x_local_sessions
  where bridge_user_id=v_cred.bridge_user_id
    and (expires_at<v_now-interval '1 day' or (revoked_at is not null and revoked_at<v_now-interval '1 day'));

  return query select v_token,v_exp,v_cred.bridge_user_id,v_cred.workspace_id,v_member.role,v_cred.email;
end $$;

create or replace function public.cloudent_x_local_session(p_token text)
returns table(user_id uuid,workspace_id uuid,role text,email text,expires_at timestamptz)
language plpgsql
security definer
set search_path=''
as $$
declare v_hash text:=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex'); v_now timestamptz:=now();
begin
  update cloudent_private.x_local_sessions s set last_seen_at=v_now
  where s.token_hash=v_hash and s.revoked_at is null and s.expires_at>v_now and s.last_seen_at<v_now-interval '5 minutes';
  return query
  select s.bridge_user_id,s.workspace_id,m.role,c.email,s.expires_at
  from cloudent_private.x_local_sessions s
  join cloudent_private.x_local_credentials c on c.bridge_user_id=s.bridge_user_id and c.workspace_id=s.workspace_id and c.enabled
  join cloudent_private.x_members m on m.principal_id=s.bridge_user_id and m.workspace_id=s.workspace_id and m.enabled and m.role in ('admin','x_user')
  where s.token_hash=v_hash and s.revoked_at is null and s.expires_at>v_now
  limit 1;
end $$;

revoke all on function public.cloudent_x_local_login(text,text) from public,anon,authenticated;
revoke all on function public.cloudent_x_local_session(text) from public,anon,authenticated;
grant execute on function public.cloudent_x_local_login(text,text) to service_role;
grant execute on function public.cloudent_x_local_session(text) to service_role;
