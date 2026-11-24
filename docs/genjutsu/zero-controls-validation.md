## Estado final publicado

Código `eb317400eefd5a1a93a4445969f3e8d37fa4e16f`, Vercel `dpl_Ur8FuZ78tM6AW8uDg2X8kaSFc9Hw` READY. Domínio cloudent-flow.vercel.app devolveu index.html, genjutsu-ui.js e sw.js idênticos ao checkout; UIv21/SWv116. Status Vercel success no commit. Backend API58/Motion34/Production45 conferido.

# GENJUTSU 0 — controles de fila e calendário

Validação em 23/11/2026 (America/Sao_Paulo). Patch inicial `10a0949a5a3efa20b2fdb854014db8bdca4fc1e6`; frontend inicial Vercel `dpl_AnfnJM93fV8DcdfEb4nn1a4FV664` READY. Complemento corrige boot do worker, mantém geração ativa acima dos pendentes e passa o job conhecido para remover agendamento. Backend final: cloudent-api v58, motion-control-worker v34, production-worker v45; fontes implantadas conferidas. Nenhum node/workflow RunningHub editado.

## Causas e mudanças

- Exclusão antiga rejeitava pendentes; controles recentes estavam no Supabase sem sincronização com Git. `genjutsu_queue_action` serializa exclusão/prioridade com claims, verifica dono/estado/leases, mantém tombstones e preserva arquivos. Remoção ativa só finaliza após estado terminal; aceitação da solicitação remota é pendência, não confirmação. Criação incerta bloqueia exclusão automática. API expõe erro de cancelamento sem esconder o job.
- Prioridade ausente na UI. `queue_priority_at` persiste em pai e filho, acompanha handoff e ordena seleção real, imagem e UI; remover prioridade restaura FIFO. Prompt em análise ou lease ativa não é interrompido. GENJUTSU continua serial, Face Swap mantém capacidade própria e consulta capacidade do provedor.
- Calendário existia, mas o fluxo genérico escondia o resultado e removia-o da lista. Reutilizado modal nativo com TAG, escolha entre contas conectadas, vagas e horário; RPC transacional impede duplicação e mantém caminho/bytes do arquivo. Sem limpeza/reencode adicional ao agendar GENJUTSU. Vídeo permanece com selo Agendado; remoção usa a referência recebida pelo modal.
- Worker GENJUTSU ainda subtraía ocupação de outros módulos do limite local. Agora conta apenas o próprio módulo antes do guard externo. Lease de imagem no banco conta apenas imagens. Executor Face Swap legado também pode progredir sem vaga local de produção. Advisory locks de transação protegem claims, sem representar bloqueio durante toda a geração.
- Integração real é SPA + Edge Functions, não Next.js. Mantida arquitetura existente.

## Arquivos

`genjutsu-ui.js`, `index.html`, `sw.js`; helpers `image-pipeline-api.ts`, `image-pipeline-cancel.ts`, `image-pipeline.ts`; entrypoints `cloudent-api`, `cloudent-motion-control-worker`, `cloudent-production-worker`; migration `20261124021000_genjutsu_zero_queue_controls.sql`; teste PostgreSQL `supabase/tests/genjutsu-zero-controls.sql`; testes UI/cache/boot e suíte `test-stability.mjs`.

## Testes e evidências

| Teste | Resultado |
|---|---|
| A Exclusão | PostgreSQL isolado, tabelas temporárias/rollback: pendente vira tombstone, nunca é escolhido novamente; tarefa remota ativa não é apresentada como cancelada; exclusão após confirmação terminal passa. |
| B Prioridade | Três jobs isolados, último priorizado selecionado pelo claim real; segundo claim bloqueado. Interface publicada priorizou `3194fe8d`, Supabase persistiu timestamp e `genjutsu_serial_head` apontou esse ID. Prioridade removida após validação, ordem original restaurada. |
| C Calendário | Interface publicada agendou resultado `f5a460a7` em Jujuh para 24/11 10h, schedule `a77ac317-339e-4dcc-a58b-c9d46aa9a56b`, um publish job, card mantido/Agendado, presença confirmada visualmente no calendário. Agendamento de teste retirado pela interface após o complemento: schedule cancelled, publish job cancelado, vídeo pronto preservado e scheduled=false; nenhuma publicação social. SQL isolado também confirmou idempotência, arquivo original e conta. |
| D Paralelismo real | Em 24/11 02:19 UTC, GENJUTSU job `b1075dd5`/task `2125043029236862978` e Face Swap QA `3d6a90fe`/task `2125051411171725313` estavam ambos RUNNING, com provider_status RUNNING. Face Swap READY às 02:20:08Z, arquivo salvo, last_error null. Recibo settled SUCCESS: 7,31 pontos. Nenhum GENJUTSU adicional disparado para teste. |
| E Recuperação | Falha isolada libera próximo claim; imagem não bloqueia geração e geração não bloqueia lease de imagem. Erro de boot descoberto após primeiro deploy do worker corrigido em v45, request real 220495 retornou 200; novo teste de boot incluído na suíte. |
| F Persistência | Recarregamento autenticado preservou selo Prioridade; timestamp real persistido, remoção real voltou a null. Estados/resultados persistem no backend. |
| G Regressão | 60/60 testes suportados passaram, incluindo V7, calendário, contas, captura482/hash, pontos, X e permissões. Transpilação/sintaxe de seis TS, 11 scripts inline e assets JS passou. |

## Segurança, operação e limites

Migration aplicada; RPCs restritas a service_role, RLS das tabelas mantida. Advisory de saúde limpo; avisos de segurança preexistentes (tabelas privadas sem policies e funções antigas) não foram silenciados abrindo permissões. Consultas pequenas/metadados; banco medido em90MB. Sem migração de mídia para Supabase, exclusão de arquivo compartilhado, upgrade ou aumento de cotas; cotas mensais oficiais completas não aferidas.

Checagem TypeScript executada: `tsc` sem ambiente Deno acusa imports/globais de runtime; `deno check` com dependências locais alcançou20 erros preexistentes em callbacks/tipos legados (incluindo BlobPart). Não apresentar typecheck estrito como aprovado. Deno lint executado:373 ocorrências nas sete fontes; execução da base anterior:363 (regras e ambientes de importação diferem). Não apresentar lint como aprovado. Projeto não define scripts de lint/build TypeScript; build real é Vercel estático/Python/Node, validado pelo deploy. Sem alegação de revisão visual em aparelho móvel físico.

Cancelamento remoto ativo por Excluir não foi exercitado contra a produção atual para evitar perder vídeo do usuário. Fluxo de falha/pendência/terminal validado em isolamento. A política existente `auto_cancel_enabled=false` do GENJUTSU0 foi preservada; este patch não reativa cancelamento automático. Node482 continua capturado e validado; vaga só libera com fim remoto confirmado. Um histórico incerto permanece bloqueado para reconciliação, sem retry cego.
