-- Compatibility repair for the live global Smart Scheduler.
--
-- cloudent-automation-worker currently upserts smart_recommendations with
-- ON CONFLICT (weekday, rank), while evaluate_smart_time_validation() also
-- addresses validation rows by that same global slot key. The multi-account
-- schema already keeps account-scoped indexes, but PostgreSQL still needs a
-- matching global unique arbiter for the live worker until the Smart Scheduler
-- itself is migrated end-to-end to per-account learning.

create unique index if not exists smart_recommendations_weekday_rank_compat_uidx
  on public.smart_recommendations (weekday, rank);

create unique index if not exists smart_time_validation_weekday_rank_compat_uidx
  on public.smart_time_validation (weekday, rank);
