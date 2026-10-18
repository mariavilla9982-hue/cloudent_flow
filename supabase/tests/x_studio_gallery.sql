begin;
set local statement_timeout='8s';
set local lock_timeout='2s';
do $$
declare a platform_accounts%rowtype;b uuid;j uuid:=gen_random_uuid();manual uuid:=gen_random_uuid();c uuid:=gen_random_uuid();other_caption uuid:=gen_random_uuid();p jsonb;target timestamptz:=now()+interval '2 days';
begin
 select * into strict a from platform_accounts where platform='x' and config->>'status'='connected' and owner_user_id in(select user_id from app_members where role='x_user' and enabled) order by id limit 1;
 select id into strict b from platform_accounts where platform='x' and owner_user_id=a.owner_user_id and id<>a.id limit 1;
 insert into x_caption_queue(id,user_id,workspace_id,platform_account_id,caption) values(c,a.owner_user_id,a.workspace_id,a.id,'Legenda neutra de teste'),(other_caption,a.owner_user_id,a.workspace_id,b,'Legenda da outra conta');
 insert into x_drive_posts(id,user_id,workspace_id,platform_account_id,drive_file_id,drive_file_name,status,post_text,scheduled_at,next_attempt_at) values
 (j,a.owner_user_id,a.workspace_id,a.id,'qa-gallery-'||j,'qa.mp4','queued','',null,now()),
 (manual,a.owner_user_id,a.workspace_id,a.id,'qa-calendar-'||manual,'qa-calendar.mp4','queued','Post manual',target,target);
 update x_account_configs set enabled=true,queue_mode='daily_slots',daily_slots=array['06:00','15:00','21:00'],next_publish_at=now()-interval '1 minute' where platform_account_id=a.id;
 if x_next_daily_slot(array['06:00','15:00'],'2026-10-18T17:00:00Z')<>'2026-10-18T18:00:00Z'::timestamptz then raise exception 'wrong_brasilia_slot';end if;
 p:=claim_x_account_post(a.id,'qa-gallery');
 if p->>'id'<>j::text or p->>'post_text'<>'Legenda neutra de teste' then raise exception 'caption_not_assigned';end if;
 if (select status from x_caption_queue where id=c)<>'reserved' or (select status from x_caption_queue where id=other_caption)<>'pending' then raise exception 'caption_cross_account';end if;
 if claim_x_account_post(a.id,'qa-second') is not null then raise exception 'double_claim';end if;
 perform complete_x_upload_post(j,'qa-gallery',a.id,'Legenda neutra de teste','qa-media','qa-post');
 if (select status from x_caption_queue where id=c)<>'used' then raise exception 'caption_not_consumed';end if;
 if (select next_publish_at from x_account_configs where platform_account_id=a.id)<>x_next_daily_slot(array['06:00','15:00','21:00'],now()) then raise exception 'queue_ignored_daily_slots';end if;
 if (select scheduled_at from x_drive_posts where id=manual)<>target then raise exception 'manual_schedule_changed';end if;
 if has_table_privilege('authenticated','public.x_caption_queue','SELECT') or has_table_privilege('anon','public.x_caption_queue','SELECT') then raise exception 'private_caption_queue_exposed';end if;
end $$;
rollback;
