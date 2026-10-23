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

## Motion waiting UI and provider failure diagnosis — 2026-10-18

Task2111862866127663105 was confirmed FAILED by both v2 query and legacy outputs (805), with generic message and empty failedReason. The exact provider cause is unknown; do not claim timeout, OOM, invalid nodes or recovery of a final video. The failed task is retained; no automatic paid retry is introduced.

The screenshot exposed misleading native UI: a chained motion_waiting row was mapped to waiting and displayed Execute/Ready for new attempt even while the fast-image priority was active. The native renderer now recognizes chained Motion, shows automatic queue status, omits Run/Prioritize and explains the number of pending image stages. The production API reads only stage/status for the authenticated owner's active pipeline jobs, bounded101, only when chained Motion is waiting. No media or provider calls are added to UI polling; failure of the explanatory count preserves the normal response. Standard production controls remain.

Generic workflow failures no longer promise automatic retry. The failed task's ID, completed Face Swap and Upscale remain associated for an explicit Motion-only retry through the existing guarded action. New integration tests exercise automatic waiting controls, real upstream counts, own-user scope, standard controls, no fake retry and graceful count failure. Existing scheduler/priority functions are unchanged by this reporting patch.

## Named character variants — 2026-10-23

Follow-up: automatic video now accepts multiple files per picker selection. Each pending video has a separate preview, remove action and character selector. Reopening the picker adds files to the pending list; repeated name/size/lastModified is skipped while pending. Every file must have a character choice before any upload begins. Sends are sequential, one extracted frame cached per source, independent stable model UUIDs, and errors isolated per file. Confirmed videos leave the pending list; failed videos stay for retry without recreating confirmed variants. Logout releases all pending object URLs. Existing backend API, jobs, workers, workflows and calendar are unchanged. UI v9/SWv55.

Automatic video now requires one or more explicit choices: Jujuh, Sahry japah, Sahry grávida. The three original uploaded sheets are bundled byte-for-byte in image-pipeline-characters.ts, with fixed IDs and SHA256 hashes. Registry previews are served only behind the existing authenticated API. No global mutable active model is consulted.

Each selected model gets an independent job with immutable character snapshot, character_id, character_name and tags; the source filename is retained in meta. The chosen sheet is copied to the existing private per-user character prefix with a content-addressed path, never overwritten. Deleting cards/jobs does not delete these named sheets. Existing jobs retain original references and retry rules. New tickets without a selection fail closed; obsolete clients must refresh.

The browser extracts a frame once per submission and submits each selected variant with a stable per-model UUID. Partial upload retry reuses those UUIDs and skips jobs already confirmed. Each variant retains its own input/result storage paths, preserving independent delete/retention behavior. Three choices produce three video generations and the corresponding provider usage. Face Swap → Upscale → Motion V7, published workflow graphs, stage queues, capacity, GPU and cron remain unchanged. Motion handoff copies model metadata and resulting video filenames/downloads carry the model name. Photo and manual Upscale remain unchanged.

Validation: script test-pipeline-characters.mjs covers exact three uploaded hashes, explicit selection, server-owned identity/tags, attempted model switch rejection, legacy jobs, multiple choices, partial upload failure and resumed UUIDs. Existing pipeline stages/capacity/dispatch uncertainty and Motion retry suites pass. Browser visual verification and a new paid end-to-end generation are not included. Supabase current plan free; database ~78 MB and Storage 3,385,770 bytes before patch. New registry totals 560,981 bytes; no bulk video transfer or schema changes. Global egress usage is not established by these measurements.
