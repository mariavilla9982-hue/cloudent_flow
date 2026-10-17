create schema if not exists cloudent_private;
CREATE TABLE IF NOT EXISTS public.system_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    severity text DEFAULT 'error'::text NOT NULL,
    category text DEFAULT 'system'::text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    source_event_id bigint,
    source_event_type text,
    source_ref text,
    dedupe_key text,
    status text DEFAULT 'pending'::text NOT NULL,
    push_attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    sent_at timestamp with time zone,
    read_at timestamp with time zone,
    last_error text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_notifications_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text, 'error'::text]))),
    CONSTRAINT system_notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'read'::text, 'failed'::text])))
);


ALTER TABLE public.system_notifications OWNER TO postgres;
alter table public.system_notifications enable row level security;
CREATE TABLE IF NOT EXISTS public.x_warmup_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    warmup_account_id uuid NOT NULL,
    day_number integer NOT NULL,
    action_type text NOT NULL,
    target_post_id text,
    target_user_id text,
    text_content text,
    scheduled_at timestamp with time zone,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    last_error text,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT x_warmup_actions_action_type_check CHECK ((action_type = ANY (ARRAY['observe'::text, 'like'::text, 'follow'::text, 'reply'::text, 'post'::text, 'active_window'::text]))),
    CONSTRAINT x_warmup_actions_day_number_check CHECK (((day_number >= 1) AND (day_number <= 7))),
    CONSTRAINT x_warmup_actions_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10))),
    CONSTRAINT x_warmup_actions_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'waiting_connection'::text, 'processing'::text, 'completed'::text, 'skipped'::text, 'failed'::text, 'blocked'::text])))
);


ALTER TABLE public.x_warmup_actions OWNER TO postgres;
alter table public.x_warmup_actions enable row level security;
CREATE TABLE IF NOT EXISTS public.face_swap_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    storage_provider text DEFAULT 'supabase'::text NOT NULL,
    original_storage_path text NOT NULL,
    original_file_name text NOT NULL,
    original_mime_type text,
    original_size_bytes bigint DEFAULT 0 NOT NULL,
    frame_storage_path text NOT NULL,
    frame_file_name text NOT NULL,
    frame_mime_type text,
    frame_size_bytes bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'waiting'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    auto_send boolean DEFAULT true NOT NULL,
    runninghub_task_id text,
    runninghub_frame_file text,
    result_url text,
    result_storage_path text,
    result_file_name text,
    result_mime_type text,
    result_size_bytes bigint DEFAULT 0 NOT NULL,
    production_job_id uuid,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_error text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    hidden_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    credits_before numeric,
    credits_after numeric,
    credits_used numeric,
    runninghub_cost_money numeric,
    runninghub_third_party_cost_money numeric,
    runninghub_runtime_seconds numeric,
    CONSTRAINT face_swap_jobs_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10))),
    CONSTRAINT face_swap_jobs_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT face_swap_jobs_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'uploading'::text, 'queued'::text, 'running'::text, 'ready'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT face_swap_jobs_storage_provider_check CHECK ((storage_provider = ANY (ARRAY['supabase'::text, 'r2'::text])))
);


ALTER TABLE public.face_swap_jobs OWNER TO postgres;
alter table public.face_swap_jobs enable row level security;
CREATE TABLE IF NOT EXISTS public.production_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    original_storage_path text NOT NULL,
    original_file_name text NOT NULL,
    original_mime_type text,
    original_size_bytes bigint DEFAULT 0 NOT NULL,
    frame_storage_path text NOT NULL,
    frame_file_name text NOT NULL,
    frame_mime_type text,
    frame_size_bytes bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'waiting'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    runninghub_task_id text,
    runninghub_video_file text,
    runninghub_frame_file text,
    result_url text,
    result_storage_path text,
    result_video_id uuid,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_error text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    credits_used numeric,
    runninghub_runtime_seconds numeric,
    credits_before numeric,
    credits_after numeric,
    runninghub_cost_money numeric,
    runninghub_third_party_cost_money numeric,
    inputs_deleted_at timestamp with time zone,
    hidden_at timestamp with time zone,
    storage_provider text DEFAULT 'supabase'::text NOT NULL,
    CONSTRAINT production_jobs_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT production_jobs_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'motion_waiting'::text, 'uploading'::text, 'queued'::text, 'running'::text, 'ready'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT production_jobs_storage_provider_check CHECK ((storage_provider = ANY (ARRAY['supabase'::text, 'r2'::text])))
);


ALTER TABLE public.production_jobs OWNER TO postgres;
alter table public.production_jobs enable row level security;
CREATE TABLE IF NOT EXISTS public.metrics_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    views bigint DEFAULT 0,
    reach bigint DEFAULT 0,
    likes bigint DEFAULT 0,
    comments bigint DEFAULT 0,
    shares bigint DEFAULT 0,
    saves bigint DEFAULT 0,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    instagram_media_record_id uuid,
    trial_publication_id uuid
);


ALTER TABLE public.metrics_snapshots OWNER TO postgres;
alter table public.metrics_snapshots enable row level security;
CREATE TABLE IF NOT EXISTS cloudent_private.rate_limits (
    user_id uuid NOT NULL,
    bucket text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    requests integer NOT NULL
);


ALTER TABLE cloudent_private.rate_limits OWNER TO postgres;
alter table cloudent_private.rate_limits enable row level security;
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id bigint NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    event_type text NOT NULL,
    message text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.activity_logs OWNER TO postgres;
alter table public.activity_logs enable row level security;
CREATE SEQUENCE IF NOT EXISTS public.activity_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.activity_logs_id_seq OWNER TO postgres;
CREATE TABLE IF NOT EXISTS public.app_members (
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid,
    CONSTRAINT app_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text, 'x_user'::text])))
);


ALTER TABLE public.app_members OWNER TO postgres;
alter table public.app_members enable row level security;
CREATE TABLE IF NOT EXISTS public.app_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.app_settings OWNER TO postgres;
alter table public.app_settings enable row level security;
