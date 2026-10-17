do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_samples'::regclass and conname='smart_samples_platform_account_id_fkey') then ALTER TABLE ONLY public.smart_samples
    ADD CONSTRAINT smart_samples_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_samples'::regclass and conname='smart_samples_schedule_id_fkey') then ALTER TABLE ONLY public.smart_samples
    ADD CONSTRAINT smart_samples_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_time_history'::regclass and conname='smart_time_history_platform_account_id_fkey') then ALTER TABLE ONLY public.smart_time_history
    ADD CONSTRAINT smart_time_history_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_time_history'::regclass and conname='smart_time_history_validation_id_fkey') then ALTER TABLE ONLY public.smart_time_history
    ADD CONSTRAINT smart_time_history_validation_id_fkey FOREIGN KEY (validation_id) REFERENCES public.smart_time_validation(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.smart_time_validation'::regclass and conname='smart_time_validation_platform_account_id_fkey') then ALTER TABLE ONLY public.smart_time_validation
    ADD CONSTRAINT smart_time_validation_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.system_notifications'::regclass and conname='system_notifications_user_id_fkey') then ALTER TABLE ONLY public.system_notifications
    ADD CONSTRAINT system_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.videos'::regclass and conname='videos_platform_account_id_fkey') then ALTER TABLE ONLY public.videos
    ADD CONSTRAINT videos_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.viral_foryou_items'::regclass and conname='viral_foryou_items_source_account_id_fkey') then ALTER TABLE ONLY public.viral_foryou_items
    ADD CONSTRAINT viral_foryou_items_source_account_id_fkey FOREIGN KEY (source_account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.viral_foryou_settings'::regclass and conname='viral_foryou_settings_source_account_id_fkey') then ALTER TABLE ONLY public.viral_foryou_settings
    ADD CONSTRAINT viral_foryou_settings_source_account_id_fkey FOREIGN KEY (source_account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.viral_foryou_worker_auth'::regclass and conname='viral_foryou_worker_auth_source_account_id_fkey') then ALTER TABLE ONLY public.viral_foryou_worker_auth
    ADD CONSTRAINT viral_foryou_worker_auth_source_account_id_fkey FOREIGN KEY (source_account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.workspaces'::regclass and conname='workspaces_owner_user_id_fkey') then ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_account_access'::regclass and conname='x_account_access_platform_account_id_fkey') then ALTER TABLE ONLY public.x_account_access
    ADD CONSTRAINT x_account_access_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_account_access'::regclass and conname='x_account_access_user_id_fkey') then ALTER TABLE ONLY public.x_account_access
    ADD CONSTRAINT x_account_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_account_access'::regclass and conname='x_account_access_workspace_id_fkey') then ALTER TABLE ONLY public.x_account_access
    ADD CONSTRAINT x_account_access_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_account_configs'::regclass and conname='x_account_configs_platform_account_id_fkey') then ALTER TABLE ONLY public.x_account_configs
    ADD CONSTRAINT x_account_configs_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_account_configs'::regclass and conname='x_account_configs_user_id_fkey') then ALTER TABLE ONLY public.x_account_configs
    ADD CONSTRAINT x_account_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_account_configs'::regclass and conname='x_account_configs_workspace_id_fkey') then ALTER TABLE ONLY public.x_account_configs
    ADD CONSTRAINT x_account_configs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_audit_log'::regclass and conname='x_audit_log_platform_account_id_fkey') then ALTER TABLE ONLY public.x_audit_log
    ADD CONSTRAINT x_audit_log_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_audit_log'::regclass and conname='x_audit_log_user_id_fkey') then ALTER TABLE ONLY public.x_audit_log
    ADD CONSTRAINT x_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_audit_log'::regclass and conname='x_audit_log_workspace_id_fkey') then ALTER TABLE ONLY public.x_audit_log
    ADD CONSTRAINT x_audit_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_drive_posts'::regclass and conname='x_drive_posts_platform_account_id_fkey') then ALTER TABLE ONLY public.x_drive_posts
    ADD CONSTRAINT x_drive_posts_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_drive_posts'::regclass and conname='x_drive_posts_user_id_fkey') then ALTER TABLE ONLY public.x_drive_posts
    ADD CONSTRAINT x_drive_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_drive_posts'::regclass and conname='x_drive_posts_workspace_id_fkey') then ALTER TABLE ONLY public.x_drive_posts
    ADD CONSTRAINT x_drive_posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id); end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_oauth_states'::regclass and conname='x_oauth_states_user_id_fkey') then ALTER TABLE ONLY public.x_oauth_states
    ADD CONSTRAINT x_oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_publish_configs'::regclass and conname='x_publish_configs_platform_account_id_fkey') then ALTER TABLE ONLY public.x_publish_configs
    ADD CONSTRAINT x_publish_configs_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_publish_configs'::regclass and conname='x_publish_configs_user_id_fkey') then ALTER TABLE ONLY public.x_publish_configs
    ADD CONSTRAINT x_publish_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_accounts'::regclass and conname='x_warmup_accounts_platform_account_id_fkey') then ALTER TABLE ONLY public.x_warmup_accounts
    ADD CONSTRAINT x_warmup_accounts_platform_account_id_fkey FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE SET NULL; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_accounts'::regclass and conname='x_warmup_accounts_user_id_fkey') then ALTER TABLE ONLY public.x_warmup_accounts
    ADD CONSTRAINT x_warmup_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_actions'::regclass and conname='x_warmup_actions_user_id_fkey') then ALTER TABLE ONLY public.x_warmup_actions
    ADD CONSTRAINT x_warmup_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_actions'::regclass and conname='x_warmup_actions_warmup_account_id_fkey') then ALTER TABLE ONLY public.x_warmup_actions
    ADD CONSTRAINT x_warmup_actions_warmup_account_id_fkey FOREIGN KEY (warmup_account_id) REFERENCES public.x_warmup_accounts(id) ON DELETE CASCADE; end if; end $restore$;
do $restore$ begin if not exists(select 1 from pg_constraint where conrelid='public.x_warmup_days'::regclass and conname='x_warmup_days_user_id_fkey') then ALTER TABLE ONLY public.x_warmup_days
    ADD CONSTRAINT x_warmup_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; end if; end $restore$;
