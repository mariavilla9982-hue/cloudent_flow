# X Studio: multiusuário e filas por conta

Estado: código publicado em branch de revisão; NÃO implantado no Supabase ou em produção.

## Atualização de envio — 16/10/2026

O proprietário autorizou explicitamente o envio público após a revisão automática. Código publicado pela conexão GitHub na branch `codex/x-studio-multiuser-isolation`, commit `bb95c7d5dd50edbc38a6f7a647a56773405b3a1f`, com os 22 blobs conferidos contra os arquivos locais. PR de revisão: https://github.com/mariavilla9982-hue/cloudent_flow/pull/1 (draft, sem merge). O bloqueio de push descrito abaixo é histórico e já foi resolvido pela autorização.

A nova tentativa de migração Supabase também retornou `Invalid or expired requestState`. Leitura posterior confirmou que `workspaces` e `x_account_configs` seguem ausentes. O plugin está instalado/habilitado e consultas funcionam; a causa da falha de migração não foi estabelecida. Produção e Edge Functions não foram alteradas. Não promover a interface antes da migração, APIs e testes reais.



## Comportamento

- `admin` preserva o papel existente do proprietário. `x_user` consulta a associação ativa no banco, entra no X Studio e recebe 403 nas APIs administrativas.
- Convites individuais de X Studio são criados pelo administrador na configuração do X. O link expira em 24 horas, é consumido uma vez e só atribui `x_user`; não envia email automaticamente.
- Contas pertencem a um workspace e a um usuário. Autorizações adicionais são explícitas. Reconexão OAuth não transfere propriedade.
- Nenhum token de plataforma é retornado no status. Configurações cruas continuam sem policy de leitura no navegador.
- Publicação exige `platform_account_id`. Um vídeo enviado para N contas gera N jobs independentes; chave de origem+conta evita enfileirar o mesmo upload novamente.
- Calendário reserva `(platform_account_id, scheduled_at)`. Claim serializa por conta; external post ID confirmado impede repetição. Respostas incertas do X ficam bloqueadas para inspeção: a API não fornece aqui garantia absoluta de exactly-once quando a resposta se perde.
- Lotes aceitam várias mídias com legenda, comentário opcional e horário próprios. Cada post envia um único vídeo; não envia mais de quatro vídeos no mesmo payload.
- Reply publica após o post principal e registra status/erro/ID próprios. Falha de reply não desfaz publicação; envio incerto não recebe retry automático.
- Métricas ficam por conta/post, com atualização manual e tentativa automática a cada seis horas em contas habilitadas. Métricas privadas têm limitações de disponibilidade na API. A interface não inventa métricas ausentes.
- Sete contas é limite visual inicial de adição; não há CHECK de sete contas no banco. Worker visita até sete configurações por execução em rotação por heartbeat.
- Remover arquiva/desconecta a conta e apaga as credenciais locais da plataforma; preserva histórico e propriedade. Não revoga remotamente o consentimento OAuth no X.

## Validação executada

- Parse de JS/TS e scripts inline.
- `node scripts/test-x-studio-isolation.cjs`: 403 administrativo, IDOR, associação desativada, metadados sem tokens, cinco jobs com uma falha, replay, retry individual e reply incerto.
- `node scripts/test-x-studio-ui.cjs`: resposta atrasada da conta anterior descartada.
- Testes existentes de calendário multi-conta, seletor Face Swap e reconexão Instagram passaram. Os mocks agora incluem a associação administrativa e o método DOM usado pelo loader preexistente.
- Migração aplicada em PGlite PostgreSQL isolado, com definições de tabelas/constraints obtidas do banco real e identidades fictícias. `supabase/tests/x_studio_isolation.sql` passou: horários iguais em contas distintas, conta obrigatória, ownership, claim repetido, replay e RLS sob `authenticated`. Os registros do teste são revertidos.
- DOM real da SPA em jsdom: menu restrito, rota negada, seletor, multiple upload, campos por vídeo e comentário renderizados.
- `deno check` remoto não concluiu: download de manifesto JSR falhou. Parse TS e testes de execução passaram; não registrar typecheck completo como aprovado.

## Bloqueio de implantação observado

Em 16/10/2026, duas chamadas `apply_migration` falharam com `Invalid or expired requestState`. Leitura posterior confirmou `public.workspaces` ausente, zero posts X e 190 schedules preservados. Nenhuma Edge Function foi implantada e a branch não foi mesclada à main. O push do código ao repositório público também foi bloqueado pela revisão automática por exigir autorização explícita para exportar o código; os commits permanecem locais. A branch remota criada ainda aponta para a base, sem o patch. Não habilitar convidados antes de concluir a implantação e a validação de autorização real.

## Ordem de implantação

1. Conferir HEAD atual e eventual trabalho concorrente; atualizar esta branch se necessário.
2. Revalidar backup e policies reais. Aplicar `20261016175208_x_studio_workspace_isolation.sql` com a conexão Supabase restabelecida.
3. Rodar `supabase/tests/x_studio_isolation.sql` em transação com rollback no ambiente alvo. Conferir grants/DB advisors; não reabrir funções de worker para `anon`/`authenticated`.
4. Implantar fontes/dependências completas de `cloudent-api`, `cloudent-motion-control`, `instagram-status`, `instagram-publish-test`, `instagram-metrics-today`, `instagram-followers-status`, `cloudent-virals-foryou`, `cloudent-x-oauth`, `cloudent-x-publish-worker`, `cloudent-member-signup`. Manter configuração JWT original e autenticação interna de OAuth/worker.
5. Validar sessões reais owner/x_user: acesso direto, IDs alheios, desconexão, troca rápida A/B, logout e ausência de segredos. Não publicar conteúdo de teste sem um vídeo/conta explicitamente destinado a isso.
6. Implantar a interface e confirmar Vercel READY e versão do SW. Só então liberar convites.

## Recuperação

O SQL guarda definições anteriores de funções e policies em `cloudent_private.x_rollout_backup`, sem copiar senhas/tokens. A mudança é incremental; não exclui mídia, schedules ou tabelas existentes.

`supabase/rollback/x_studio_workspace_pause.sql` pausa publicação X e desativa `x_user`, preservando dados. Manter os novos gates de autorização durante recuperação. Não restaurar worker legado com fallback contra jobs multi-conta.

## Limites que ainda exigem validação real

OAuth, refresh e publicação/reply com contas reais; UI mobile visual; os dez cenários finais no ambiente implantado; ponta a ponta até a API X. O endpoint health distingue `not_probed` de disponibilidade confirmada; não implementa um monitor ativo de disponibilidade de Vercel/Storage. A importação Drive legada foi bloqueada até ter mapeamento explícito de conta; uploads locais/lotes são o caminho deste patch.

Referências oficiais verificadas:
- https://docs.x.com/x-api/posts/manage-tweets/integrate
- https://docs.x.com/x-api/posts/manage-tweets/introduction
- https://docs.x.com/x-api/fundamentals/metrics
- https://supabase.com/docs/guides/database/postgres/row-level-security
