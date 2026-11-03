# GENJUTSU: recoverable prompt analysis

The 503 retry exposed a second failure: the invocation executing the synchronous Gemini generation was shut down with reason WallClockTime after 150 seconds (execution 3bc9b49b-6482-4243-a888-04ba288fcd3f on 2026-11-03). Its generating checkpoint had no retrievable response ID.

Prompt preparation now uses Gemini Interactions background=true/store=true, Api-Revision 2026-05-20, same gemini-3.8-flash and original instructions1040. File API references remain bound to each video's fingerprint. No previous_interaction_id is shared between videos. Each short worker pass either prepares files, creates one analysis, or GETs its saved ID. Only model_output text from a completed interaction can become the validated/hash-checked prompt910. A saved prompt is reused.

The adapter yields within45 seconds and caps individual requests at25 seconds. Explicit503/429 backoff retains uploaded files and an accepted analysis ID. Polling timeouts/invalid JSON retry retrieval, without a new analysis or RunningHub create. Timeout of creation without any returned ID remains uncertain and blocked, since the provider does not document idempotent creation. Exhausted retries and terminal incomplete responses fail clearly. The same interaction can be recovered after a failed final prompt write. No alternate model/tier or extra tools.

The historical legacy job can only be reanalyzed with an exact, owner-linked, taskless/resultless/intentless guarded reset and an audit timestamp under the user's new explicit repair request. This one-time recovery does not assert the old non-stored Gemini request was unbilled. Never broadly unlock unknown RunningHub dispatches.

Validated: async create/poll,503/429/budget, deadlines, network/JSON recovery, identity/model isolation, media/instructions, unsafe upload origins, output validation, final save recovery, owner lease, manual retry, actual worker dispatch and482 capture/cancel. Production results and deployed versions belong in the Brain release entry.

References: https://ai.google.dev/gemini-api/docs/background-execution ; https://ai.google.dev/api/interactions-api ; https://ai.google.dev/gemini-api/docs/video-understanding

## Terminal background infrastructure failures

Real recovery on 2026-11-03 accepted an interaction but returned HTTP200/status=failed with errors[0].code=INTERNAL. These errors live in `errors`, not `error`. The adapter now retries terminal INTERNAL/UNAVAILABLE/RESOURCE_EXHAUSTED/DEADLINE_EXCEEDED failures using the same bounded backoff budget as503. It clears only the confirmed terminal interaction ID, retains its previous ID and sanitized codes, and reuses the same uploaded media for an independent analysis. Unknown, mixed, safety, invalid input and incomplete responses remain terminal. Raw upstream messages are never persisted. Tests cover HTTP200 failed polling, delayed recovery, media reuse, exhausted retries and refusal isolation.

## 2026-11-03 — User-authorized continuous validation

Supersedes the historical retry-count limit above: transient503/500/502/504 and explicit terminal INTERNAL/UNAVAILABLE/RESOURCE_EXHAUSTED/DEADLINE_EXCEEDED now keep retrying until a valid prompt is saved or the user stops the job. The retry counter remains diagnostic; exponential spacing caps at one hour and Retry-After is respected within the existing ceiling. RESOURCE_EXHAUSTED is quota_waiting. Refusals, invalid inputs/outputs and ambiguous creation without an ID remain blocked; this does not authorize changing models, billing tiers or safety settings. Accepted analysis IDs continue to be retrieved; only confirmed terminal failures allow a new analysis. Expired Google file references are refreshed from immutable original owner media, with the same fingerprint and no Supabase media duplication.

Live diagnosis: video5267194B/videoMP4 and image7281827B/imagePNG both returned HTTP200/ACTIVE; Google video metadata reports18seconds. Latest completed analysis failed with RESOURCE_EXHAUSTED and only a generic provider message, so the exact quota/resource type is unknown. One minimal same-model generateContent call asking only for OK returned503/UNAVAILABLE with explicit high-demand message. This establishes provider/model unavailability without media or long instructions; it does not prove the full request could never have other issues. No final prompt/video validated yet. Temporary diagnostic disabled after use.

Tests: more than12 consecutive transient failures stay resumable, wait grows to one-hour cap, media reused and eventual valid output completes; HTTP5xx and quota classification; permanent/mixed/safety faults blocked; expired file renewal through actual owner-leased stage; accepted IDs and media/instructions binding; dispatch and482 capture regressions.

## 2026-11-03 — Production uses validated Gemini3.5FlashLite

User explicitly requested completing the process after the successful full-media model test. Production prompt preparation and readiness now use gemini-3.5-flash-lite, with the same original system instructions and background Interactions API. Generation config matches the successful test: max_output_tokens8192, no thinking-level override. Exact per-video fingerprint and output hash checks remain mandatory; simply changing the old state's model is rejected.

The server-only adoption helper verifies a completed test against a fresh provider retrieval: model/interaction ID, full system instruction and user input, exact video/image Files URIs and MIME types, stored test output equality, sizes, and Google Files SHA256 metadata. It reconstructs and verifies the old3.8 fingerprint from the byte hashes, then computes the new3.5 fingerprint and prompt SHA256. Owner paths, taskless/resultless/unlocked state and absence of dispatch intent are required; caller writes with version/owner guards. No reanalysis/upload is needed. Tests reject changed file bytes, request/instructions/output/model/ID, existing task/result/intent/lease, wrong owner and changed legacy fingerprint. The helper never creates/cancels tasks.

The original node1040 instructions, nodes970/496/910/482, Ultra84GB and capture-before-cancel protections remain unchanged. A completed structural validator check does not claim every semantic requirement was independently reviewed. Only the existing test job is promoted; no other workflow or calendar is rearmed. Runtime versions and actual paid task/output outcome belong in Brain.
