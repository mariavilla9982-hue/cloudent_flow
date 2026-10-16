begin;
-- Test-only identities and accounts are transaction-scoped; no real publishing.
create temporary table x_test_context as select gen_random_uuid() u1,gen_random_uuid() u2,gen_random_uuid() a1,gen_random_uuid() a2,gen_random_uuid() j1,gen_random_uuid() j2,(select id from public.workspaces where slug='cloudentflow') w;
insert into auth.users(id,email) select u1,'x-qa-a@example.invalid' from x_test_context union all select u2,'x-qa-b@example.invalid' from x_test_context;
insert into public.app_members(user_id,role,enabled,workspace_id) select u1,'x_user',true,w from x_test_context union all select u2,'x_user',true,w from x_test_context;
insert into public.platform_accounts(id,platform,external_account_id,account_label,enabled,config,workspace_id,owner_user_id)
select a1,'x','qa-'||a1,'QA A',true,'{"status":"connected"}'::jsonb,w,u1 from x_test_context union all select a2,'x','qa-'||a2,'QA B',true,'{"status":"connected"}'::jsonb,w,u2 from x_test_context;
insert into public.x_account_configs(platform_account_id,workspace_id,user_id,enabled) select a1,w,u1,true from x_test_context union all select a2,w,u2,true from x_test_context;
insert into public.x_drive_posts(id,user_id,platform_account_id,drive_file_id,drive_file_name,status,post_text,scheduled_at,next_attempt_at)
select j1,u1,a1,'qa1','qa1.mp4','queued','qa',date_trunc('hour',now())-interval '1 hour',now()-interval '1 minute' from x_test_context union all select j2,u2,a2,'qa2','qa2.mp4','queued','qa',date_trunc('hour',now())-interval '1 hour',now()-interval '1 minute' from x_test_context;
do $$ declare t record; p jsonb; begin
 select * into t from x_test_context;
 if public.cloudent_x_access(t.u1,t.a2) then raise exception 'cross_account_access';end if;
 if not public.cloudent_x_access(t.u1,t.a1) then raise exception 'own_account_denied';end if;
 begin insert into public.x_drive_posts(user_id,platform_account_id,drive_file_id,drive_file_name,status,post_text) values(t.u1,null,'missing','missing.mp4','queued','qa');raise exception 'missing_account_accepted';exception when raise_exception then if sqlerrm='missing_account_accepted' then raise;end if;end;
 begin insert into public.x_drive_posts(user_id,platform_account_id,drive_file_id,drive_file_name,status,post_text) values(t.u1,t.a2,'cross','cross.mp4','queued','qa');raise exception 'cross_account_accepted';exception when raise_exception then if sqlerrm='cross_account_accepted' then raise;end if;end;
 p:=public.claim_x_account_post(t.a1,'qa-worker');if p->>'id'<>t.j1::text then raise exception 'claim_failed';end if;
 if public.claim_x_account_post(t.a1,'qa-worker-2') is not null then raise exception 'double_claim';end if;
 perform public.complete_x_upload_post(t.j1,'qa-worker',t.a1,'qa','media','qa-post-'||t.j1);
 if public.claim_x_account_post(t.a1,'qa-worker-3') is not null then raise exception 'published_reclaimed';end if;
 if public.claim_x_account_post(t.a2,'qa-worker-b') is null then raise exception 'second_account_blocked';end if;
 if has_function_privilege('authenticated','public.claim_x_account_post(uuid,text)','EXECUTE')  then raise exception 'worker_rpc_exposed';end if;
end $$;
-- Verify actual RLS under authenticated with an impersonated subject.
select set_config('request.jwt.claim.sub',(select u1::text from x_test_context),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.x_drive_posts where drive_file_name='qa2.mp4') then raise exception 'rls_cross_account';end if;
 if not exists(select 1 from public.x_drive_posts where drive_file_name='qa1.mp4') then raise exception 'rls_own_account_denied';end if;
end $$;
reset role;
select 'PASS: independent slots, ownership, missing-account rejection, atomic claim, replay protection and RLS' as result;
rollback;
