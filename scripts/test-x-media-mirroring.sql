-- Real PostgreSQL integration test. All fixtures and mutations are rolled back.
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
do $$
declare src uuid; dst uuid; other_user uuid; ws uuid; sa uuid:=gen_random_uuid(); da uuid:=gen_random_uuid();
 sa2 uuid:=gen_random_uuid(); rid uuid; p uuid; p2 uuid; mirrored uuid; n integer; path text; denied boolean:=false;
begin
 select (value->>'user_id')::uuid into src from public.app_settings where key='x_studio_private_dashboard';
 select user_id,workspace_id into dst,ws from public.app_members where role='admin' and enabled order by created_at limit 1;
 select user_id into other_user from public.app_members where user_id not in(src,dst) and enabled limit 1;
 insert into public.platform_accounts(id,platform,external_account_id,account_label,workspace_id,owner_user_id,enabled,config)
 values(sa,'x','qa-mirror-src-'||sa,'QA source',ws,src,true,'{"status":"connected"}'),
 (sa2,'x','qa-mirror-src-'||sa2,'QA source 2',ws,src,true,'{"status":"connected"}'),
 (da,'x','qa-mirror-dst-'||da,'QA destination',ws,dst,true,'{"status":"connected","publish_provider":"buffer","buffer_channel_id":"qa","buffer_key_cipher":"qa"}');
 insert into public.x_account_access(workspace_id,user_id,platform_account_id) values(ws,src,sa),(ws,src,sa2),(ws,dst,da);
 insert into public.x_media_mirrors(workspace_id,source_user_id,destination_user_id) values(ws,src,dst) returning id into rid;
 path:=src::text||'/x-uploads/'||gen_random_uuid()||'.mp4';
 insert into public.x_drive_posts(user_id,workspace_id,platform_account_id,drive_file_id,drive_file_name,drive_mime_type,drive_size_bytes,status,post_text,meta)
 values(src,ws,sa,'upload:'||path,'qa.mp4','video/mp4',1024,'queued','source caption',jsonb_build_object('source','upload','storage_provider','r2','storage_path',path,'thumbnail_path',path||'.jpg')) returning id into p;
 perform pg_temp.assert_true(not exists(select 1 from public.x_media_mirror_items where mirror_id=rid),'waiting creates no copy');
 begin perform public.x_mirror_activate(other_user,rid,da);exception when others then denied:=true;end;
 perform pg_temp.assert_true(denied,'foreign user cannot activate');denied:=false;
 begin perform public.x_mirror_activate(dst,rid,sa);exception when others then denied:=true;end;
 perform pg_temp.assert_true(denied,'admin cannot select somebody else account');
 n:=public.x_mirror_activate(dst,rid,da);
 perform pg_temp.assert_true(n=1,'backfill receives old video');
 select destination_post_id into mirrored from public.x_media_mirror_items where mirror_id=rid;
 perform pg_temp.assert_true(exists(select 1 from public.x_drive_posts where id=mirrored and user_id=dst and platform_account_id=da and status='queued' and scheduled_at is null and x_post_id is null and reply_text is null and post_text='' and meta->'gallery'='true'::jsonb and meta->>'storage_path'=path and meta->>'thumbnail_path'=path||'.jpg' and drive_size_bytes=1024),'original reference and draft fields');
 perform pg_temp.assert_true(public.x_mirror_can_read(dst,mirrored),'destination preview allowed');
 perform pg_temp.assert_true(not public.x_mirror_can_read(other_user,mirrored),'foreign preview denied');
 perform pg_temp.assert_true(not public.x_mirror_can_read(src,mirrored),'source cannot read destination');
 perform pg_temp.assert_true(public.x_mirror_backfill(rid)=0,'replay has no duplicates');
 insert into public.x_drive_posts(user_id,workspace_id,platform_account_id,drive_file_id,drive_file_name,drive_mime_type,status,meta)
 values(src,ws,sa2,'upload:'||path,'qa.mp4','video/mp4','queued',jsonb_build_object('source','upload','storage_provider','r2','storage_path',path));
 perform pg_temp.assert_true((select count(*)=1 from public.x_media_mirror_items where mirror_id=rid),'same file in two source accounts deduplicated');
 -- Enable publication + supply pending caption: mirrored draft must still never be claimed.
 insert into public.x_account_configs(platform_account_id,workspace_id,user_id,enabled,next_publish_at,queue_mode) values(da,ws,dst,true,now()-interval '1 hour','interval');
 insert into public.x_caption_queue(user_id,workspace_id,platform_account_id,caption,status) values(dst,ws,da,'QA pending caption','pending');
 perform pg_temp.assert_true(public.claim_x_account_post(da,'qa-mirror') is null,'no automatic publication even with enabled queue and caption');
 update public.x_drive_posts set status='skipped' where id=mirrored;
 perform pg_temp.assert_true(public.x_mirror_backfill(rid)=0,'removed item never resurrected');
 perform pg_temp.assert_true(exists(select 1 from public.x_drive_posts where id=p and status='queued' and post_text='source caption' and meta->>'storage_path'=path),'removal leaves source unchanged');
 -- A subsequent completed upload is copied immediately by the database trigger.
 path:=src::text||'/x-uploads/'||gen_random_uuid()||'.mp4';
 insert into public.x_drive_posts(user_id,workspace_id,platform_account_id,drive_file_id,drive_file_name,drive_mime_type,status,meta)
 values(src,ws,sa,'upload:'||path,'qa.mp4','video/mp4','queued',jsonb_build_object('source','upload','storage_provider','r2','storage_path',path)) returning id into p2;
 perform pg_temp.assert_true(exists(select 1 from public.x_media_mirror_items where mirror_id=rid and source_post_id=p2 and status='SYNCED'),'new upload trigger works without publication');
 select destination_post_id into mirrored from public.x_media_mirror_items where mirror_id=rid and source_post_id=p2;
 update public.x_drive_posts set meta=jsonb_set(meta,'{storage_path}','"foreign/x-uploads/forged.mp4"') where id=mirrored;
 perform pg_temp.assert_true(not public.x_mirror_can_read(dst,mirrored),'forged storage path denied');
 perform pg_temp.assert_true(not has_table_privilege('authenticated','public.x_media_mirrors','INSERT'),'browser cannot activate by direct write');
 perform pg_temp.assert_true(not has_table_privilege('authenticated','public.x_media_mirror_items','SELECT'),'browser cannot read mirror ledger');
 perform pg_temp.assert_true(not has_function_privilege('authenticated','public.x_mirror_activate(uuid,uuid,uuid)','EXECUTE'),'browser cannot impersonate owner through RPC');
 perform pg_temp.assert_true((select bool_and(relrowsecurity) from pg_class where oid in('public.x_media_mirrors'::regclass,'public.x_media_mirror_items'::regclass)),'RLS enabled');
end $$;
rollback;
select 'PASS waiting, confirmation guards, upload trigger, backfill, deduplication, removal, preview isolation, path tampering, RLS privileges, no publication' as result;
