-- Emergency pause. Preserves media, posts, account IDs, tokens and audit history.
-- Keep authorization gates and revoked unsafe RPC privileges in place.
begin;
update public.x_account_configs set enabled=false,updated_at=now();
update public.x_publish_configs set enabled=false,updated_at=now();
update public.app_members set enabled=false,updated_at=now() where role='x_user';
commit;
-- Original function definitions and policies are in cloudent_private.x_rollout_backup.
-- Never restore legacy account-fallback workers against multi-account jobs.
