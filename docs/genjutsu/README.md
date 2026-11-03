## Vídeo + frame manual — 2026-11-03

A aba GENJUTSU agora abre com dois campos no estilo do Motion V7: vídeo de referência e frame/personagem livre. O frame enviado é a imagem final: não roda extração, Face Swap ou Upscale nesse modo. A seção recolhida “Preparar com uma modelo salva” preserva o fluxo automático anterior e os trabalhos já existentes.

`input_mode=manual_frame` só é aceito para Genjutsu. Vídeo MP4/WebM/MOV até30MiB, imagem JPG/PNG/WebP até10MiB; ambos privados no B2 e verificados antes de ativar a fila. Modo, duração e descritores ficam fixos por UUID; retentativa de upload mantém o ID, trocar/remover arquivo cria outro. Nenhuma mídia manual de fallback no Supabase.

O pai inicia em `frame_ready`; o worker usa a mesma lease/FIFO serial Genjutsu e encaminha exatamente os dois arquivos ao job de produção, sem criar tarefas de imagem. `prepared_frame` registra a imagem manual para retomada, sem fabricar resultado Upscale. O executor permanece Gemini com1040→910, vídeo970, imagem496, Ultra84GB, captura482/persistência antes do cancelamento. Sem mudança no grafo, schemas, crons ou políticas RLS.

Validação: `test-genjutsu-manual.mjs`, controlador `test-genjutsu-ui.mjs`, e regressões dos pipelines automáticos, retentativa, Gemini, dispatch e captura. Nenhuma análise/geração paga é iniciada pelos testes. Chromium indisponível; testes de controlador/DOM não comprovam aparência em navegador real nem qualidade de uma geração real.

# Genjutsu production pipeline

Published workflow: **2117411301344411649**. Gemini model: **gemini-3.8-flash**. The real account preflight on 2026-11-03 returned HTTP200 for the model and validated the published graph. Availability does not prove free-tier eligibility or impose a spending cap.

The separate Produção IA → Genjutsu tab submits videos to the existing image pipeline. Each video requires an explicit model choice. The original video supplies the first frame; Face Swap and Upscale produce the final model image. The private motion worker uploads the original video (with audio) and final image to Gemini Files, using the exact instructions from note1040. It checkpoints the prompt before dispatching RunningHub.

| Runtime node | Field | Input |
|---|---|---|
| 970 | video | Original video |
| 496 | image | Final upscaled model image |
| 910 | value | Validated Gemini response |
| 482 | SaveVideo output | Capture MP4, verify storage, then cancel exact task |

Execution requests Ultra84GB (`instanceType: ultra`). The published graph and all other node parameters remain unchanged, including QueueStop1044 and segmentation502. V7 and standard paths keep their existing workflow IDs and inputs.

## Queue and task lifecycle

`genjutsu_image_eligible` and `claim_genjutsu_job` serialize the entire Genjutsu job in Postgres, under the existing RunningHub advisory lock and shared provider capacity. Later Genjutsu Face Swap jobs wait for the earlier parent to finish its video stage. This is enforced server-side, including concurrent workers and expired leases. A recoverable pre-create reservation is deducted from the worker capacity precheck before reclaim, so concurrency1 does not deadlock on its own expired slot. The atomic RPC still enforces shared capacity and dispatch uncertainty. Other workflow types retain their existing behavior.

Gemini file descriptors and prompt/hash are saved under the owner and current worker lease. Processing and quota waits release the lease and resume through the existing minute scheduler. Completed prompts and uploaded Google files are reused. A durable generating checkpoint precedes generateContent; an ambiguous generation response blocks automatic replay. A durable dispatch intent precedes RunningHub create; an ambiguous create never permits a second task. Retry is explicit and restricted to safe pre-dispatch failures or provider-confirmed FAILED tasks.

The production monitor binds output482 to the exact task, copies and verifies it before cancellation, and exposes the result while cancellation remains pending. The job holds its provider slot until terminal confirmation. Genjutsu media uses the existing B2 primary storage and budget guards; it never falls back to Supabase Storage. A metadata-write failure retains a verified result object for recovery.

Limits: video30MiB, final image10MiB, result40MiB, positive actual duration. Supported source video types: MP4/WebM/QuickTime; final images: JPEG/PNG/WebP. Google file expiration is respected; no separate file deletion scheduler is introduced.

## Authentication and visibility

The new setup endpoint uses native Supabase admin authentication plus a live Cloudent session, or the existing internal worker secret. It exposes only sanitized cached readiness. Credentials, upload-session URLs, raw prompts and Google file references are not sent to the new UI. The key belongs in Supabase Edge Function secrets as GEMINI_API_KEY and is never stored in client code.

The new tab polls only while visible, filters its queue server-side, and fetches model names without base64 photos. The existing minute cron gets a conditional Genjutsu wake; no duplicate cron or unconditional idle request is added. The SQL operation changes service-only queue functions and preserves existing jobs, tables, RLS and calendar data.

## Validation and limits of evidence

Run the focused scripts `test-genjutsu-gemini.mjs`, `test-genjutsu-readiness.mjs`, `test-genjutsu-dispatch.mjs`, `test-genjutsu-capture.mjs`, `test-genjutsu-ui.mjs` and the existing image/Motion regression scripts. `supabase/tests/genjutsu_serial_queue.sql` exercises the queue functions against temporary tables inside a rollback-only transaction.

Coverage includes media/instruction mapping, structural prompt validation, bounded timestamps, Google upload allowlists, resume/quota/uncertainty handling, task creation ordering, durable task recovery, exact482 capture, verification-before-cancel, pending-cancel slot retention, UI isolation and stable upload retries. Synthetic media and mocked providers do not establish semantic fidelity, accurate transcription, full timeline coverage or frame-perfect synchronization.

No real Gemini media analysis or paid RunningHub video generation has been started as a QA action. The first real sample must validate the complete output, timing and published QueueStop behavior. DOM/controller tests passed; actual browser visual QA was unavailable because Chromium could not be installed. Existing unrelated baseline test failures must not be represented as passing checks.

Source instructions: `GENJUTSU DA SHOPEE - VYSSEA - C_CNET (5).json`, SHA256 `83e6b60466ef594921c3ca03e0e3120b6674f6789b13d2ef0e0696d9af60bc5d`.

Official references: https://ai.google.dev/gemini-api/docs/files, https://ai.google.dev/gemini-api/docs/video-understanding, https://ai.google.dev/api/models, https://ai.google.dev/api/generate-content.
