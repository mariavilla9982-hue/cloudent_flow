begin;

create or replace function public.x_buffer_follow_link(p_post_id uuid, p_count boolean)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  destination text;
begin
  if p_count then
    update public.x_drive_posts
       set meta = jsonb_set(meta, '{buffer_link_clicks}',
         to_jsonb(coalesce((meta->>'buffer_link_clicks')::bigint, 0) + 1))
     where id = p_post_id
       and status = 'published'
       and meta->>'publish_provider' = 'buffer'
       and meta->>'buffer_click_target' like 'https://%'
     returning meta->>'buffer_click_target' into destination;
    if found then
      return destination;
    end if;
  end if;

  -- The link can be opened as soon as the post appears on X, even before reconciliation.
  select meta->>'buffer_click_target' into destination
    from public.x_drive_posts
   where id = p_post_id
     and meta->>'publish_provider' = 'buffer'
     and meta->>'publish_request_started' = 'true'
     and meta->>'buffer_click_target' like 'https://%';
  return destination;
end;
$$;

revoke all on function public.x_buffer_follow_link(uuid, boolean) from public, anon, authenticated;
grant execute on function public.x_buffer_follow_link(uuid, boolean) to service_role;

commit;
