# Image pipeline v2 — 2026-10-18

Three views share face_swap_jobs and the current RunningHub executor:

- Face Swap Natural: video + automatic browser first-frame extraction, immutable model snapshot, Face Swap → Upscale → existing Motion V7 worker.
- Face Swap Foto: manual model #23 + manual reference #17 → #240 → Upscale #130 → #131. No Motion.
- Upscale: manual image #130 → #131. No Face Swap or Motion.

Workflow IDs: Face Swap 2111452526003380225; Upscale 2111453733402390530. Strict output nodes: no fallback to arbitrary images. Published workflow graphs are not edited.

Root image is bundled server-side in `_shared/image-pipeline-root.ts` and copied into private production Storage per owner at `USER/face-swap-characters/fixed-SHA256.jpg`. Its bytes are hashed before provider upload. Manual model snapshots are per-job and private. Bulk/reference/result media use existing Backblaze storage; absence of configured B2 blocks upload.

Migration 20261018103656_image_pipeline_stages introduces service-only lease RPC, excludes pipeline v2 from legacy Face Swap claims, serializes shared provider claims, and conditionally wakes the current workers every minute. No table recreation or historical job migration. Stage state, tasks and results live in meta; existing status columns remain compatible.

Dispatch intent is persisted before a billable create. An ambiguous response blocks another create, requiring reconciliation in the provider. Definitive workflow failure permits retry of the same stage. Completed stage outputs survive retries. Motion uses the current production_jobs contract and worker, with original video path unchanged; its dispatch also receives a durable uncertainty guard for pipeline v2 only.

Image jobs can be deleted after terminal state; shared video/calendar files remain under the current native retention rules. Active/uncertain tasks cannot be deleted. UI never adds results to the calendar automatically.

Validation completed: local pipeline tests cover independent photo jobs, strict node selection, manual-only upscale, original video handoff, repeat polling, ambiguous dispatch, failed upscale retaining Face Swap result, capacity guard and TS parsing. Existing calendar, route guard, X role and Motion cancellation/capacity tests passed. SQL transaction with rollback verified exclusion from legacy claims, single-job leases, capacity and revoked anon/authenticated grants. Initial SQL fixture omitted storage_provider=r2 and correctly hit backblaze_required; fixture corrected and passed.

Validation limits: local Playwright UI test could not launch because Chromium is not installed. New paid media generations and final image/video outputs have not yet been validated end to end. A successful deploy and unit/SQL tests are not evidence of a completed provider generation. Browser first-frame extraction still occurs before registration; closing the browser before upload confirmation interrupts that preparation. Once registered, processing continues in cloud workers.
