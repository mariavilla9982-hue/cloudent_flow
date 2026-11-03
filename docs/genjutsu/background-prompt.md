# GENJUTSU: recoverable prompt analysis

The 503 retry exposed a second failure: the invocation executing the synchronous Gemini generation was shut down with reason WallClockTime after 150 seconds (execution 3bc9b49b-6482-4243-a888-04ba288fcd3f on 2026-11-03). Its generating checkpoint had no retrievable response ID.

Prompt preparation now uses Gemini Interactions background=true/store=true, Api-Revision 2026-05-20, same gemini-3.8-flash and original instructions1040. File API references remain bound to each video's fingerprint. No previous_interaction_id is shared between videos. Each short worker pass either prepares files, creates one analysis, or GETs its saved ID. Only model_output text from a completed interaction can become the validated/hash-checked prompt910. A saved prompt is reused.

The adapter yields within45 seconds and caps individual requests at25 seconds. Explicit503/429 backoff retains uploaded files and an accepted analysis ID. Polling timeouts/invalid JSON retry retrieval, without a new analysis or RunningHub create. Timeout of creation without any returned ID remains uncertain and blocked, since the provider does not document idempotent creation. Exhausted retries and terminal incomplete responses fail clearly. The same interaction can be recovered after a failed final prompt write. No alternate model/tier or extra tools.

The historical legacy job can only be reanalyzed with an exact, owner-linked, taskless/resultless/intentless guarded reset and an audit timestamp under the user's new explicit repair request. This one-time recovery does not assert the old non-stored Gemini request was unbilled. Never broadly unlock unknown RunningHub dispatches.

Validated: async create/poll,503/429/budget, deadlines, network/JSON recovery, identity/model isolation, media/instructions, unsafe upload origins, output validation, final save recovery, owner lease, manual retry, actual worker dispatch and482 capture/cancel. Production results and deployed versions belong in the Brain release entry.

References: https://ai.google.dev/gemini-api/docs/background-execution ; https://ai.google.dev/api/interactions-api ; https://ai.google.dev/gemini-api/docs/video-understanding
