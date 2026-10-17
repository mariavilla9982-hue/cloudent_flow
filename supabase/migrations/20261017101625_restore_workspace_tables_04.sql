CREATE TABLE IF NOT EXISTS public.smart_time_validation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    weekday smallint NOT NULL,
    rank smallint NOT NULL,
    state text DEFAULT 'new'::text NOT NULL,
    champion_time time without time zone,
    champion_score numeric DEFAULT 0 NOT NULL,
    champion_confidence integer DEFAULT 0 NOT NULL,
    champion_sample_count integer DEFAULT 0 NOT NULL,
    candidate_time time without time zone,
    candidate_score numeric DEFAULT 0 NOT NULL,
    candidate_confidence integer DEFAULT 0 NOT NULL,
    candidate_sample_count integer DEFAULT 0 NOT NULL,
    validation_streak integer DEFAULT 0 NOT NULL,
    challenger_streak integer DEFAULT 0 NOT NULL,
    challenger_fail_streak integer DEFAULT 0 NOT NULL,
    decline_streak integer DEFAULT 0 NOT NULL,
    rollback_time time without time zone,
    rollback_score numeric,
    rollback_confidence integer,
    rollback_sample_count integer,
    last_observed_time time without time zone,
    last_observed_sample_count integer DEFAULT 0 NOT NULL,
    last_evidence_at timestamp with time zone,
    validated_at timestamp with time zone,
    revalidate_started_at timestamp with time zone,
    last_decision_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    platform_account_id uuid,
    CONSTRAINT smart_time_validation_rank_check CHECK (((rank >= 1) AND (rank <= 7))),
    CONSTRAINT smart_time_validation_state_check CHECK ((state = ANY (ARRAY['new'::text, 'testing'::text, 'validated'::text, 'revalidate'::text]))),
    CONSTRAINT smart_time_validation_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.smart_time_validation OWNER TO postgres;
alter table public.smart_time_validation enable row level security;
CREATE TABLE IF NOT EXISTS public.trial_time_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    weekday smallint NOT NULL,
    rank smallint NOT NULL,
    recommended_time time without time zone NOT NULL,
    score numeric DEFAULT 0 NOT NULL,
    confidence integer DEFAULT 0 NOT NULL,
    sample_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trial_time_recommendations_confidence_check CHECK (((confidence >= 0) AND (confidence <= 100))),
    CONSTRAINT trial_time_recommendations_rank_check CHECK (((rank >= 1) AND (rank <= 4))),
    CONSTRAINT trial_time_recommendations_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.trial_time_recommendations OWNER TO postgres;
alter table public.trial_time_recommendations enable row level security;
CREATE TABLE IF NOT EXISTS public.videos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    size_bytes bigint,
    duration_seconds numeric,
    width integer,
    height integer,
    caption text DEFAULT ''::text,
    status text DEFAULT 'ready'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    platform text DEFAULT 'instagram'::text NOT NULL,
    platform_account_id uuid,
    storage_deleted_at timestamp with time zone,
    original_storage_path text,
    media_clean_status text DEFAULT 'pending'::text NOT NULL,
    media_clean_report jsonb DEFAULT '{}'::jsonb NOT NULL,
    media_cleaned_at timestamp with time zone,
    media_clean_error text,
    media_clean_attempts integer DEFAULT 0 NOT NULL,
    media_clean_next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    cover_offset_ms integer DEFAULT 3500,
    cover_strategy text DEFAULT 'auto_after_3s'::text NOT NULL,
    thumbnail_storage_path text,
    storage_provider text DEFAULT 'supabase'::text NOT NULL,
    hot_storage_path text,
    hot_cached_at timestamp with time zone,
    cold_storage_path text,
    cold_storage_provider text,
    CONSTRAINT videos_media_clean_status_check CHECK ((media_clean_status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'skipped'::text, 'failed'::text, 'legacy'::text]))),
    CONSTRAINT videos_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'x'::text, 'tiktok'::text]))),
    CONSTRAINT videos_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'scheduled'::text, 'queued'::text, 'processing'::text, 'published'::text, 'failed'::text, 'archived'::text]))),
    CONSTRAINT videos_storage_provider_check CHECK ((storage_provider = ANY (ARRAY['supabase'::text, 'r2'::text])))
);


ALTER TABLE public.videos OWNER TO postgres;
alter table public.videos enable row level security;
CREATE TABLE IF NOT EXISTS public.viral_foryou_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_account_id uuid NOT NULL,
    shortcode text NOT NULL,
    permalink text NOT NULL,
    cover_url text,
    caption text,
    views bigint DEFAULT 0 NOT NULL,
    likes bigint DEFAULT 0 NOT NULL,
    comments bigint DEFAULT 0 NOT NULL,
    published_at timestamp with time zone,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    collected_day date DEFAULT CURRENT_DATE NOT NULL,
    source text DEFAULT 'instagram_foryou'::text NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE public.viral_foryou_items OWNER TO postgres;
alter table public.viral_foryou_items enable row level security;
CREATE TABLE IF NOT EXISTS public.viral_foryou_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_account_id uuid NOT NULL,
    daily_target smallint DEFAULT 5 NOT NULL,
    min_views integer DEFAULT 400000 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    collector_status text DEFAULT 'needs_browser_session'::text NOT NULL,
    last_collected_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT viral_foryou_settings_collector_status_check CHECK ((collector_status = ANY (ARRAY['needs_browser_session'::text, 'ready'::text, 'running'::text, 'error'::text, 'paused'::text]))),
    CONSTRAINT viral_foryou_settings_daily_target_check CHECK ((daily_target = ANY (ARRAY[5, 10]))),
    CONSTRAINT viral_foryou_settings_min_views_check CHECK ((min_views >= 0))
);


ALTER TABLE public.viral_foryou_settings OWNER TO postgres;
alter table public.viral_foryou_settings enable row level security;
CREATE TABLE IF NOT EXISTS public.viral_foryou_worker_auth (
    source_account_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT viral_foryou_worker_auth_token_hash_check CHECK ((length(token_hash) = 64))
);


ALTER TABLE public.viral_foryou_worker_auth OWNER TO postgres;
alter table public.viral_foryou_worker_auth enable row level security;
CREATE TABLE IF NOT EXISTS public.worker_runtime (
    worker_name text NOT NULL,
    last_heartbeat timestamp with time zone,
    last_success_at timestamp with time zone,
    last_error text,
    last_jobs integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.worker_runtime OWNER TO postgres;
alter table public.worker_runtime enable row level security;
CREATE TABLE IF NOT EXISTS public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    owner_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.workspaces OWNER TO postgres;
alter table public.workspaces enable row level security;
CREATE TABLE IF NOT EXISTS public.x_account_access (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    platform_account_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.x_account_access OWNER TO postgres;
alter table public.x_account_access enable row level security;
CREATE TABLE IF NOT EXISTS public.x_account_configs (
    platform_account_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    interval_minutes integer DEFAULT 120 NOT NULL,
    daily_slots text[] DEFAULT ARRAY['12:00'::text, '18:00'::text] NOT NULL,
    timezone text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
    next_publish_at timestamp with time zone,
    last_worker_at timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_metrics_at timestamp with time zone,
    metrics_error text,
    CONSTRAINT x_account_configs_interval_minutes_check CHECK (((interval_minutes >= 5) AND (interval_minutes <= 10080)))
);


ALTER TABLE public.x_account_configs OWNER TO postgres;
alter table public.x_account_configs enable row level security;
CREATE TABLE IF NOT EXISTS public.x_audit_log (
    id bigint NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid,
    platform_account_id uuid,
    event_type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.x_audit_log OWNER TO postgres;
alter table public.x_audit_log enable row level security;
ALTER TABLE public.x_audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.x_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
