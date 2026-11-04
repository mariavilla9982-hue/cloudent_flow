-- Image preparation must not wait for the previous Genjutsu video to finish.
-- The existing lease, FIFO, shared capacity and provider checks remain authoritative.
create or replace function public.genjutsu_image_eligible(p_id uuid,p_created_at timestamptz)
returns boolean language sql stable security invoker set search_path=public as $$
  select not exists (
    select 1 from public.face_swap_jobs older
    where older.meta->'video_workflow'->>'key'='genjutsu'
      and older.meta->>'stage' not in ('upload','control_motion')
      and (older.created_at,older.id)<(p_created_at,p_id)
      and (older.status in ('waiting','uploading','queued','running') or older.meta->>'dispatch_uncertain'='true')
  );
$$;
revoke all on function public.genjutsu_image_eligible(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.genjutsu_image_eligible(uuid,timestamptz) to service_role;
