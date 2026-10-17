CREATE TABLE IF NOT EXISTS public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid,
    instagram_comment_id text,
    username text,
    body text NOT NULL,
    sentiment text,
    reply_status text DEFAULT 'pending'::text NOT NULL,
    drafted_reply text,
    reply_scheduled_at timestamp with time zone,
    replied_at timestamp with time zone,
    should_like boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comments_reply_status_check CHECK ((reply_status = ANY (ARRAY['pending'::text, 'drafted'::text, 'scheduled'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))
);


ALTER TABLE public.comments OWNER TO postgres;
alter table public.comments enable row level security;
CREATE TABLE IF NOT EXISTS public.google_drive_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    access_token_cipher text NOT NULL,
    access_token_iv text NOT NULL,
    refresh_token_cipher text,
    refresh_token_iv text,
    token_expires_at timestamp with time zone,
    account_email text,
    account_name text,
    folder_id text,
    folder_name text,
    folder_web_url text,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.google_drive_connections OWNER TO postgres;
alter table public.google_drive_connections enable row level security;
CREATE TABLE IF NOT EXISTS public.google_drive_oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    state_hash text NOT NULL,
    verifier_cipher text NOT NULL,
    verifier_iv text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.google_drive_oauth_states OWNER TO postgres;
alter table public.google_drive_oauth_states enable row level security;
CREATE TABLE IF NOT EXISTS public.instagram_follower_daily (
    account_id text NOT NULL,
    day date NOT NULL,
    first_count bigint NOT NULL,
    current_count bigint NOT NULL,
    peak_count bigint NOT NULL,
    low_count bigint NOT NULL,
    net_change integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.instagram_follower_daily OWNER TO postgres;
alter table public.instagram_follower_daily enable row level security;
CREATE TABLE IF NOT EXISTS public.instagram_follower_state (
    account_id text NOT NULL,
    followers_count bigint DEFAULT 0 NOT NULL,
    previous_count bigint,
    delta_last integer DEFAULT 0 NOT NULL,
    last_checked_at timestamp with time zone DEFAULT now() NOT NULL,
    last_change_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.instagram_follower_state OWNER TO postgres;
alter table public.instagram_follower_state enable row level security;
CREATE TABLE IF NOT EXISTS public.instagram_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ig_media_id text NOT NULL,
    media_type text,
    media_product_type text,
    caption text,
    permalink text,
    thumbnail_url text,
    posted_at timestamp with time zone,
    like_count bigint DEFAULT 0,
    comments_count bigint DEFAULT 0,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    media_url text,
    platform_account_id uuid
);


ALTER TABLE public.instagram_media OWNER TO postgres;
alter table public.instagram_media enable row level security;
CREATE TABLE IF NOT EXISTS public.instagram_metrics_sync_state (
    account_id uuid NOT NULL,
    followers_error text,
    last_followers_attempt_at timestamp with time zone,
    metrics_error text,
    last_metrics_attempt_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.instagram_metrics_sync_state OWNER TO postgres;
alter table public.instagram_metrics_sync_state enable row level security;
CREATE TABLE IF NOT EXISTS public.instagram_story_monitor (
    account_id uuid NOT NULL,
    status text DEFAULT 'unknown'::text NOT NULL,
    last_known_status text DEFAULT 'unknown'::text NOT NULL,
    active_count integer,
    checked_at timestamp with time zone,
    next_check_at timestamp with time zone DEFAULT now() NOT NULL,
    empty_since timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instagram_story_monitor_status_check CHECK ((status = ANY (ARRAY['unknown'::text, 'active'::text, 'empty'::text])))
);


ALTER TABLE public.instagram_story_monitor OWNER TO postgres;
alter table public.instagram_story_monitor enable row level security;
CREATE TABLE IF NOT EXISTS public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    account_label text,
    external_account_id text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT integrations_provider_check CHECK ((provider = ANY (ARRAY['instagram'::text, 'runninghub'::text, 'x'::text, 'tiktok'::text, 'google_drive'::text])))
);


ALTER TABLE public.integrations OWNER TO postgres;
alter table public.integrations enable row level security;
CREATE TABLE IF NOT EXISTS public.job_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_type text NOT NULL,
    schedule_id uuid,
    comment_id uuid,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 15 NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    platform text DEFAULT 'instagram'::text NOT NULL,
    platform_account_id uuid,
    CONSTRAINT job_queue_job_type_check CHECK ((job_type = ANY (ARRAY['publish_reel'::text, 'collect_metrics'::text, 'fetch_comments'::text, 'send_comment_reply'::text, 'smart_recalculate'::text]))),
    CONSTRAINT job_queue_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'x'::text, 'tiktok'::text]))),
    CONSTRAINT job_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text, 'cancelled'::text])))
);


ALTER TABLE public.job_queue OWNER TO postgres;
alter table public.job_queue enable row level security;
CREATE TABLE IF NOT EXISTS public.media_access_daily (
    user_id uuid NOT NULL,
    day date DEFAULT CURRENT_DATE NOT NULL,
    video_preview_requests integer DEFAULT 0 NOT NULL,
    trial_preview_requests integer DEFAULT 0 NOT NULL,
    thumbnail_requests integer DEFAULT 0 NOT NULL,
    estimated_bytes bigint DEFAULT 0 NOT NULL,
    last_access_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.media_access_daily OWNER TO postgres;
alter table public.media_access_daily enable row level security;
CREATE TABLE IF NOT EXISTS public.member_invites (
    email text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    invited_by uuid,
    claimed_by uuid,
    claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    signup_token_hash text,
    signup_token_expires_at timestamp with time zone,
    workspace_id uuid,
    CONSTRAINT member_invites_email_check CHECK ((email = lower(email))),
    CONSTRAINT member_invites_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text, 'x_user'::text])))
);


ALTER TABLE public.member_invites OWNER TO postgres;
alter table public.member_invites enable row level security;
CREATE TABLE IF NOT EXISTS public.motion_storage_health (
    id boolean DEFAULT true NOT NULL,
    phase text DEFAULT 'unknown'::text NOT NULL,
    reason text,
    last_error text,
    checked_at timestamp with time zone,
    next_probe_at timestamp with time zone DEFAULT now() NOT NULL,
    probe_owner text,
    probe_until timestamp with time zone,
    counter_day date DEFAULT ((now() AT TIME ZONE 'UTC'::text))::date NOT NULL,
    managed_reads integer DEFAULT 0 NOT NULL,
    daily_read_budget integer DEFAULT 1000 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT motion_storage_health_daily_read_budget_check CHECK (((daily_read_budget >= 100) AND (daily_read_budget <= 10000))),
    CONSTRAINT motion_storage_health_id_check CHECK (id),
    CONSTRAINT motion_storage_health_managed_reads_check CHECK ((managed_reads >= 0)),
    CONSTRAINT motion_storage_health_phase_check CHECK ((phase = ANY (ARRAY['unknown'::text, 'healthy'::text, 'blocked'::text])))
);


ALTER TABLE public.motion_storage_health OWNER TO postgres;
alter table public.motion_storage_health enable row level security;
