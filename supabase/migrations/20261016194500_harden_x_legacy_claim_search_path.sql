create or replace function public.claim_x_upload_post(p_user_id uuid,p_worker_id text)
returns jsonb
language sql
security invoker
set search_path=public,pg_temp
as $$ select null::jsonb $$;

revoke all on function public.claim_x_upload_post(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_x_upload_post(uuid,text) to service_role;
