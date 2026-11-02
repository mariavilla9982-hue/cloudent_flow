# Motion V7 default hardware — 2026-11-02

The user requested the highest-VRAM GPU for the Motion V7 tab. `app_settings.motion_control_workflow` now selects `executionInstanceType=ultra`, `executionVramGb=84`, `hardwarePolicy=motion_default_84gb`. RunningHub documents Ultra as the highest exposed tier (84 GB); the physical GPU model is assigned by RunningHub. No silent fallback to Plus. This is hardware selection outside the unchanged workflow graph and media nodes. It applies when new V7 tasks are dispatched; existing tasks are not restarted and failed jobs are not automatically retried by this change. No paid QA generation.

Ultra dispatch uses the existing durable intent and accepted-task recovery. Default Ultra jobs do not receive a fabricated one-time grant. Historical one-time grants still retain their pending/consumed, job/workflow and attempt restrictions. Legacy Plus configuration remains supported for rollback. UI shows Ultra / 84 GB with refreshed PWA assets.

The historical limited authorization below is retained for its original job only; its Plus global-default statement is superseded by the current user request.

# One authorized Ultra attempt — 2026-10-27

The user approved one new 84GB Ultra attempt only if task `2115252978189692929` on job `8ab39831-6662-4d7d-88d0-8698edfdb32c` definitively fails. The current 48GB execution must continue; success means no retry.

Motion keeps Plus/48GB as the global default. A server-side per-job grant in `meta.execution_ultra_once` must be pending, identify the same job and immutable workflow, and allow only attempt 1/max 1. Ultra also gets the existing durable dispatch intent for standalone jobs. A provider-accepted task consumes the grant atomically with attachment; an attachment recovery persists the same task and consumed grant. Queue refusal preserves the authorization without counting as a billable attempt. Ambiguous creates remain blocked for reconciliation. A used grant blocks any further Ultra create.

The operation in `supabase/operations/one-ultra-retry-20261027.sql` replaces `APPROVAL_UUID` with the unique approval ID recorded privately in the project Brain. It only rearms the exact source job/task when provider FAILED is recorded for that task, with no result, no lease, no uncertainty/dispatch intent and no previous grant. Other statuses, success, different tasks and replay are no-ops. Source errors are preserved in the grant. Inputs, workflow ID/nodes/parameters, scheduling, source files and global hardware policy are unchanged.

The conditional check uses a bounded hourly automation. It must confirm the deployed worker version before running this operation, never call RunningHub create directly, never reset a second attempt and pause after success, final failure or uncertainty requiring reconciliation. Worker tests use mocks; no paid QA task is authorized beyond the conditional attempt above.
