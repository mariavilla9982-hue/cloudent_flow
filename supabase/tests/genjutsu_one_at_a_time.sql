-- Generate runnable SQL with node scripts/test-genjutsu-one-at-a-time.mjs.
begin;
create temp table production_jobs (
 id uuid primary key, status text not null, meta jsonb not null, hidden_at timestamptz,
 runninghub_task_id text, result_video_id uuid, next_attempt_at timestamptz default now(),
 created_at timestamptz not null, updated_at timestamptz, locked_at timestamptz, locked_by text,
 attempt_count integer default 0, max_attempts integer default 1, progress integer, last_error text
);
create temp table face_swap_jobs (status text);
create temp table app_settings (key text primary key, value jsonb, updated_at timestamptz);
create temp table integrations (provider text, config jsonb);
create temp table wakes (url text);
create function pg_temp.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
returns bigint language sql as $$ insert into pg_temp.wakes values (url) returning 1::bigint $$;
create function pg_temp.get_cloudent_worker_secret() returns text language sql as $$ select 'test' $$;

-- Load the production functions here, rewritten to pg_temp; see test invocation.
-- QUEUE_FUNCTIONS

insert into integrations values ('runninghub','{"concurrency":5}');
insert into app_settings (key,value) values ('genjutsu_queue_config','{"prompt_concurrency":1}');
insert into production_jobs (id,status,meta,created_at)
select ('00000000-0000-0000-0000-00000000000'||i)::uuid,'motion_waiting',
 '{"workflow_key":"genjutsu","workflow_id":"2117411301344411649"}',now()+i*interval '1 second'
from generate_series(1,4) i;
-- A newer video already has a manual prompt.
update production_jobs set meta=meta||'{"genjutsu_prompt":{"status":"complete","source":"manual"}}'
where id='00000000-0000-0000-0000-000000000003';

do $$
declare
 first_id uuid:='00000000-0000-0000-0000-000000000001';
 second_id uuid:='00000000-0000-0000-0000-000000000002';
 manual_id uuid:='00000000-0000-0000-0000-000000000003';
 last_id uuid:='00000000-0000-0000-0000-000000000004';
 picked uuid;
begin
 if exists(select 1 from pg_temp.claim_genjutsu_job('video')) then raise exception 'manual prompt jumped queue';end if;
 if not pg_temp.wake_genjutsu_queue() then raise exception 'missing serial prep wake';end if;
 if (select count(*) from wakes where url like '%phase=prepare')<>1 then raise exception 'wrong number of serial prep wakes';end if;
 select id into picked from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-first');
 if picked is distinct from first_id then raise exception 'wrong first prompt';end if;
 if exists(select 1 from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-racing')) then raise exception 'second concurrent prompt lease';end if;

 update production_jobs set locked_at=null,locked_by=null,next_attempt_at=now()+interval '1 minute',
  meta=meta||'{"genjutsu_prompt":{"status":"processing","interactionId":"one"}}' where id=first_id;
 if exists(select 1 from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-backoff')) then raise exception 'next prompt jumped a backoff';end if;
 update production_jobs set next_attempt_at=now() where id=first_id;
 select id into picked from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-resume');
 if picked is distinct from first_id then raise exception 'pending analysis was not resumed';end if;

 update production_jobs set meta=meta||'{"genjutsu_prompt":{"status":"complete","interactionId":"one"}}' where id=first_id;
 if exists(select 1 from pg_temp.claim_genjutsu_job('video')) then raise exception 'video bypassed live prompt lease';end if;
 update production_jobs set locked_at=null,locked_by=null where id=first_id;
 if exists(select 1 from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-after-ready')) then raise exception 'next prompt started before first video';end if;
 if not pg_temp.wake_genjutsu_queue() then raise exception 'missing serial video wake';end if;
 if (select count(*) from wakes where url not like '%phase=prepare')<>1 then raise exception 'wrong number of serial video wakes';end if;
 select id into picked from pg_temp.claim_genjutsu_job('video');
 if picked is distinct from first_id then raise exception 'wrong first video';end if;
 if exists(select 1 from pg_temp.claim_genjutsu_job('video-racing')) then raise exception 'second concurrent video lease';end if;
 update production_jobs set status='running',runninghub_task_id='task-one' where id=first_id;
 delete from app_settings where key='genjutsu_queue_wake';
 if pg_temp.wake_genjutsu_queue() then raise exception 'unneeded worker wake during generation';end if;
 if exists(select 1 from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-running')) then raise exception 'prompt started while video runs';end if;

 update production_jobs set status='ready' where id=first_id;
 select id into picked from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-next');
 if picked is distinct from second_id then raise exception 'completion did not free the queue';end if;
 update production_jobs set status='failed' where id=second_id;
 select id into picked from pg_temp.claim_genjutsu_job('manual');
 if picked is distinct from manual_id then raise exception 'failure did not free the queue';end if;
 update production_jobs set status='cancelled' where id=manual_id;
 select id into picked from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-last');
 if picked is distinct from last_id then raise exception 'cancel did not free the queue';end if;

 update production_jobs set status='failed',meta=meta||'{"pipeline_dispatch_uncertain":true}' where id=manual_id;
 update production_jobs set locked_by=null,locked_at=null where id=last_id;
 if exists(select 1 from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-uncertain')) then raise exception 'ambiguous video released too early';end if;

 update app_settings set value='{"prompt_concurrency":2}' where key='genjutsu_queue_config';
 update production_jobs set status='running' where id=first_id;
 select id into picked from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-parallel');
 if picked is distinct from last_id then raise exception 'parallel mode no longer prepares independently';end if;
end $$;
select 'GENJUTSU serial and parallel queue checks passed' as result;
rollback;
