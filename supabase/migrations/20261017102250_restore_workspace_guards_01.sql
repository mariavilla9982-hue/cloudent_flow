do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.app_members'::regclass and conname='app_members_user_id_fkey') then ALTER TABLE ONLY public.app_members
    ADD CONSTRAINT app_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.app_members'::regclass and conname='app_members_workspace_id_fkey') then ALTER TABLE ONLY public.app_members
    ADD CONSTRAINT app_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.comments'::regclass and conname='comments_schedule_id_fkey') then ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.face_swap_jobs'::regclass and conname='face_swap_jobs_production_job_id_fkey') then ALTER TABLE ONLY public.face_swap_jobs
    ADD CONSTRAINT face_swap_jobs_production_job_id_fkey FOREIGN KEY (production_job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.face_swap_jobs'::regclass and conname='face_swap_jobs_user_id_fkey') then ALTER TABLE ONLY public.face_swap_jobs
    ADD CONSTRAINT face_swap_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.google_drive_connections'::regclass and conname='google_drive_connections_user_id_fkey') then ALTER TABLE ONLY public.google_drive_connections
    ADD CONSTRAINT google_drive_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.google_drive_oauth_states'::regclass and conname='google_drive_oauth_states_user_id_fkey') then ALTER TABLE ONLY public.google_drive_oauth_states
    ADD CONSTRAINT google_drive_oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.instagram_media'::regclass and conname='instagram_media_platform_account_id_fkey') then ALTER TABLE ONLY public.instagram_media
    ADD CONSTRAINT instagram_media_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.instagram_metrics_sync_state'::regclass and conname='instagram_metrics_sync_state_account_id_fkey') then ALTER TABLE ONLY public.instagram_metrics_sync_state
    ADD CONSTRAINT instagram_metrics_sync_state_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.instagram_story_monitor'::regclass and conname='instagram_story_monitor_account_id_fkey') then ALTER TABLE ONLY public.instagram_story_monitor
    ADD CONSTRAINT instagram_story_monitor_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.job_queue'::regclass and conname='job_queue_comment_id_fkey') then ALTER TABLE ONLY public.job_queue
    ADD CONSTRAINT job_queue_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.comments(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.job_queue'::regclass and conname='job_queue_platform_account_id_fkey') then ALTER TABLE ONLY public.job_queue
    ADD CONSTRAINT job_queue_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.job_queue'::regclass and conname='job_queue_schedule_id_fkey') then ALTER TABLE ONLY public.job_queue
    ADD CONSTRAINT job_queue_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.media_access_daily'::regclass and conname='media_access_daily_user_id_fkey') then ALTER TABLE ONLY public.media_access_daily
    ADD CONSTRAINT media_access_daily_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.member_invites'::regclass and conname='member_invites_claimed_by_fkey') then ALTER TABLE ONLY public.member_invites
    ADD CONSTRAINT member_invites_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.member_invites'::regclass and conname='member_invites_invited_by_fkey') then ALTER TABLE ONLY public.member_invites
    ADD CONSTRAINT member_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.member_invites'::regclass and conname='member_invites_workspace_id_fkey') then ALTER TABLE ONLY public.member_invites
    ADD CONSTRAINT member_invites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.metrics_snapshots'::regclass and conname='metrics_snapshots_instagram_media_record_id_fkey') then ALTER TABLE ONLY public.metrics_snapshots
    ADD CONSTRAINT metrics_snapshots_instagram_media_record_id_fkey FOREIGN KEY (instagram_media_record_id) REFERENCES public.instagram_media(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.metrics_snapshots'::regclass and conname='metrics_snapshots_schedule_id_fkey') then ALTER TABLE ONLY public.metrics_snapshots
    ADD CONSTRAINT metrics_snapshots_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.metrics_snapshots'::regclass and conname='metrics_snapshots_trial_publication_id_fkey') then ALTER TABLE ONLY public.metrics_snapshots
    ADD CONSTRAINT metrics_snapshots_trial_publication_id_fkey FOREIGN KEY (trial_publication_id) REFERENCES public.reel_test_publications(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.motion_storage_reservations'::regclass and conname='motion_storage_reservations_user_id_fkey') then ALTER TABLE ONLY public.motion_storage_reservations
    ADD CONSTRAINT motion_storage_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.platform_accounts'::regclass and conname='platform_accounts_owner_user_id_fkey') then ALTER TABLE ONLY public.platform_accounts
    ADD CONSTRAINT platform_accounts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.platform_accounts'::regclass and conname='platform_accounts_workspace_id_fkey') then ALTER TABLE ONLY public.platform_accounts
    ADD CONSTRAINT platform_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.production_jobs'::regclass and conname='production_jobs_result_video_id_fkey') then ALTER TABLE ONLY public.production_jobs
    ADD CONSTRAINT production_jobs_result_video_id_fkey FOREIGN KEY (result_video_id) REFERENCES public.videos(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.push_subscriptions'::regclass and conname='push_subscriptions_user_id_fkey') then ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.reel_test_publications'::regclass and conname='reel_test_publications_linked_schedule_id_fkey') then ALTER TABLE ONLY public.reel_test_publications
    ADD CONSTRAINT reel_test_publications_linked_schedule_id_fkey FOREIGN KEY (linked_schedule_id) REFERENCES public.schedules(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.reel_test_publications'::regclass and conname='reel_test_publications_source_video_id_fkey') then ALTER TABLE ONLY public.reel_test_publications
    ADD CONSTRAINT reel_test_publications_source_video_id_fkey FOREIGN KEY (source_video_id) REFERENCES public.videos(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.schedules'::regclass and conname='schedules_platform_account_id_fkey') then ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.schedules'::regclass and conname='schedules_video_id_fkey') then ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_recommendations'::regclass and conname='smart_recommendations_platform_account_id_fkey') then ALTER TABLE ONLY public.smart_recommendations
    ADD CONSTRAINT smart_recommendations_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_samples'::regclass and conname='smart_samples_instagram_media_record_id_fkey') then ALTER TABLE ONLY public.smart_samples
    ADD CONSTRAINT smart_samples_instagram_media_record_id_fkey FOREIGN KEY (instagram_media_record_id) REFERENCES public.instagram_media(id) ON DELETE CASCADE; end if; end $restore$;
