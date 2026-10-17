set check_function_bodies=false;
CREATE INDEX IF NOT EXISTS idx_smart_samples_schedule_id ON public.smart_samples USING btree (schedule_id);
CREATE INDEX IF NOT EXISTS idx_smart_time_history_platform_account ON public.smart_time_history USING btree (platform_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smart_time_validation_platform_account ON public.smart_time_validation USING btree (platform_account_id, weekday, rank);
CREATE INDEX IF NOT EXISTS idx_trial_reels_due ON public.reel_test_publications USING btree (COALESCE(next_attempt_at, scheduled_at, created_at)) WHERE (status = ANY (ARRAY['scheduled'::text, 'processing'::text, 'container_created'::text]));
CREATE INDEX IF NOT EXISTS idx_trial_reels_metrics_due ON public.reel_test_publications USING btree (next_metric_at) WHERE ((status = 'published'::text) AND (next_metric_at IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_trial_visible_week ON public.reel_test_publications USING btree (user_id, scheduled_at) WHERE (hidden_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_videos_hot_cached_at ON public.videos USING btree (hot_cached_at) WHERE (hot_cached_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_videos_retention_cleanup ON public.videos USING btree (storage_deleted_at) WHERE ((storage_deleted_at IS NULL) AND (status = 'published'::text));
CREATE INDEX IF NOT EXISTS instagram_media_platform_account_id_idx ON public.instagram_media USING btree (platform_account_id);
CREATE INDEX IF NOT EXISTS ix_follower_daily_day ON public.instagram_follower_daily USING btree (day DESC);
CREATE INDEX IF NOT EXISTS job_queue_platform_account_id_idx ON public.job_queue USING btree (platform_account_id);
CREATE INDEX IF NOT EXISTS platform_accounts_workspace_owner ON public.platform_accounts USING btree (workspace_id, owner_user_id, platform);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_enabled_idx ON public.push_subscriptions USING btree (user_id, enabled);
CREATE UNIQUE INDEX IF NOT EXISTS reel_test_prepost_schedule_uidx ON public.reel_test_publications USING btree (linked_schedule_id) WHERE ((trial_kind = 'prepost'::text) AND (linked_schedule_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS reel_test_prepost_source_video_idx ON public.reel_test_publications USING btree (source_video_id) WHERE (source_video_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS reel_test_trial_kind_scheduled_idx ON public.reel_test_publications USING btree (trial_kind, scheduled_at, status);
CREATE INDEX IF NOT EXISTS schedules_calendar_visible_idx ON public.schedules USING btree (scheduled_at) WHERE (status <> 'cancelled'::text);
CREATE INDEX IF NOT EXISTS schedules_platform_account_id_idx ON public.schedules USING btree (platform_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS schedules_unique_slot ON public.schedules USING btree (platform_account_id, scheduled_at) WHERE (status = ANY (ARRAY['scheduled'::text, 'queued'::text, 'processing'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS smart_recommendations_account_weekday_rank_key ON public.smart_recommendations USING btree (platform_account_id, weekday, rank);
CREATE UNIQUE INDEX IF NOT EXISTS smart_recommendations_weekday_rank_compat_uidx ON public.smart_recommendations USING btree (weekday, rank);
CREATE INDEX IF NOT EXISTS smart_time_history_created_idx ON public.smart_time_history USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS smart_time_history_slot_idx ON public.smart_time_history USING btree (weekday, rank, created_at DESC);
CREATE INDEX IF NOT EXISTS smart_time_history_validation_id_idx ON public.smart_time_history USING btree (validation_id);
CREATE UNIQUE INDEX IF NOT EXISTS smart_time_validation_account_weekday_rank_key ON public.smart_time_validation USING btree (platform_account_id, weekday, rank);
CREATE INDEX IF NOT EXISTS smart_time_validation_state_idx ON public.smart_time_validation USING btree (state, weekday, rank);
CREATE UNIQUE INDEX IF NOT EXISTS smart_time_validation_weekday_rank_compat_uidx ON public.smart_time_validation USING btree (weekday, rank);
CREATE INDEX IF NOT EXISTS system_notifications_pending_idx ON public.system_notifications USING btree (status, next_attempt_at, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));
CREATE INDEX IF NOT EXISTS system_notifications_user_created_idx ON public.system_notifications USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS system_notifications_user_error_unread_idx ON public.system_notifications USING btree (user_id, created_at DESC) WHERE ((severity = 'error'::text) AND (status <> 'read'::text));
CREATE INDEX IF NOT EXISTS trial_media_clean_due_idx ON public.reel_test_publications USING btree (media_clean_status, media_clean_next_attempt_at, updated_at) WHERE (media_clean_status = ANY (ARRAY['pending'::text, 'processing'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS uq_reel_test_active_day_slot ON public.reel_test_publications USING btree (user_id, ((meta ->> 'trial_day'::text)), slot_index) WHERE ((hidden_at IS NULL) AND (trial_kind = 'overnight'::text) AND (slot_index IS NOT NULL) AND (meta ? 'trial_day'::text));
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_queue_active_schedule_type ON public.job_queue USING btree (schedule_id, job_type) WHERE ((schedule_id IS NOT NULL) AND (status = ANY (ARRAY['pending'::text, 'running'::text])));
CREATE UNIQUE INDEX IF NOT EXISTS ux_smart_samples_instagram_media ON public.smart_samples USING btree (instagram_media_record_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_smart_samples_schedule ON public.smart_samples USING btree (schedule_id);
CREATE INDEX IF NOT EXISTS videos_media_clean_due_idx ON public.videos USING btree (media_clean_status, media_clean_next_attempt_at, updated_at) WHERE (media_clean_status = ANY (ARRAY['pending'::text, 'processing'::text]));
CREATE INDEX IF NOT EXISTS videos_platform_account_id_idx ON public.videos USING btree (platform_account_id);
CREATE INDEX IF NOT EXISTS viral_foryou_items_account_day_idx ON public.viral_foryou_items USING btree (source_account_id, collected_day DESC, views DESC);
CREATE INDEX IF NOT EXISTS viral_foryou_items_views_idx ON public.viral_foryou_items USING btree (views DESC);
CREATE INDEX IF NOT EXISTS x_drive_posts_published_idx ON public.x_drive_posts USING btree (user_id, published_at DESC) WHERE (status = 'published'::text);
CREATE INDEX IF NOT EXISTS x_drive_posts_queue_idx ON public.x_drive_posts USING btree (user_id, status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS x_oauth_states_expires_at_idx ON public.x_oauth_states USING btree (expires_at);
CREATE INDEX IF NOT EXISTS x_oauth_states_user_id_idx ON public.x_oauth_states USING btree (user_id);
CREATE INDEX IF NOT EXISTS x_posts_account_queue ON public.x_drive_posts USING btree (platform_account_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS x_posts_calendar_lookup ON public.x_drive_posts USING btree (user_id, scheduled_at) WHERE (scheduled_at IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS x_posts_external_id_unique ON public.x_drive_posts USING btree (platform_account_id, x_post_id) WHERE (x_post_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS x_posts_reserved_slot ON public.x_drive_posts USING btree (platform_account_id, scheduled_at) WHERE ((scheduled_at IS NOT NULL) AND (status = ANY (ARRAY['queued'::text, 'processing'::text, 'failed'::text, 'published'::text])));
CREATE INDEX IF NOT EXISTS x_warmup_accounts_platform_account_id_idx ON public.x_warmup_accounts USING btree (platform_account_id);
CREATE INDEX IF NOT EXISTS x_warmup_accounts_user_status_idx ON public.x_warmup_accounts USING btree (user_id, status, created_at);
CREATE INDEX IF NOT EXISTS x_warmup_actions_account_day_idx ON public.x_warmup_actions USING btree (warmup_account_id, day_number, status);
CREATE INDEX IF NOT EXISTS x_warmup_actions_due_idx ON public.x_warmup_actions USING btree (status, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS x_warmup_actions_user_id_idx ON public.x_warmup_actions USING btree (user_id);
CREATE INDEX IF NOT EXISTS x_warmup_days_account_day_idx ON public.x_warmup_days USING btree (warmup_account_id, day_number);
CREATE INDEX IF NOT EXISTS x_warmup_days_user_id_idx ON public.x_warmup_days USING btree (user_id);
ALTER TABLE ONLY public.activity_logs ALTER COLUMN id SET DEFAULT nextval('public.activity_logs_id_seq'::regclass);
ALTER SEQUENCE public.activity_logs_id_seq OWNED BY public.activity_logs.id;
CREATE OR REPLACE VIEW public.latest_instagram_metrics WITH (security_invoker='true') AS
 SELECT DISTINCT ON (m.id) m.id AS instagram_media_record_id,
    m.ig_media_id,
    m.caption,
    m.permalink,
    m.thumbnail_url,
    m.media_type,
    m.media_product_type,
    m.posted_at,
    ms.collected_at,
    ms.views,
    ms.reach,
    ms.likes,
    ms.comments,
    ms.shares,
    ms.saves,
    m.media_url,
    m.platform_account_id
   FROM (public.instagram_media m
     JOIN public.metrics_snapshots ms ON ((ms.instagram_media_record_id = m.id)))
  WHERE (NULLIF((ms.raw ->> 'insights_error'::text), ''::text) IS NULL)
  ORDER BY m.id, ms.collected_at DESC, ms.id DESC;


ALTER VIEW public.latest_instagram_metrics OWNER TO postgres;

set check_function_bodies=true;
