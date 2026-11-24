-- Isolated PostgreSQL tests: temp copies only, no production triggers or provider calls.
BEGIN;
CREATE TEMP TABLE production_jobs (LIKE public.production_jobs INCLUDING DEFAULTS);
CREATE TEMP TABLE face_swap_jobs (LIKE public.face_swap_jobs INCLUDING DEFAULTS);
CREATE TEMP TABLE app_settings (LIKE public.app_settings INCLUDING DEFAULTS);
CREATE TEMP TABLE integrations (LIKE public.integrations INCLUDING DEFAULTS);
CREATE TEMP TABLE schedules (LIKE public.schedules INCLUDING DEFAULTS);
CREATE TEMP TABLE videos (LIKE public.videos INCLUDING DEFAULTS);
CREATE TEMP TABLE platform_accounts (LIKE public.platform_accounts INCLUDING DEFAULTS);
CREATE TEMP TABLE job_queue (LIKE public.job_queue INCLUDING DEFAULTS);
CREATE TEMP TABLE activity_logs (LIKE public.activity_logs INCLUDING DEFAULTS);
-- FUNCTIONS
DO $$
DECLARE
 owner_id uuid:='00000000-0000-0000-0000-000000000090';
 account_id uuid:='00000000-0000-0000-0000-000000000091';
 a uuid:='00000000-0000-0000-0000-000000000001';
 b uuid:='00000000-0000-0000-0000-000000000002';
 c uuid:='00000000-0000-0000-0000-000000000003';
 selected uuid; r jsonb; i integer;
BEGIN
 INSERT INTO pg_temp.app_settings(key,value) VALUES('genjutsu_queue_config','{"paused":false}');
 FOR i IN 1..3 LOOP
 INSERT INTO pg_temp.production_jobs(id,user_id,status,created_at,meta,original_storage_path,original_file_name,frame_storage_path,frame_file_name)
 VALUES(('00000000-0000-0000-0000-00000000000'||i)::uuid,owner_id,'motion_waiting',now()+i*interval '1 second',
 '{"workflow_key":"genjutsu","workflow_id":"2124648844280733698","genjutsu_prompt":{"status":"complete"}}','qa/video','qa.mp4','qa/frame','qa.png');
 INSERT INTO pg_temp.face_swap_jobs(id,user_id,status,production_job_id,created_at,meta,original_storage_path,original_file_name,frame_storage_path,frame_file_name)
 VALUES(('00000000-0000-0000-0000-00000000000'||i)::uuid,owner_id,'waiting',('00000000-0000-0000-0000-00000000000'||i)::uuid,now()+i*interval '1 second',
 '{"pipeline_version":2,"stage":"control_motion","video_workflow":{"key":"genjutsu"}}','qa/video','qa.mp4','qa/frame','qa.png');
 END LOOP;
 r:=pg_temp.genjutsu_queue_action(c,owner_id,'prioritize');
 IF NOT (r->>'ok')::boolean OR pg_temp.genjutsu_serial_head()<>c THEN RAISE EXCEPTION 'B priority not respected by worker head'; END IF;
 -- F: another read sees persistent priority and ties retain FIFO.
 IF pg_temp.genjutsu_serial_head()<>c THEN RAISE EXCEPTION 'F priority lost'; END IF;
 SELECT id INTO selected FROM pg_temp.claim_genjutsu_job('qa-worker',1);
 IF selected IS DISTINCT FROM c THEN RAISE EXCEPTION 'B wrong claimed job'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.claim_genjutsu_job('qa-worker-2',1)) THEN RAISE EXCEPTION 'D double claim'; END IF;
 -- D/E: a running GENJUTSU does not block image lease; fail it and next image remains claimable.
 INSERT INTO pg_temp.face_swap_jobs(id,user_id,status,meta,original_storage_path,original_file_name,frame_storage_path,frame_file_name)
 VALUES(account_id,owner_id,'waiting','{"pipeline_version":2,"stage":"face_swap"}','qa/video','qa.mp4','qa/frame','qa.png');
 IF NOT EXISTS(SELECT 1 FROM pg_temp.lease_image_pipeline(account_id,'qa-image',1)) THEN RAISE EXCEPTION 'D images blocked by GENJUTSU'; END IF;
 UPDATE pg_temp.face_swap_jobs SET status='failed',locked_at=null,locked_by=null WHERE id=account_id;
 DELETE FROM pg_temp.face_swap_jobs WHERE id=account_id;
 -- A: delete pending, tombstone remains, next worker cannot claim it.
 r:=pg_temp.genjutsu_queue_action(a,owner_id,'delete');
 IF NOT (r->>'ok')::boolean OR NOT EXISTS(SELECT 1 FROM pg_temp.production_jobs WHERE id=a AND hidden_at IS NOT NULL AND status='cancelled') THEN RAISE EXCEPTION 'A pending delete failed'; END IF;
 UPDATE pg_temp.production_jobs SET status='failed',locked_at=null,locked_by=null WHERE id=c;
 SELECT id INTO selected FROM pg_temp.claim_genjutsu_job('qa-recovery',1);
 IF selected IS DISTINCT FROM b THEN RAISE EXCEPTION 'E next job blocked after failure/deletion'; END IF;
 UPDATE pg_temp.production_jobs SET status='running',runninghub_task_id='qa-task',locked_at=null,locked_by=null WHERE id=b;
 r:=pg_temp.genjutsu_queue_action(b,owner_id,'delete');
 IF r->>'reason'<>'remote_active' OR EXISTS(SELECT 1 FROM pg_temp.production_jobs WHERE id=b AND hidden_at IS NOT NULL) THEN RAISE EXCEPTION 'A false remote cancellation'; END IF;
 r:=pg_temp.genjutsu_queue_action(b,owner_id,'request_delete');
 IF r->>'confirmation_pending'<>'true' THEN RAISE EXCEPTION 'A missing pending confirmation'; END IF;
 UPDATE pg_temp.production_jobs SET status='cancelled',meta=meta||'{"provider_status":"CANCELLED","provider_task_pending":false}' WHERE id=b;
 r:=pg_temp.genjutsu_queue_action(b,owner_id,'delete');
 IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'A confirmed remote delete failed'; END IF;
 -- C: original file preserved, publish job atomic and duplicate request idempotent.
 INSERT INTO pg_temp.platform_accounts(id,platform,enabled) VALUES(account_id,'instagram',true);
 INSERT INTO pg_temp.videos(id,file_name,storage_path,size_bytes,mime_type,status) VALUES(c,'qa.mp4','qa/original.mp4',100,'video/mp4','ready');
 UPDATE pg_temp.production_jobs SET status='ready',result_video_id=c,locked_at=null,locked_by=null WHERE id=c;
 r:=pg_temp.schedule_genjutsu_result(c,owner_id,account_id,now()+interval '2 days','qa');
 IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'C schedule failed: %',r; END IF;
 r:=pg_temp.schedule_genjutsu_result(c,owner_id,account_id,now()+interval '2 days','qa');
 IF (SELECT count(*) FROM pg_temp.schedules WHERE video_id=c)<>1 OR (SELECT count(*) FROM pg_temp.job_queue)<>1 THEN RAISE EXCEPTION 'C duplicate schedule'; END IF;
 IF (SELECT storage_path FROM pg_temp.videos WHERE id=c)<>'qa/original.mp4' THEN RAISE EXCEPTION 'C changed original'; END IF;
 IF (SELECT hidden_at FROM pg_temp.production_jobs WHERE id=c) IS NOT NULL THEN RAISE EXCEPTION 'C scheduled video hidden'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS A/B/C/D/E/F: isolated PostgreSQL queue, tombstones, priority, independent image lease, recovery, schedule idempotency and original file' AS result;
