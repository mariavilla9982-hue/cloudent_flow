# Dashboard — visão geral aprovada em 29/10/2026

Interface baseada na referência Kronos aprovada pelo dono: resumo do Instagram,
visualizações em destaque, Reels/Stories/seguidores abaixo e resumo de Jujuh e
Sahry Japah. Sem gráficos, ranking ou fila na página inicial. A navegação e os
demais recursos permanecem existentes. Sahry Grávida não participa desta visão;
nenhuma conta, personagem ou informação histórica é apagada ou desconectada.

## Fontes e significado

- `instagram-metrics-today` GET fornece o último snapshot por Reel da conta.
  O filtro Hoje/7/30/90 dias usa a **data de publicação** em America/Sao_Paulo.
  As visualizações são acumuladas desses Reels, não incrementos diários das views.
- `instagram-followers-status` GET fornece o total atual de seguidores da conta,
  independente do período. A data da coleta aparece em cada resumo.
- Stories não tem coleta na integração atual: mostra `— / Sem coleta disponível`.
  O destaque explica que cobre Reels, sem somar zeros inventados de Stories.
- Conta é vinculada ao ID real, não a nome de arquivo ou seleção global. A lista
  autorizada/ativa recebida do servidor continua sendo obrigatória. Apenas os
  IDs existentes de Jujuh e Sahry Japah entram no resumo e nas consultas.
- Ausência/falha de dado mostra `—`. Zero só aparece após consulta válida sem
  visualizações. Total combinado fica indisponível se uma conta não tem dado.
  Em falha de atualização preserva o último snapshot da mesma sessão/conta/período
  e exibe aviso; não atribui data de coleta nova a dado antigo.

## Implementação e custo

Reutiliza `dashboard-multi-account-patch.js` v2. Cache por sessão, conta e período,
TTL 60s, requisições simultâneas coalescidas, respostas antigas descartadas após
logout/troca de sessão/desativação da conta. A cadência de atualização da SPA é
reutilizada. A dashboard somente lê snapshots: nenhuma chamada POST para coleta,
novo cron, job, upload, mídia, migração ou alteração de backend.

Por leitura fria são dois GETs de métricas e dois GETs de seguidores. O seletor
de período reutiliza seguidores; atualização manual relê a lista de contas e os
snapshots. O endpoint existente limita o período e continua autorizando admin.
Estilos limitados à overview, com layout móvel e foco de teclado. O cabeçalho
global é simplificado somente enquanto a overview está visível.

Loader nativo no HTML, bootstrap v2 e SW v65 mantém uma única versão também em
documentos PWA antigos; o módulo é idempotente e servido network/no-store pelo SW.

## Validação

`node scripts/test-dashboard-overview.cjs` cobre soma por conta, deduplicação de
Reels, isolamento de conta, timezone/limite de período, GET-only/cache, Stories
ausente, falha com snapshot preservado, troca de usuário, logout/resposta tardia,
perfil X restrito, estado vazio e injeção PWA sem tags duplicadas.

Também passam `node scripts/test-panel-view.mjs`,
`node scripts/test-route-guard.cjs` e `git diff --check`.

Não houve nova coleta Meta, publicação, geração paga ou alteração de dados de
produção para testar. Teste visual autenticado não realizado: navegador local
Chromium ausente e download oficial retornou arquivo inválido. Não confundir
validação funcional em VM com inspeção visual da sessão do usuário.
