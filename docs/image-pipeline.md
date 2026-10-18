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

Live smoke confirmed both published API graphs and exact node types (HTTP200/code0), root persisted privately (558370 bytes, matching SHA256), Backblaze PUT/GET200 with exact length and probe cleanup204. Unauthenticated pipeline API returns401. Temporary audit endpoint disabled v2 with410 and JWT required. No paid generations were started. SWv40 excludes the old queue decorator; legacy upload routes return409. Session changes discard selected files and previews.

## Queue handling and organized cards — 2026-10-18

Pipeline v2 scans jobs by created_at/id, oldest first. A capacity check happens before workflow validation or media reads. A full queue stops further dispatch for that sweep, while existing task IDs continue to reconcile. Only explicit TASK_QUEUE_MAXED rejection with a nonzero provider code and no task ID clears the dispatch intent and returns the same stage to waiting. Ambiguous creates remain blocked; a known task ID never causes another create. No workflow graph, node, or saved input is edited.

Queued tasks use provider status and keep started_at null. RUNNING starts the stage clock once; polling preserves it. Unknown API states do not infer RUNNING. The existing minute cron resumes waiting jobs when capacity permits; no extra cron or media cache was added. Only the specific existing TASK_QUEUE_MAXED Upscale rejection without a task/output was repaired, preserving the Face Swap result and original inputs. Genuine failures remain visible.

Cards group processing, queued, completed and attention states. Queue positions are relative to the currently loaded mode, not the provider's global queue. Waiting stages have no running animation or error badge; completed stages retain checkmarks. Existing actions, preview ownership, X Studio and calendar behavior remain intact. Tests include explicit rejection/resume, blocked dispatch with active polling, stable started_at, queue UI ordering and genuine error visibility. Browser rendering was not verified: local Chromium unavailable and browser download failed. No paid QA generation was initiated; existing user jobs resume under their original automation.


## Independent stage buffers and fast-stage priority — 2026-10-18

User clarified that Face Swap must continue processing the input backlog while completed faces wait in the Upscale buffer, and completed upscales must move into the Motion waiting buffer. This supersedes whole-job FIFO dispatch priority.

The worker now reads bounded active, Face Swap waiting, Upscale waiting and Motion waiting queues independently, polls existing tasks first, then dispatches Face Swap before Upscale. SQL lease selection enforces that priority and FIFO within each stage under the same advisory lock used by all claims. A backlog of Motion parents cannot hide later Face Swap candidates behind a global LIMIT.

The Motion claim excludes NEW chained pipeline v2 jobs while any eligible image stage remains waiting/uploading/queued/running. Standalone Motion retains its current scheduling rules. Existing Motion task IDs, running tasks, output384 capture, hardware and graphs are untouched. An upscale result is still saved and immediately registered in production_jobs as motion_waiting; registration does not occupy a provider slot. The same minute cron drives processing in the cloud. Continuous arrival of image work can delay chained Motion under this explicit fast-stage priority; no separate provider capacity is invented.

The provider currently permits two concurrent tasks across this key, not two per workflow. The two previously running Motion tasks still occupy those slots and are not cancelled. Once a slot becomes available, the new priority applies. No paid QA create, new media copy or broad job reset was used for validation.

Migration20261018173033_image_pipeline_stage_queues changes only the two existing service-only claim/lease functions. SQL tests inside ROLLBACK verify Face Swap before older Upscale, FIFO, duplicate lease exclusion, chained Motion deferred through queued/running fast stages, eligibility after image completion, standalone Motion compatibility and grants. UI labels and counters show the three stage queues separately, including stage-relative positions and saved intermediate results.
