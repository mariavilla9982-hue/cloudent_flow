set check_function_bodies=false;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_time_validation'::regclass and conname='smart_time_validation_pkey') then ALTER TABLE ONLY public.smart_time_validation
    ADD CONSTRAINT smart_time_validation_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.system_notifications'::regclass and conname='system_notifications_dedupe_key_key') then ALTER TABLE ONLY public.system_notifications
    ADD CONSTRAINT system_notifications_dedupe_key_key UNIQUE (dedupe_key); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.system_notifications'::regclass and conname='system_notifications_pkey') then ALTER TABLE ONLY public.system_notifications
    ADD CONSTRAINT system_notifications_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.trial_time_recommendations'::regclass and conname='trial_time_recommendations_pkey') then ALTER TABLE ONLY public.trial_time_recommendations
    ADD CONSTRAINT trial_time_recommendations_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.trial_time_recommendations'::regclass and conname='trial_time_recommendations_weekday_rank_key') then ALTER TABLE ONLY public.trial_time_recommendations
    ADD CONSTRAINT trial_time_recommendations_weekday_rank_key UNIQUE (weekday, rank); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.videos'::regclass and conname='videos_pkey') then ALTER TABLE ONLY public.videos
    ADD CONSTRAINT videos_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.videos'::regclass and conname='videos_storage_path_key') then ALTER TABLE ONLY public.videos
    ADD CONSTRAINT videos_storage_path_key UNIQUE (storage_path); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.viral_foryou_items'::regclass and conname='viral_foryou_items_pkey') then ALTER TABLE ONLY public.viral_foryou_items
    ADD CONSTRAINT viral_foryou_items_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.viral_foryou_items'::regclass and conname='viral_foryou_items_source_account_id_shortcode_key') then ALTER TABLE ONLY public.viral_foryou_items
    ADD CONSTRAINT viral_foryou_items_source_account_id_shortcode_key UNIQUE (source_account_id, shortcode); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.viral_foryou_settings'::regclass and conname='viral_foryou_settings_pkey') then ALTER TABLE ONLY public.viral_foryou_settings
    ADD CONSTRAINT viral_foryou_settings_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.viral_foryou_settings'::regclass and conname='viral_foryou_settings_source_account_id_key') then ALTER TABLE ONLY public.viral_foryou_settings
    ADD CONSTRAINT viral_foryou_settings_source_account_id_key UNIQUE (source_account_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.viral_foryou_worker_auth'::regclass and conname='viral_foryou_worker_auth_pkey') then ALTER TABLE ONLY public.viral_foryou_worker_auth
    ADD CONSTRAINT viral_foryou_worker_auth_pkey PRIMARY KEY (source_account_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.worker_runtime'::regclass and conname='worker_runtime_pkey') then ALTER TABLE ONLY public.worker_runtime
    ADD CONSTRAINT worker_runtime_pkey PRIMARY KEY (worker_name); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.workspaces'::regclass and conname='workspaces_pkey') then ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.workspaces'::regclass and conname='workspaces_slug_key') then ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_account_access'::regclass and conname='x_account_access_pkey') then ALTER TABLE ONLY public.x_account_access
    ADD CONSTRAINT x_account_access_pkey PRIMARY KEY (user_id, platform_account_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_account_configs'::regclass and conname='x_account_configs_pkey') then ALTER TABLE ONLY public.x_account_configs
    ADD CONSTRAINT x_account_configs_pkey PRIMARY KEY (platform_account_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_audit_log'::regclass and conname='x_audit_log_pkey') then ALTER TABLE ONLY public.x_audit_log
    ADD CONSTRAINT x_audit_log_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_drive_posts'::regclass and conname='x_drive_posts_pkey') then ALTER TABLE ONLY public.x_drive_posts
    ADD CONSTRAINT x_drive_posts_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_drive_posts'::regclass and conname='x_drive_posts_source_account_unique') then ALTER TABLE ONLY public.x_drive_posts
    ADD CONSTRAINT x_drive_posts_source_account_unique UNIQUE (user_id, drive_file_id, platform_account_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_oauth_states'::regclass and conname='x_oauth_states_pkey') then ALTER TABLE ONLY public.x_oauth_states
    ADD CONSTRAINT x_oauth_states_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_oauth_states'::regclass and conname='x_oauth_states_state_hash_key') then ALTER TABLE ONLY public.x_oauth_states
    ADD CONSTRAINT x_oauth_states_state_hash_key UNIQUE (state_hash); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_publish_configs'::regclass and conname='x_publish_configs_pkey') then ALTER TABLE ONLY public.x_publish_configs
    ADD CONSTRAINT x_publish_configs_pkey PRIMARY KEY (user_id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_accounts'::regclass and conname='x_warmup_accounts_pkey') then ALTER TABLE ONLY public.x_warmup_accounts
    ADD CONSTRAINT x_warmup_accounts_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_accounts'::regclass and conname='x_warmup_accounts_user_id_username_key') then ALTER TABLE ONLY public.x_warmup_accounts
    ADD CONSTRAINT x_warmup_accounts_user_id_username_key UNIQUE (user_id, username); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_actions'::regclass and conname='x_warmup_actions_pkey') then ALTER TABLE ONLY public.x_warmup_actions
    ADD CONSTRAINT x_warmup_actions_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_days'::regclass and conname='x_warmup_days_pkey') then ALTER TABLE ONLY public.x_warmup_days
    ADD CONSTRAINT x_warmup_days_pkey PRIMARY KEY (id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_days'::regclass and conname='x_warmup_days_warmup_account_id_day_number_key') then ALTER TABLE ONLY public.x_warmup_days
    ADD CONSTRAINT x_warmup_days_warmup_account_id_day_number_key UNIQUE (warmup_account_id, day_number); end if; end $restore$;
CREATE UNIQUE INDEX IF NOT EXISTS face_swap_jobs_production_job_unique_idx ON public.face_swap_jobs USING btree (production_job_id) WHERE (production_job_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS face_swap_jobs_status_retry_idx ON public.face_swap_jobs USING btree (status, next_attempt_at) WHERE (status = ANY (ARRAY['waiting'::text, 'uploading'::text, 'queued'::text, 'running'::text]));
CREATE INDEX IF NOT EXISTS face_swap_jobs_user_created_idx ON public.face_swap_jobs USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS google_drive_connections_folder_idx ON public.google_drive_connections USING btree (user_id, folder_id) WHERE (folder_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS google_drive_oauth_states_exp_idx ON public.google_drive_oauth_states USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_comments_schedule ON public.comments USING btree (schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_media_posted_at ON public.instagram_media USING btree (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_media_posted_at2 ON public.instagram_media USING btree (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_queue_comment_id ON public.job_queue USING btree (comment_id);
CREATE INDEX IF NOT EXISTS idx_job_queue_publish_due ON public.job_queue USING btree (run_at) WHERE ((job_type = 'publish_reel'::text) AND (status = 'pending'::text));
CREATE INDEX IF NOT EXISTS idx_job_queue_schedule_id ON public.job_queue USING btree (schedule_id);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON public.job_queue USING btree (status, run_at);
CREATE INDEX IF NOT EXISTS idx_logs_created ON public.activity_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_access_daily_day ON public.media_access_daily USING btree (day DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_collected_at ON public.metrics_snapshots USING btree (collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_instagram_media ON public.metrics_snapshots USING btree (instagram_media_record_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_schedule_time ON public.metrics_snapshots USING btree (schedule_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_trial ON public.metrics_snapshots USING btree (trial_publication_id, collected_at DESC) WHERE (trial_publication_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_production_jobs_inputs_cleanup ON public.production_jobs USING btree (result_video_id, inputs_deleted_at) WHERE ((inputs_deleted_at IS NULL) AND (result_video_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_production_jobs_status_next ON public.production_jobs USING btree (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_production_jobs_task ON public.production_jobs USING btree (runninghub_task_id) WHERE (runninghub_task_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_production_jobs_user_created ON public.production_jobs USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_jobs_visible ON public.production_jobs USING btree (user_id, created_at DESC) WHERE (hidden_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_reel_test_publications_created ON public.reel_test_publications USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_test_retention_cleanup ON public.reel_test_publications USING btree (published_at, storage_deleted_at) WHERE ((status = 'published'::text) AND (storage_deleted_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_schedules_due ON public.schedules USING btree (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_schedules_platform_account_scheduled_at ON public.schedules USING btree (platform_account_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_video_id ON public.schedules USING btree (video_id);
CREATE INDEX IF NOT EXISTS idx_smart_recommendations_platform_account ON public.smart_recommendations USING btree (platform_account_id, weekday, rank);
CREATE INDEX IF NOT EXISTS idx_smart_samples_day_time ON public.smart_samples USING btree (weekday, sample_time, sample_date DESC);
CREATE INDEX IF NOT EXISTS idx_smart_samples_platform_account ON public.smart_samples USING btree (platform_account_id, sample_date DESC);

set check_function_bodies=true;
