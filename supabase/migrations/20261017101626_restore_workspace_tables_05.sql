CREATE TABLE IF NOT EXISTS public.x_drive_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    platform_account_id uuid,
    drive_file_id text NOT NULL,
    drive_file_name text NOT NULL,
    drive_mime_type text,
    drive_size_bytes bigint,
    drive_created_at timestamp with time zone,
    drive_modified_at timestamp with time zone,
    drive_md5 text,
    status text DEFAULT 'queued'::text NOT NULL,
    post_text text,
    x_media_id text,
    x_post_id text,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    published_at timestamp with time zone,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scheduled_at timestamp with time zone,
    workspace_id uuid,
    reply_text text,
    reply_status text DEFAULT 'none'::text NOT NULL,
    external_reply_id text,
    reply_error text,
    reply_attempts integer DEFAULT 0 NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    metrics_synced_at timestamp with time zone,
    reply_started_at timestamp with time zone,
    CONSTRAINT x_drive_posts_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 20))),
    CONSTRAINT x_drive_posts_reply_status_check CHECK ((reply_status = ANY (ARRAY['none'::text, 'pending'::text, 'processing'::text, 'published'::text, 'failed'::text, 'uncertain'::text]))),
    CONSTRAINT x_drive_posts_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'published'::text, 'failed'::text, 'skipped'::text])))
);


ALTER TABLE public.x_drive_posts OWNER TO postgres;
alter table public.x_drive_posts enable row level security;
CREATE TABLE IF NOT EXISTS public.x_oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    state_hash text NOT NULL,
    verifier_cipher text NOT NULL,
    verifier_iv text NOT NULL,
    return_to text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.x_oauth_states OWNER TO postgres;
alter table public.x_oauth_states enable row level security;
CREATE TABLE IF NOT EXISTS public.x_publish_configs (
    user_id uuid NOT NULL,
    platform_account_id uuid,
    enabled boolean DEFAULT false NOT NULL,
    caption text DEFAULT ''::text NOT NULL,
    link_url text DEFAULT ''::text NOT NULL,
    interval_minutes integer DEFAULT 120 NOT NULL,
    timezone text DEFAULT 'America/Recife'::text NOT NULL,
    next_publish_at timestamp with time zone,
    last_sync_at timestamp with time zone,
    last_worker_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    daily_slots text[] DEFAULT ARRAY['12:00'::text, '18:00'::text] NOT NULL,
    CONSTRAINT x_publish_configs_interval_minutes_check CHECK (((interval_minutes >= 5) AND (interval_minutes <= 10080)))
);


ALTER TABLE public.x_publish_configs OWNER TO postgres;
alter table public.x_publish_configs enable row level security;
CREATE TABLE IF NOT EXISTS public.x_warmup_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    platform_account_id uuid,
    label text NOT NULL,
    username text,
    external_user_id text,
    status text DEFAULT 'draft'::text NOT NULL,
    current_day integer DEFAULT 1 NOT NULL,
    started_at timestamp with time zone,
    day_started_at timestamp with time zone,
    paused_at timestamp with time zone,
    approved_at timestamp with time zone,
    last_action_at timestamp with time zone,
    last_error text,
    approval_note text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT x_warmup_accounts_current_day_check CHECK (((current_day >= 1) AND (current_day <= 7))),
    CONSTRAINT x_warmup_accounts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'warming'::text, 'paused'::text, 'review'::text, 'approved'::text, 'needs_attention'::text])))
);


ALTER TABLE public.x_warmup_accounts OWNER TO postgres;
alter table public.x_warmup_accounts enable row level security;
CREATE TABLE IF NOT EXISTS public.x_warmup_days (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    warmup_account_id uuid NOT NULL,
    day_number integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT x_warmup_days_day_number_check CHECK (((day_number >= 1) AND (day_number <= 7))),
    CONSTRAINT x_warmup_days_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'completed'::text, 'paused'::text])))
);


ALTER TABLE public.x_warmup_days OWNER TO postgres;
alter table public.x_warmup_days enable row level security;
