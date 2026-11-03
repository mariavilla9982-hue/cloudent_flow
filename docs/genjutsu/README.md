# Genjutsu — Gemini prompt stage (draft)

This change implements the server-side **adapter**, not the Genjutsu tab or its production executor. It is not imported by an active worker. No existing workflow, queue, job, deployment or database configuration changes when these files are added. Do not describe the whole feature as implemented or enabled.

## Implemented and tested locally

`supabase/functions/_shared/genjutsu-gemini.ts` uploads the source video **including its audio** and the final upscaled model photo to the Gemini Files API, then uses the exact note #1040 from the supplied workflow as its system instruction. It checks `models/gemini-3.8-flash` with the configured key before transferring media; no alternate model or billing tier is selected automatically.

The original note is preserved in `genjutsu-instructions.ts`. Its source is `GENJUTSU DA SHOPEE - VYSSEA - C_CNET (5).json`, SHA-256 `83e6b60466ef594921c3ca03e0e3120b6674f6789b13d2ef0e0696d9af60bc5d`. The editor JSON and published graph are not edited. A per-request instruction labels the media and actual duration, requires an explicit Subject 1 definition, and asks for prompt text only.

Only complete, structurally valid responses are saved. Validation checks the six ordered sections, required tags/rules, no unfilled placeholders or code fences, and timestamps within the source duration. It **does not** establish semantic fidelity, accurate transcription, English-only prose, full timeline coverage or frame-perfect synchronization. Those require a real sample and output review.

`genjutsuExecutionInputs(...)` prepares exactly three authorized runtime inputs:

| Node | Field | Value |
|---|---|---|
| 970 | video | Uploaded original video identifier from RunningHub |
| 496 | image | Uploaded final photo identifier from RunningHub |
| 910 | value | Validated Gemini response, replacing the sample in that execution |

It requests `instanceType: ultra`; it never calls RunningHub create/cancel. The saved prompt's hash must match before building the inputs. The destination workflow ID must be provided from the actual published RunningHub workflow; the editor UUID is not that ID.

## Resumption and ownership contract

Call `prepareGenjutsuPrompt` **only from an authenticated internal worker**, after loading the exact user's job/media server-side and acquiring the persistent job lease. Do not expose Blob input, state, API keys or arbitrary storage paths through a public endpoint. This module does not implement authorization or queue claims itself.

The supplied `checkpoint` callback must atomically save state under the owner's job and the current lease/version, rejecting a stale worker. Do not implement it as an unconditional metadata overwrite. The complete state contains only the media fingerprint, model/duration, bounded file descriptors, phase, prompt/hash, retry deadline and numeric usage. It never persists the API key or upload session URL. Existing metadata must be merged without erasing task/capture records.

Video/photo/instructions/duration/MIME are fingerprinted. Changed inputs require a new job. Completed prompts are reused without another Gemini request. Each file descriptor is checkpointed before the next operation. Processing files return `ready: false`; the caller resumes through its regular scheduler rather than a busy loop. Expired/failed descriptors stop and require controlled handling, not silent media substitution. Google retains uploaded media according to its Files API expiration; this adapter does not add a deletion scheduler.

A durable `generating` state is saved **before** generateContent. If that request times out or its response cannot be saved, the next invocation blocks replay as uncertain. A definite 429 records a retry deadline and permits retry only after that time, reusing existing uploads. Other failed or incomplete responses never authorize a RunningHub job. A configured paid Gemini project can incur charges; this adapter does not detect or enforce the account's free tier or a spending cap.

Adapter limits: source video up to 30 MiB (MP4/WebM/QuickTime), final photo up to 10 MiB (JPEG/PNG/WebP), positive actual duration. Requests have a 90-second per-request timeout; a worker must also budget total execution time and retain its lease. Files API upload destinations and file URIs are restricted to Google's API origin; redirects and arbitrary URLs are rejected. Raw provider errors, secrets and media content are not included in surfaced errors.

## Required before activation

1. Configure `GEMINI_API_KEY` in the secrets of the **runtime that runs the worker**. Existing production pipeline workers are Supabase Edge Functions, so a key only in Vercel will not reach them. Do not paste the key into source, the Brain, a PR or chat. Inspect only presence when diagnosing secrets.
2. Confirm that the account exposes the exact requested model and its current free/paid quotas. The adapter fails closed if unavailable; documentation alone is not proof of account access.
3. Obtain the Genjutsu published RunningHub URL/ID and API-format graph. Verify 970/video, 496/image, 910/value and SaveVideo482 against it.
4. Add a Genjutsu choice to the existing API/UI; wire this adapter after Upscale and before provider dispatch. Keep all existing V7/standard jobs and their configuration intact. New state must be stored as bounded metadata under the authenticated owner.
5. Add a persistent **one-job-at-a-time** claim for this new workflow; do not rely on a browser button, an in-memory flag, or this adapter to enforce concurrency. Extend the existing scheduler without blind polling/extra idle load, respecting storage/capacity guards and provider dispatch uncertainty.
6. Implement capture from **node 482**, copy and verify the MP4, provide download, then cancel the exact RunningHub task. Preserve the result while cancellation is pending; do not free its provider slot until terminal state is confirmed. No cancellation is implemented by this adapter.
7. Validate the effect of the existing QueueStop1044 and the fixed segmentation target at502. Preserve the graph; discuss necessary internal changes separately instead of changing it implicitly.
8. Run an authorized sample through the complete chain. Current tests use mocked HTTP responses and synthetic Blob bytes only; no real Gemini/RunningHub generation has been performed.

## Validation

Run `node scripts/test-genjutsu-gemini.mjs` on Node24. It covers exact instructions/media, prompt substitution, stored prompt reuse, changed inputs, missing key, invalid media, unavailable model, upload host restrictions, processing/resumption, lost lease, uncertain calls, quota waits, truncated/blocked output, invalid timestamps/sections, and corrupt saved prompts. Also run the existing image pipeline regression test.

Official API references consulted during preparation:
- https://ai.google.dev/gemini-api/docs/files
- https://ai.google.dev/gemini-api/docs/video-understanding
- https://ai.google.dev/api/models
- https://ai.google.dev/api/generate-content
