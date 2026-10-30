# Calendário fixo por conta — 30/10/2026

A interface usa config.calendar_policy retornada pelo endpoint existente
platform-accounts. O banco já possui a política ativa de Sahry Japah com cinco
horários America/Sao_Paulo: 07:30, 10:00, 13:00, 16:00 e 18:30. O trigger
trg_account_calendar_policy usa o tamanho de times como capacidade. Nenhuma
DDL, horário salvo, Trial ou publicação foi alterado por este patch.

Antes, frontend ignorava a política e usava defaultTimes/modo5ou15 do navegador,
permitindo sugestões que o banco recusava. Agora capacidade, quinto horário,
validação do picker de Produção IA, upload rápido e modal manual usam a mesma
política. Modo15/Smart não sobrescrevem política travada. Vagas vencidas não
contam como livres. Contas sem política mantêm comportamento anterior. Backend
continua autoridade para concorrência. Contagem por conta exclui cancelados.

A exposição sanitizada de calendar_policy em cloudent-api/index.ts foi copiada
exatamente da fonte ACTIVE v24 já existente; não houve deploy de Edge Function.
Não substituir fontes live inteiras por versões antigas do Git.

Dashboard v4 mantém consulta oficial da Meta. Exibe período exato por conta,
fonte, cache5min, datas de coleta individuais e coleta mais antiga no agregado.
Total inclui outras publicações além de Reels/Stories. Snapshot de dia anterior
não reaparece como Hoje ao falhar atualização após meia-noite. Sem novo cron,
coleta POST, mídia, token ou endpoint de diagnóstico.

Verificação: scripts/test-calendar-policy.cjs em UTC e Asia/Tokyo (quinto18:30,
sexto recusado, defaults antigos, conta, cancelamento e vagas vencidas),
test-dashboard-overview.cjs (inclui virada de dia offline), production-schedule-
account.test.mjs, test-account-summary.mjs, test-panel-view.mjs, route-guard e
calendar-trial-ui. Dois testes antigos já falham na base: calendar-accounts
espera conta vazia após seleção removida, embora recuperação automática exista;
calendar-reconnect-compat não fornece window.addEventListener no mock. Não são
prova de funcionamento da sessão autenticada do celular.
