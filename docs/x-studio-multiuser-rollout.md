# X Studio: multiusuário e filas por conta

Estado: migration e backend implantados no Supabase em 16/10/2026; interface aguardando promoção final pela PR/Vercel.

## Atualização de implantação — 16/10/2026

O acesso ao Supabase foi restabelecido no projeto `dxrhvudvutmgrmfkmzxo`. A migration `x_studio_workspace_isolation` foi aplicada com sucesso. O teste `supabase/tests/x_studio_isolation.sql` foi executado no banco real dentro de transação com rollback e retornou PASS para slots independentes, ownership, conta obrigatória, claim atômico, replay protection e RLS.

As Edge Functions foram implantadas a partir do commit fixo `b8372286641672c269d0ca01c51f326af6df10f3`, preservando o código exato da PR: `cloudent-api` v88, `cloudent-x-publish-worker` v6, `cloudent-x-oauth` v3, `cloudent-member-signup` v3, `cloudent-motion-control` v6, `cloudent-virals-foryou` v2, `instagram-status` v4, `instagram-publish-test` v6, `instagram-metrics-today` v7 e `instagram-followers-status` v4. O worker X novo foi observado em produção retornando HTTP 200 e usando `x_account_configs`, `cloudent_x_access` e `claim_x_account_post`.

Advisors de segurança foram consultados depois da DDL. O aviso de `search_path` do claim legado do X foi eliminado com a migration complementar `20261016194500_harden_x_legacy_claim_search_path.sql`. As tabelas novas de configuração permanecem backend-only, sem grants diretos para `anon`/`authenticated`. Não foi feita publicação real de teste no X. Convites só devem ser liberados após o deploy da UI e a confirmação do Vercel READY.

## Comportamento

- `admin` preserva o papel existente do proprietário. `x_user` consulta a associação ativa no banco, entra no X Studio e recebe 403 nas APIs administrativas.
- Convites individuais de X Studio são criados pelo administrador na configuração do X. O link expira em 24 horas, é consumido uma vez e só atribui `x_user`; não envia email automaticamente.
- Contas pertencem a um workspace e a um usuário. Autorizações adicionais são explícitas. Reconexão OAuth não transfere propriedade.
- Nenhum token de plataforma é retornado no status. Configurações cruas continuam sem policy de leitura no navegador.
- Publicação exige `platform_account_id`. Um vídeo enviado para N contas gera N jobs independentes; chave de origem+conta evita enfileirar o mesmo upload novamente.
- Calendário reserva `(platform_account_id, scheduled_at)`. Claim serializa por conta; external post ID confirmado impede repetição. Respostas incertas do X ficam bloqueadas para inspeção: a API não fornece garantia absoluta de exactly-once quando a resposta se perde.
- Lotes aceitam várias mídias com legenda, comentário opcional e horário próprios. Cada post envia um único vídeo; não envia mais de quatro vídeos no mesmo payload.
- Reply publica após o post principal e registra status/erro/ID próprios. Falha de reply não desfaz publicação; envio incerto não recebe retry automático.
- Métricas ficam por conta/post, com atualização manual e tentativa automática a cada seis horas em contas habilitadas. Métricas privadas têm limitações de disponibilidade na API. A interface não inventa métricas ausentes.
- Sete contas é limite visual inicial de adição; não há CHECK de sete contas no banco. Worker visita até sete configurações por execução em rotação por heartbeat.
- Remover arquiva/desconecta a conta e apaga as credenciais locais da plataforma; preserva histórico e propriedade. Não revoga remotamente o consentimento OAuth no X.

## Validação executada

- Parse de JS/TS e scripts inline no trabalho original.
- `node scripts/test-x-studio-isolation.cjs`: 403 administrativo, IDOR, associação desativada, metadados sem tokens, cinco jobs com uma falha, replay, retry individual e reply incerto.
- `node scripts/test-x-studio-ui.cjs`: resposta atrasada da conta anterior descartada.
- Testes existentes de calendário multi-conta, seletor Face Swap e reconexão Instagram passaram no trabalho original.
- Migração e RLS passaram inicialmente em PostgreSQL PGlite isolado e foram repetidos no Supabase real em 16/10 dentro de transação com rollback.
- DOM real da SPA em jsdom: menu restrito, rota negada, seletor, multiple upload, campos por vídeo e comentário renderizados.
- `deno check` remoto não concluiu no trabalho original por falha de download JSR; não registrar typecheck completo como aprovado.
- Worker `cloudent-x-publish-worker` v6 observado em produção com HTTP 200 após a implantação, sem post de teste.

## Ordem de implantação

1. Conferir HEAD atual e eventual trabalho concorrente.
2. Aplicar/revalidar a migration e backup de policies. **Concluído em 16/10.**
3. Rodar `supabase/tests/x_studio_isolation.sql` em transação com rollback e advisors. **Concluído em 16/10.**
4. Implantar as Edge Functions necessárias com a configuração JWT original. **Concluído em 16/10.**
5. Validar sessões reais owner/x_user, IDs alheios, desconexão, troca rápida A/B, logout e ausência de segredos. Parte estrutural validada; não publicar conteúdo real sem destino explícito.
6. Implantar a interface e confirmar Vercel READY e versão do SW. Só então liberar convites.

## Recuperação

O SQL guarda definições anteriores de funções e policies em `cloudent_private.x_rollout_backup`, sem copiar senhas/tokens. A mudança é incremental; não exclui mídia, schedules ou tabelas existentes.

`supabase/rollback/x_studio_workspace_pause.sql` pausa publicação X e desativa `x_user`, preservando dados. Manter os novos gates de autorização durante recuperação. Não restaurar worker legado com fallback contra jobs multi-conta.

## Limites que ainda exigem validação real

OAuth, refresh e publicação/reply com contas reais; UI mobile visual; ponta a ponta até a API X. O endpoint health distingue `not_probed` de disponibilidade confirmada; não implementa um monitor ativo de disponibilidade de Vercel/Storage. A importação Drive legada permanece bloqueada até ter mapeamento explícito de conta; uploads locais/lotes são o caminho deste patch.

Referências oficiais verificadas:
- https://docs.x.com/x-api/posts/manage-tweets/integrate
- https://docs.x.com/x-api/posts/manage-tweets/introduction
- https://docs.x.com/x-api/fundamentals/metrics
- https://supabase.com/docs/guides/database/postgres/row-level-security
