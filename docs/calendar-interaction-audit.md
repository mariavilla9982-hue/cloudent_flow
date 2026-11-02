# Calendário e interação — 02/11/2026

Diagnóstico no Supabase iubzjfidmxfjvvonusos e app base main df07e87:

- Jujuh e Sahry Japah: cinco Reels normais publicados em 02/11, nos horários
  07:30, 10:00, 13:00, 16:00 e 18:30 (UTC-3). Sem jobs ausentes ou horários
  divergentes. Cada conta tinha um agendamento futuro às 07:30 de 03/11,
  com mídia ready, job pending e Pré-Trial às 07:10. Isso não significa
  que o restante de 03/11 esteja preenchido.
- Japah: Pré-Trial das 07:10 bloqueado por verificação exigida pelo Instagram;
  Pré-Trial das 18:10 recebeu erros transitórios Meta em quatro tentativas.
  Ambos foram encerrados quando os Reels normais correspondentes publicaram.
  Nenhum deles foi rearmado, duplicado ou apresentado como publicado.
- Motion V7: configuração ultra/84 GB/motion_default_84gb; cinco jobs mais
  recentes com execution_instance_type=ultra e status ready. Isso confirma
  o tier solicitado, sem identificar a GPU física do provedor.
- Dez crons ativos, execuções succeeded na última hora. Workers principais
  com heartbeat recente. Pendências: chave de envio Push ausente, token da
  conta antiga sahrylinns indisponível e falha histórica Jujuh de 19/10 por
  armazenamento antigo. Não apagar históricos para deixar monitor verde.

Correções exclusivamente no frontend:

1. A comparação de atualização usa somente a conta selecionada. Antes, IDs
   de todas as contas forçavam reconstrução e segunda consulta a cada ciclo.
   Mudanças reais reaproveitam a resposta recebida; status/métricas continuam
   atualizados. Edições em modal não sofrem substituição em segundo plano.
2. Troca de conta com dados carregados responde usando o snapshot existente;
   carregamento inicial compartilha a mesma leitura. Último clique prevalece,
   respostas de sessão anterior são descartadas e leituras têm timeout20s.
   Não há cache persistente novo nem alteração da validação no servidor.
3. Slots fixos seguem hora/fuso da política: um vídeo de 18:30 ocupa posição5,
   deixando 07:30 na posição1. Registros históricos fora da política ficam
   em posições extras, sem mudar horários no banco. Vagas vencidas são
   recusadas antes de abrir o seletor de arquivo.
4. Modal de calendário da Produção IA abre carregamento imediatamente e
   consulta contas/vagas em paralelo. Fechamento e logout não o reabrem;
   identidade do nó resiste à decoração de tela cheia no Android.
5. Menos reconstruções fora da página ativa/durante edição; formatadores de
   fuso reutilizados; toque com manipulation, foco visível e aria-busy.
   Service worker71 invalida a versão anterior.

Verificação: test-calendar-interaction.cjs em America/Recife e Asia/Tokyo;
test-calendar-policy.cjs; production-schedule-account.test.mjs incluindo
carregamento paralelo/fechamento/logout/decoração mobile; test-panel-view.mjs;
test-route-guard.cjs; test-calendar-trial-ui.cjs; test-production-media.cjs;
test-production-model-filters.cjs; test-motion-ultra-authorization.cjs;
test-motion-dispatch.cjs; test-motion-automatic-ui.cjs; parse SPA/SW e diffcheck.

Limitações: test-dashboard-overview.cjs falha também no HEAD base por exigir
SW67 quando a produção base já usava SW70. Teste visual sidebar indisponível
por ausência do executável Chromium. Nenhum teste autenticado Android ou nova
geração/publicação paga foi executado. Sem mudança em banco, Edge, cron,
plano, workflow, grafo, nodes, prompts ou mídia. Supabase Free, DB observado
180049587bytes/Storage5871970bytes; egress/Edge mensais globais não medidos.
Patch reduz consultas repetidas e não assume folga universal de cotas.
