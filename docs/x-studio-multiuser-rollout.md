# X Studio: acesso restrito e publicação por conta

Atualizado em 17/10/2026. Código funcional: `3b12367d89c772acbbb1de26bab47ad3d75a0dbd` (complementa `7d64b94`). Produção Vercel READY: `dpl_3exV47F8w2GV34VaaMuZw5Maosi6`, https://cloudent-flow.vercel.app. Supabase existente: `iubzjfidmxfjvvonusos`.

## Operação pelo administrador

1. Abrir **X Studio → Configurações → Usuários do X Studio**.
2. Clicar **Atualizar usuários e permissões** para carregar usuários, convites e todas as contas X.
3. Informar o email e marcar as contas autorizadas. **Convidar para o X Studio** oferece envio pelo Supabase Auth e link individual alternativo, válido por 24 horas. O convidado define a própria senha; nenhuma senha é definida pelo administrador ou persistida no repositório.
4. Para usuários existentes: marcar/desmarcar contas e **Salvar contas autorizadas**. **Desativar** bloqueia imediatamente; **Remover acesso** desativa e remove todas as concessões. O admin continua com acesso total e não pode ser alterado por essas operações.
5. O convidado entra pelo login normal e é levado somente ao X Studio. Contas permitidas aparecem no seletor. **Todas as contas** fornece visão agregada; publicações exigem conta explícita.

## Estrutura reutilizada

Não foi criado outro sistema de posts/usuários: `app_members.role=x_user`, `member_invites`, `x_account_access`, `platform_accounts`, `x_account_configs` e `x_drive_posts` continuam sendo as fontes oficiais. Criada somente `x_invite_account_access` para preservar contas escolhidas antes de aceitar o convite. Acrescentados `member_invites.auth_user_id`, NOT NULL na conta/workspace dos posts e colunas compatíveis geradas `video_storage_path`, `caption`, `external_post_id`.

Migrations incrementais:
- `20261017155734_x_studio_access_completion.sql`
- `20261017160409_x_studio_cloud_worker.sql`
- `20261017160726_x_invite_auth_permissions.sql`

Funções implantadas: `cloudent-api` v5, `cloudent-member-signup` v1, `cloudent-x-publish-worker` v3, `cloudent-x-oauth` v2. O módulo novo `cloudent-api/x-members.ts` concentra apenas a administração dos usuários X. Convites usam Supabase Auth oficial; SMTP/redirect permitido são pré-requisitos do envio por email. O link individual continua disponível se o envio não for aceito.

Backend verifica Auth nativo, sessão ainda ativa, associação habilitada e concessão da conta. `x_user` não recebe acesso por ownership implícito: revogar a concessão realmente remove o acesso. APIs gerais permanecem admin-only. Tabelas com credenciais não têm policy de leitura para o navegador. Status retorna somente campos seguros da conta. OAuth e remoção/conexão de contas são administrativos. RPCs de convite são service-only; consultas protegidas a Auth executam com privilégios do proprietário e validação explícita do admin.

## Posts e worker

Cada vídeo do lote tem legenda, comentário, data e contas próprios, sem limite de quatro arquivos na seleção. Cada destino gera um job independente; reenvio do mesmo upload/conta não cria outro job. Uploads preferem Backblaze existente, com URL assinada emitida pelo backend; mantém compatibilidade com a origem Supabase existente. Thumbnails JPEG opcionais são geradas no upload e armazenadas na mesma origem, nunca dependem do PC para publicar.

Calendário X separado, edição/reagendamento/arrastar, remoção lógica e duplicação para a fila. ID, erro e status de reply ficam separados do post principal. Falha de reply não desfaz o post.

Cron `cloudent-x-studio-publisher` executa a cada minuto e autentica com segredo do Vault, exclusivamente no worker X. Heartbeat `x_drive_publisher` observado avançando de 16:06 até 16:14 UTC, com `last_success_at` e sem erro. Worker processa até sete contas por rodada, com claim atômico por conta e isolamento de falhas. Não depende do navegador.

Antes do POST no X, persiste início e media ID. Resposta incerta fica bloqueada, sem nova publicação automática. Reconciliação consulta a timeline da conta exata e procura o media ID, não uma legenda possivelmente repetida. Ausência de correspondência ou falta de permissão de leitura mantém o bloqueio para conferência, pois o X não oferece garantia geral de exactly-once após perda da resposta. Reply incerto também não repete automaticamente.

## Validação executada

- Banco real, transação com rollback: RLS, conta obrigatória, concessão/revogação mesmo para proprietário, admin total, usuário desativado, convite único, claim concorrente e proteção contra replay.
- Auth/API reais, usuário temporário removido depois: criação pelo convite; login, sessão, logout e sessão revogada; health 200; admin QA com acesso às APIs e convites; x_user 403 em APIs administrativas, OAuth administrativo e conta alheia; desativação bloqueia sessão já aberta.
- Backblaze e API reais: cinco uploads, cinco captions, replies distintos armazenados; repetir upload-complete cria zero jobs extras; mesmo vídeo em duas contas autorizadas; duplicação; sete jobs e duas contas QA removidos após teste. Os cinco objetos de vídeo QA pequenos permanecem como objetos privados sem jobs; nenhuma mídia real foi apagada.
- `node scripts/test-x-studio-isolation.cjs`: isolamento, falha entre contas, replay/reinício, reply com parent correto, erro independente e reconciliação de timeout com API X simulada.
- `node scripts/test-x-studio-ui.cjs`: sintaxe e troca de contas com resposta antiga descartada. DOM jsdom adicional: menus admin/x_user, redirect para X, hashes calendar/settings bloqueados, campos por vídeo e administração dos convites.
- `node scripts/test-auth-recovery.cjs`: contrato de login/sessão/logout/revogação e ausência de chamadas ao projeto aposentado.
- Logs Vercel dos deployments de produção consultados: nenhum error/fatal encontrado no período do teste.
- Deno typecheck remoto e browser Chromium não concluíram por download indisponível; bundling das Edge Functions e análise dos scripts passaram. Não houve QA visual mobile completo.

## Bloqueio externo ainda existente

O app X no banco atual está `needs_reconfiguration`, sem Client ID/Secret configurados; a conta X existente precisa reconectar. Por isso **não foi validada publicação nem reply real no X**, nem OAuth/refresh reais. As filas, acesso e cloud worker estão implantados; testes de publicação usaram API simulada. Para liberar publicação real, o admin deve configurar o app em **Configurações → integração X** e reconectar no X Studio. Não obter nem copiar credenciais antigas para o frontend.

Cada vídeo vira um post separado. Limites de mídia, leitura da timeline/métricas, escopos e orçamento dependem do acesso/conta da API X. Nenhum número de métricas ausente é inventado. Sem acesso à timeline, envios incertos permanecem bloqueados para prevenir duplicação.

Preservados o admin original, 215 vídeos, 190 schedules e as contas Instagram. Nenhuma mudança nos workflows Instagram, RunningHub, Motion Control, Face Swap ou Produção IA. Crons existentes mantidos.

Fontes oficiais: https://docs.x.com/x-api/posts/create-post e https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail.
