set check_function_bodies=false;
create or replace function public.cloudent_x_member_info(p_user uuid) returns table(user_id uuid,workspace_id uuid,role text,enabled boolean) language sql stable security invoker set search_path='' as $$select m.user_id,m.workspace_id,m.role,m.enabled from public.app_members m where m.user_id=p_user and m.enabled$$;
create or replace function public.cloudent_x_access(p_user uuid,p_account uuid) returns boolean language sql stable security invoker set search_path='' as $$select exists(select 1 from public.app_members m join public.platform_accounts a on a.workspace_id=m.workspace_id where m.user_id=p_user and m.enabled and m.role in ('admin','x_user') and a.id=p_account and a.platform='x' and (a.owner_user_id=p_user or exists(select 1 from public.x_account_access g where g.user_id=p_user and g.platform_account_id=a.id and g.workspace_id=m.workspace_id)))$$;
create or replace function public.cloudent_x_read_access(p_user uuid,p_account uuid) returns boolean language sql stable security invoker set search_path='' as $$select exists(select 1 from public.app_members m join public.platform_accounts a on a.workspace_id=m.workspace_id where m.user_id=p_user and m.enabled and m.role in ('admin','x_user') and a.id=p_account and a.platform='x' and (m.role='admin' or a.owner_user_id=p_user or exists(select 1 from public.x_account_access g where g.user_id=p_user and g.platform_account_id=a.id and g.workspace_id=m.workspace_id)))$$;

revoke all on function public.cloudent_x_member_info(uuid),public.cloudent_x_access(uuid,uuid),public.cloudent_x_read_access(uuid,uuid) from public,anon,authenticated;grant execute on function public.cloudent_x_member_info(uuid),public.cloudent_x_access(uuid,uuid),public.cloudent_x_read_access(uuid,uuid) to service_role;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='cloudent_private.rate_limits'::regclass and conname='rate_limits_pkey') then ALTER TABLE ONLY cloudent_private.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (user_id, bucket, window_start); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.activity_logs'::regclass and conname='activity_logs_pkey') then ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.app_members'::regclass and conname='app_members_pkey') then ALTER TABLE ONLY public.app_members
    ADD CONSTRAINT app_members_pkey PRIMARY KEY (user_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.app_settings'::regclass and conname='app_settings_key_key') then ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_key_key UNIQUE (key); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.app_settings'::regclass and conname='app_settings_pkey') then ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.comments'::regclass and conname='comments_instagram_comment_id_key') then ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_instagram_comment_id_key UNIQUE (instagram_comment_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.comments'::regclass and conname='comments_pkey') then ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.face_swap_jobs'::regclass and conname='face_swap_jobs_pkey') then ALTER TABLE ONLY public.face_swap_jobs
    ADD CONSTRAINT face_swap_jobs_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.google_drive_connections'::regclass and conname='google_drive_connections_pkey') then ALTER TABLE ONLY public.google_drive_connections
    ADD CONSTRAINT google_drive_connections_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.google_drive_connections'::regclass and conname='google_drive_connections_user_id_key') then ALTER TABLE ONLY public.google_drive_connections
    ADD CONSTRAINT google_drive_connections_user_id_key UNIQUE (user_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.google_drive_oauth_states'::regclass and conname='google_drive_oauth_states_pkey') then ALTER TABLE ONLY public.google_drive_oauth_states
    ADD CONSTRAINT google_drive_oauth_states_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.google_drive_oauth_states'::regclass and conname='google_drive_oauth_states_state_hash_key') then ALTER TABLE ONLY public.google_drive_oauth_states
    ADD CONSTRAINT google_drive_oauth_states_state_hash_key UNIQUE (state_hash); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.instagram_follower_daily'::regclass and conname='instagram_follower_daily_pkey') then ALTER TABLE ONLY public.instagram_follower_daily
    ADD CONSTRAINT instagram_follower_daily_pkey PRIMARY KEY (account_id, day); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.instagram_follower_state'::regclass and conname='instagram_follower_state_pkey') then ALTER TABLE ONLY public.instagram_follower_state
    ADD CONSTRAINT instagram_follower_state_pkey PRIMARY KEY (account_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.instagram_media'::regclass and conname='instagram_media_ig_media_id_key') then ALTER TABLE ONLY public.instagram_media
    ADD CONSTRAINT instagram_media_ig_media_id_key UNIQUE (ig_media_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.instagram_media'::regclass and conname='instagram_media_pkey') then ALTER TABLE ONLY public.instagram_media
    ADD CONSTRAINT instagram_media_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.instagram_metrics_sync_state'::regclass and conname='instagram_metrics_sync_state_pkey') then ALTER TABLE ONLY public.instagram_metrics_sync_state
    ADD CONSTRAINT instagram_metrics_sync_state_pkey PRIMARY KEY (account_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.instagram_story_monitor'::regclass and conname='instagram_story_monitor_pkey') then ALTER TABLE ONLY public.instagram_story_monitor
    ADD CONSTRAINT instagram_story_monitor_pkey PRIMARY KEY (account_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.integrations'::regclass and conname='integrations_pkey') then ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.integrations'::regclass and conname='integrations_provider_key') then ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_provider_key UNIQUE (provider); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.job_queue'::regclass and conname='job_queue_pkey') then ALTER TABLE ONLY public.job_queue
    ADD CONSTRAINT job_queue_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.media_access_daily'::regclass and conname='media_access_daily_pkey') then ALTER TABLE ONLY public.media_access_daily
    ADD CONSTRAINT media_access_daily_pkey PRIMARY KEY (user_id, day); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.member_invites'::regclass and conname='member_invites_pkey') then ALTER TABLE ONLY public.member_invites
    ADD CONSTRAINT member_invites_pkey PRIMARY KEY (email); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.metrics_snapshots'::regclass and conname='metrics_snapshots_pkey') then ALTER TABLE ONLY public.metrics_snapshots
    ADD CONSTRAINT metrics_snapshots_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.motion_storage_health'::regclass and conname='motion_storage_health_pkey') then ALTER TABLE ONLY public.motion_storage_health
    ADD CONSTRAINT motion_storage_health_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.motion_storage_reservations'::regclass and conname='motion_storage_reservations_pkey') then ALTER TABLE ONLY public.motion_storage_reservations
    ADD CONSTRAINT motion_storage_reservations_pkey PRIMARY KEY (job_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.platform_accounts'::regclass and conname='platform_accounts_pkey') then ALTER TABLE ONLY public.platform_accounts
    ADD CONSTRAINT platform_accounts_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.platform_accounts'::regclass and conname='platform_accounts_platform_external_account_id_key') then ALTER TABLE ONLY public.platform_accounts
    ADD CONSTRAINT platform_accounts_platform_external_account_id_key UNIQUE (platform, external_account_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.production_jobs'::regclass and conname='production_jobs_pkey') then ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.push_subscriptions'::regclass and conname='push_subscriptions_endpoint_key') then ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.push_subscriptions'::regclass and conname='push_subscriptions_pkey') then ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.reel_test_publications'::regclass and conname='reel_test_publications_pkey') then ALTER TABLE ONLY public.reel_test_publications
    ADD CONSTRAINT reel_test_publications_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.schedules'::regclass and conname='schedules_pkey') then ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_recommendations'::regclass and conname='smart_recommendations_pkey') then ALTER TABLE ONLY public.smart_recommendations
    ADD CONSTRAINT smart_recommendations_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_samples'::regclass and conname='smart_samples_pkey') then ALTER TABLE ONLY public.smart_samples
    ADD CONSTRAINT smart_samples_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_time_history'::regclass and conname='smart_time_history_pkey') then ALTER TABLE ONLY public.smart_time_history
    ADD CONSTRAINT smart_time_history_pkey PRIMARY KEY (id); end if; end $restore$;

set check_function_bodies=true;
