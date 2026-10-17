CREATE TABLE IF NOT EXISTS public.motion_storage_reservations (
    job_id uuid NOT NULL,
    user_id uuid NOT NULL,
    input_bytes bigint DEFAULT 0 NOT NULL,
    allocated_bytes bigint NOT NULL,
    state text DEFAULT 'held'::text NOT NULL,
    input_prefix text NOT NULL,
    result_path text,
    expires_at timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT motion_storage_reservations_allocated_bytes_check CHECK ((allocated_bytes > 0)),
    CONSTRAINT motion_storage_reservations_input_bytes_check CHECK ((input_bytes >= 0)),
    CONSTRAINT motion_storage_reservations_state_check CHECK ((state = ANY (ARRAY['held'::text, 'committed'::text, 'released'::text])))
);


ALTER TABLE public.motion_storage_reservations OWNER TO postgres;
alter table public.motion_storage_reservations enable row level security;
CREATE TABLE IF NOT EXISTS public.platform_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform text NOT NULL,
    external_account_id text,
    account_label text,
    enabled boolean DEFAULT false NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid,
    owner_user_id uuid,
    CONSTRAINT platform_accounts_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'x'::text, 'tiktok'::text])))
);


ALTER TABLE public.platform_accounts OWNER TO postgres;
alter table public.platform_accounts enable row level security;
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    expiration_time bigint,
    user_agent text,
    enabled boolean DEFAULT true NOT NULL,
    last_success_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.push_subscriptions OWNER TO postgres;
alter table public.push_subscriptions enable row level security;
CREATE TABLE IF NOT EXISTS public.reel_test_publications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    storage_path text NOT NULL,
    file_name text,
    caption text DEFAULT ''::text,
    share_to_feed boolean DEFAULT false NOT NULL,
    is_trial boolean DEFAULT true NOT NULL,
    container_id text,
    instagram_media_id text,
    status text DEFAULT 'uploaded'::text NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    storage_deleted_at timestamp with time zone,
    scheduled_at timestamp with time zone,
    graduation_strategy text DEFAULT 'manual'::text NOT NULL,
    next_attempt_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 8 NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    published_as_trial boolean DEFAULT false NOT NULL,
    metrics_stage integer DEFAULT 0 NOT NULL,
    next_metric_at timestamp with time zone,
    metrics_completed_at timestamp with time zone,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    slot_index integer,
    auto_time boolean DEFAULT true NOT NULL,
    hidden_at timestamp with time zone,
    last_auto_adjusted_at timestamp with time zone,
    original_storage_path text,
    media_clean_status text DEFAULT 'pending'::text NOT NULL,
    media_clean_report jsonb DEFAULT '{}'::jsonb NOT NULL,
    media_cleaned_at timestamp with time zone,
    media_clean_error text,
    media_clean_attempts integer DEFAULT 0 NOT NULL,
    media_clean_next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    trial_kind text DEFAULT 'overnight'::text NOT NULL,
    linked_schedule_id uuid,
    source_video_id uuid,
    shared_storage boolean DEFAULT false NOT NULL,
    cover_offset_ms integer DEFAULT 3500,
    cover_strategy text DEFAULT 'auto_after_3s'::text NOT NULL,
    thumbnail_storage_path text,
    storage_provider text DEFAULT 'supabase'::text NOT NULL,
    CONSTRAINT reel_test_media_clean_status_check CHECK ((media_clean_status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'skipped'::text, 'failed'::text, 'legacy'::text]))),
    CONSTRAINT reel_test_publications_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'scheduled'::text, 'container_created'::text, 'processing'::text, 'ready'::text, 'publishing'::text, 'published'::text, 'failed'::text]))),
    CONSTRAINT reel_test_publications_storage_provider_check CHECK ((storage_provider = ANY (ARRAY['supabase'::text, 'r2'::text]))),
    CONSTRAINT reel_test_publications_trial_kind_check CHECK ((trial_kind = ANY (ARRAY['overnight'::text, 'prepost'::text])))
);


ALTER TABLE public.reel_test_publications OWNER TO postgres;
alter table public.reel_test_publications enable row level security;
CREATE TABLE IF NOT EXISTS public.schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    video_id uuid NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    smart_mode text,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    instagram_media_id text,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_auto_adjusted_at timestamp with time zone,
    auto_adjust_count integer DEFAULT 0 NOT NULL,
    smart_strategy text DEFAULT 'manual'::text NOT NULL,
    smart_strategy_locked boolean DEFAULT false NOT NULL,
    platform text DEFAULT 'instagram'::text NOT NULL,
    platform_account_id uuid,
    CONSTRAINT schedules_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'x'::text, 'tiktok'::text]))),
    CONSTRAINT schedules_smart_strategy_check CHECK ((smart_strategy = ANY (ARRAY['manual'::text, 'tested'::text, 'test'::text, 'strong'::text, 'stable'::text]))),
    CONSTRAINT schedules_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'queued'::text, 'processing'::text, 'published'::text, 'failed'::text, 'cancelled'::text])))
);


ALTER TABLE public.schedules OWNER TO postgres;
alter table public.schedules enable row level security;
CREATE TABLE IF NOT EXISTS public.smart_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    weekday smallint NOT NULL,
    rank smallint NOT NULL,
    recommended_time time without time zone NOT NULL,
    score numeric DEFAULT 0 NOT NULL,
    confidence integer DEFAULT 0 NOT NULL,
    sample_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    recommendation_type text DEFAULT 'tested'::text NOT NULL,
    platform_account_id uuid,
    CONSTRAINT smart_recommendations_confidence_check CHECK (((confidence >= 0) AND (confidence <= 100))),
    CONSTRAINT smart_recommendations_rank_check CHECK (((rank >= 1) AND (rank <= 10))),
    CONSTRAINT smart_recommendations_type_check CHECK ((recommendation_type = ANY (ARRAY['tested'::text, 'test'::text, 'stable'::text]))),
    CONSTRAINT smart_recommendations_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.smart_recommendations OWNER TO postgres;
alter table public.smart_recommendations enable row level security;
CREATE TABLE IF NOT EXISTS public.smart_samples (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid,
    sample_date date NOT NULL,
    sample_time time without time zone NOT NULL,
    weekday smallint NOT NULL,
    views bigint DEFAULT 0,
    reach bigint DEFAULT 0,
    likes bigint DEFAULT 0,
    comments bigint DEFAULT 0,
    shares bigint DEFAULT 0,
    saves bigint DEFAULT 0,
    source text DEFAULT 'instagram'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    instagram_media_record_id uuid,
    platform_account_id uuid,
    CONSTRAINT smart_samples_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.smart_samples OWNER TO postgres;
alter table public.smart_samples enable row level security;
CREATE TABLE IF NOT EXISTS public.smart_time_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    validation_id uuid,
    weekday smallint NOT NULL,
    rank smallint NOT NULL,
    event_type text NOT NULL,
    from_state text,
    to_state text,
    from_time time without time zone,
    to_time time without time zone,
    champion_score numeric,
    candidate_score numeric,
    confidence integer,
    sample_count integer,
    reason text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    platform_account_id uuid,
    CONSTRAINT smart_time_history_rank_check CHECK (((rank >= 1) AND (rank <= 7))),
    CONSTRAINT smart_time_history_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.smart_time_history OWNER TO postgres;
alter table public.smart_time_history enable row level security;
