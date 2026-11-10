import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { PGlite } = await import(process.env.CLOUDENT_PGLITE_MODULE || '@electric-sql/pglite');
const migrations = new URL('../supabase/migrations/', import.meta.url);
const migration = readFileSync(new URL(readdirSync(migrations).find(name => name.endsWith('_instagram_scale_pilot.sql')), migrations), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'cloudent-instagram-scale-'));
const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const workspace = '20000000-0000-4000-8000-000000000001';
const otherWorkspace = '20000000-0000-4000-8000-000000000002';
const mother = 'c5f2fdd6-00e8-4ca7-adb8-281aa922ad0a';
let db = new PGlite(dir);
const rows = async (sql, params=[]) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await rows(sql, params))[0];
const exec = async sql => db.exec(sql);
const distribute = async () => (await one('select instagram_scale_distribute() as result')).result;
const connect = async (external, parent=mother, actor=owner, reconnect=null, token='test-token') =>
  (await one('select instagram_scale_connect($1,$2,$3,$4,$5,$6,$7) as id',
    [actor,external,'profile_'+external,{status:'connected',source:'instagram-oauth',api_mode:'instagram_login'},token,reconnect,parent])).id;

try {
  await exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table workspaces(id uuid primary key);
    create table app_members(user_id uuid primary key, workspace_id uuid, enabled boolean, role text);
    create table app_settings(key text primary key, value jsonb);
    create table platform_accounts(id uuid primary key default gen_random_uuid(), platform text, external_account_id text,
      account_label text, enabled boolean, workspace_id uuid, owner_user_id uuid, config jsonb,
      created_at timestamptz default now(), updated_at timestamptz default now(), unique(platform, external_account_id));
    create table videos(id uuid primary key default gen_random_uuid(), storage_path text, original_storage_path text,
      storage_provider text default 'r2', storage_deleted_at timestamptz, media_clean_status text default 'ready',
      media_clean_report jsonb, media_cleaned_at timestamptz, media_clean_error text, file_name text, caption text,
      platform text default 'instagram', platform_account_id uuid, updated_at timestamptz default now());
    create table schedules(id uuid primary key default gen_random_uuid(), video_id uuid references videos(id),
      scheduled_at timestamptz, status text, platform text, platform_account_id uuid, trial_video_id uuid,
      published_at timestamptz, instagram_media_id text, smart_mode text, smart_strategy text, smart_strategy_locked boolean,
      last_error text, attempt_count integer default 0, created_at timestamptz default now(), updated_at timestamptz default now());
    create unique index schedules_unique_slot on schedules(platform_account_id, scheduled_at)
      where status in ('scheduled','queued','processing');
    create table job_queue(id uuid primary key default gen_random_uuid(), job_type text, platform text, platform_account_id uuid,
      schedule_id uuid references schedules(id), run_at timestamptz, payload jsonb default '{}', attempts integer default 0,
      max_attempts integer default 5, status text default 'pending', last_error text, locked_at timestamptz, locked_by text,
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table reel_test_publications(id uuid, linked_schedule_id uuid, trial_kind text, status text, container_id text,
      instagram_media_id text, locked_at timestamptz);
    create table production_jobs(result_video_id uuid, user_id uuid, status text);
    create table latest_instagram_metrics(platform_account_id uuid, media_product_type text, views bigint, posted_at timestamptz);
    create table test_vault(id uuid primary key, token text);
    create function set_instagram_page_token_for_account(p_account_id uuid, p_token text)
      returns void language plpgsql as $$ begin
      if p_token='error' then raise exception 'test_vault_error'; end if;
      insert into test_vault values(p_account_id,p_token) on conflict(id) do update set token=excluded.token;
    end $$;
    create function has_instagram_page_token_for_account(p_account_id uuid)
      returns boolean language sql as $$ select exists(select 1 from test_vault where id=p_account_id) $$;
    create function is_instagram_calendar_caption(value text) returns boolean language sql as $$select value is not null and value <> ''$$;
    create function pick_instagram_calendar_caption() returns text language sql as $$select 'Legenda automática'$$;
    insert into workspaces values ('${workspace}'),('${otherWorkspace}');
    insert into app_members values ('${owner}','${workspace}',true,'admin'),('${other}','${otherWorkspace}',true,'admin');
    insert into platform_accounts(id, platform, external_account_id, account_label, enabled, workspace_id, owner_user_id, config)
      values ('${mother}','instagram','100','jujuhmartinss',true,'${workspace}','${owner}',
        '{"calendar_policy":{"enabled":true,"locked":true,"timezone":"America/Recife","times":["07:30","10:00","13:00","16:00","18:30"]}}');
    insert into test_vault values ('${mother}','original');
    grant select on app_members, app_settings, platform_accounts, workspaces to service_role;
  `);
  await exec('begin;'+migration+'commit;');
  await exec(`
    create trigger trg_ensure_instagram_caption_on_schedule_insert after insert on schedules
      for each row execute function ensure_instagram_caption_on_schedule_insert();
  `);
  // The Trial trigger's child guard must work before it touches any legacy Trial columns.
  await exec(`
    create trigger test_scale_trial after insert on schedules for each row
      when (new.instagram_scale_caption is not null) execute function sync_calendar_pretrial_from_schedule();
  `);
  const add = async (name, number) => (await one(`
    with v as (insert into videos(storage_path,file_name,caption,platform_account_id) values ($1,$1,$2,$3) returning id),
    s as (insert into schedules(video_id,scheduled_at,status,platform,platform_account_id,smart_mode,smart_strategy)
      select id,date_trunc('day',now()) + ($4::int + 5)*interval '1 day','scheduled','instagram',$3,'manual','manual' from v returning id,scheduled_at)
    insert into job_queue(job_type,platform,platform_account_id,schedule_id,run_at)
    select 'publish_reel','instagram',$3,id,scheduled_at from s returning schedule_id
  `, [name,'Legenda '+name,mother,number])).schedule_id;

  await add('antigo',0);
  await assert.rejects(connect('301',mother,other),/instagram_mother_unavailable/);
  await assert.rejects(connect('301',mother,owner,null,'error'),/test_vault_error/);
  assert.equal((await one("select count(*)::int n from platform_accounts where external_account_id='301'")).n,0);
  const child1 = await connect('301');
  await add('antes da segunda filha',1);
  assert.equal((await one('select count(*)::int n from instagram_scale_sources')).n,0);
  const child2 = await connect('302');
  await assert.rejects(connect('303'),/instagram_daughter_limit/);
  await assert.rejects(connect('100'),/instagram_already_linked/);
  await assert.rejects(connect('301',null),/instagram_already_connected/);
  await assert.rejects(connect('301',null,other,child1),/instagram_scope_denied/);
  await assert.rejects(connect('302',null,owner,child1),/reconnect_account_mismatch/);
  assert.equal(await connect('301',null,owner,child1),child1);
  assert.equal((await one('select token from test_vault where id=$1',[mother])).token,'original');

  const names = [...'ABCDEFGHIJ'];
  const first = await add(names[0],2);
  assert.equal((await distribute()).placed,0);
  assert.equal((await one('select instagram_scale_media_pending(video_id) as pending from schedules where id=$1',[first])).pending,true);
  await add(names[1],3);
  assert.equal((await distribute()).placed,0);
  for(let index=2;index<names.length;index++)await add(names[index],index+2);
  assert.equal((await distribute()).placed,20);
  assert.equal((await distribute()).placed,0);
  const order = async id => (await rows(`
    select v.file_name from schedules s join videos v on v.id=s.video_id
    where s.platform_account_id=$1 and s.status<>'cancelled' order by s.scheduled_at
  `, [id])).map(r=>r.file_name);
  assert.deepEqual(await order(mother), ['antigo','antes da segunda filha',...names]);
  assert.deepEqual(await order(child1), [...names.slice(1),names[0]]);
  assert.deepEqual(await order(child2), [...names.slice(2),...names.slice(0,2)]);
  assert.equal((await one('select count(*)::int n from videos')).n,12);
  assert.equal((await one('select count(*)::int n from instagram_scale_deliveries where schedule_id is not null')).n,20);
  assert.equal((await one('select instagram_scale_media_pending(video_id) as pending from schedules where id=$1',[first])).pending,false);

  await db.close();
  db = new PGlite(dir);
  assert.deepEqual(await order(child1), [...names.slice(1),names[0]]);
  await exec(`update instagram_scale_links set sync_enabled=false where child_id='${child1}'`);
  for(const [i,name] of [...'KLM'].entries())await add(name,i+12);
  assert.equal((await distribute()).placed,3);
  assert.deepEqual((await order(child2)).slice(-3), [...'MKL']);
  await exec(`update instagram_scale_links set sync_enabled=true where child_id='${child1}'`);
  assert.equal((await distribute()).placed,3);
  assert.deepEqual((await order(child1)).slice(-3), [...'LMK']);

  const target = await one('select id,video_id from schedules where platform_account_id=$1 order by scheduled_at limit 1',[child1]);
  const sibling = await one('select id from schedules where platform_account_id=$1 and video_id=$2',[child2,target.video_id]);
  await assert.rejects(rows('select set_calendar_trial_video($1,null,$2)',[target.id,owner]),/instagram_scale_trial_unavailable/);
  assert.equal((await one('select instagram_scale_cancel($1,$2) as cancelled',[target.id,owner])).cancelled,true);
  assert.equal((await one('select status from schedules where id=$1',[sibling.id])).status,'scheduled');
  assert.equal((await one('select count(*)::int n from schedules where video_id=$1',[target.video_id])).n,3);

  await exec(`update schedules set scheduled_at=now()-interval '1 day' where id='${sibling.id}';
    update job_queue set run_at=now()-interval '1 day' where schedule_id='${sibling.id}';`);
  assert.equal((await one('select id from instagram_scale_due($1)',[child2])).id,sibling.id);
  assert.equal((await rows("select * from claim_due_publish_jobs('legacy',10)")).some(j=>j.schedule_id===sibling.id),false);
  const claim = await one("select * from claim_calendar_publish_schedule($1,'worker')",[sibling.id]);
  assert.ok(claim.id);
  assert.equal((await rows("select * from claim_calendar_publish_schedule($1,'other')",[sibling.id])).length,0);
  await assert.rejects(rows("select instagram_scale_finish($1,'worker',$2)",[claim.id,{instagram_media_id:'900',published_at:new Date().toISOString()}]),/receipt_missing/);
  await exec(`update job_queue set status='failed',locked_at=null,locked_by=null,payload='{"publish_started_at":"yes"}' where id='${claim.id}';`);
  assert.equal((await rows('select * from instagram_scale_due($1)',[child2])).length,0);
  await assert.rejects(rows('select instagram_scale_edit_schedule($1,$2,null,true)',[sibling.id,owner]),/publication_started/);
  const receipt = {instagram_media_id:'900',published_at:new Date().toISOString()};
  await rows("update job_queue set locked_by='worker',payload=$1 where id=$2",[receipt,claim.id]);
  await rows("select instagram_scale_finish($1,'worker',$2)",[claim.id,receipt]);
  assert.equal((await one('select instagram_media_id from schedules where id=$1',[sibling.id])).instagram_media_id,'900');

  const summary = await rows("select * from instagram_scale_summary($1,now()-interval '30 days',now()+interval '1 day')",[owner]);
  assert.equal(summary.length,3);
  assert.equal(Number(summary.find(a=>a.id===child2).published),1);
  assert.equal((await rows("select * from instagram_scale_summary($1,now()-interval '30 days',now()+interval '1 day')",[other])).length,0);
  assert.equal((await one("select has_table_privilege('authenticated','instagram_scale_links','select') as allowed")).allowed,false);
  console.log('PASS: conexão atômica, isolamento, duas filhas, 1/2/10 vídeos, permutações, persistência, pausa, cancelamento, Trial bloqueado, lease, recibo e métricas.');
} catch(error) {
  console.error(error.message, error.where||"", error.query||"");
  process.exitCode=1;
} finally {
  await db.close();
  rmSync(dir,{recursive:true,force:true});
}
