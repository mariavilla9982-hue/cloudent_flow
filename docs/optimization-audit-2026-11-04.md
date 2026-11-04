# Otimização das atualizações por página — 2026-11-04

Base inspecionada: `07cced3d139730a066c7e81df2736340d1982c2e`.

## Recursos existentes preservados

O Brain e o código já registram duas gerações GENJUTSU, preparação de prompts independente, leases/recuperação, retomada por artefatos, captura/verificação do node482 antes do cancelamento, cartões compactos, TAGs e progresso por eventos. Não foram reimplementados. Snapshot somente leitura: duas produções running e três motion_waiting; isso não comprova conclusão de vídeos.

## Gargalos corrigidos

- Atualização global buscava seguidores, calendário e histórico do dashboard em todas as páginas. Agora carrega dados correspondentes à tela; automação e notificações permanecem globais. Na Produção IA são duas chamadas de loaders em vez de seis; nas métricas quatro em vez de seis; no calendário três em vez de cinco. São contagens do ciclo global em fixtures, não porcentagem medida de economia total ou latência real.
- Atualização global reconstruía as páginas de produção/Face Swap a cada minuto. Agora seus controladores próprios preservam drafts, players e foco.
- Timer legado de produção e abertura da página consultavam a fila genérica mesmo em GENJUTSU. Agora o controlador GENJUTSU cuida de sua própria fila. Produção padrão/V7 conservam polling.
- Face Swap consultava com a aba do navegador oculta. Timer agora pausa e Face Swap/GENJUTSU atualizam ao retornar à aba. Workers continuam no servidor.
- Dois atualizadores podiam aplicar a mesma leitura do calendário. Agora compartilham a operação inteira por sessão/conta, liberando a reserva após sucesso/erro; resposta recebida após sair da página não reconstrói o calendário.
- Métricas e seguidores agora descartam respostas de outra sessão; troca de conta também invalida respostas pendentes.
- Entrar em métricas/calendário consulta dados atuais. Sincronização adiada com a Meta no boot só ocorre no dashboard, onde os dados são usados.
- GENJUTSU UI12, pipeline UI17, SW83 atualizam clientes PWA.

## Validação

PASS: focused-refresh, calendar-interaction, calendar-policy, calendar-trial-ui, genjutsu-ui, genjutsu-cache, pipeline-batch, pipeline-characters, pipeline-queue-ui, panel-view; parse dos JS alterados e SPA inline; git diff --check.

Inclui concorrência de atualização do calendário, troca de página/sessão, preservação das ações calendário/trial/lote/download/retry/exclusão e retorno da aba oculta. Fixture antiga de pipeline-queue-ui atualizada do mount11 para mount12 já utilizado em produção.

Playwright genjutsu-v7-layout não executou: binário Chromium ausente. Não afirmar QA visual/browser E2E autenticado ou nova geração paga.

## Impacto operacional

Somente frontend/testes/documentação. Sem alteração de schema, workers/crons, workflows/nodes, concorrência, tarefas remotas, publicações ou mídia. Supabase lido: plano Free, DB209860275bytes e Storage5871970bytes. Não houve carga grande; egress oficial não medido. Nenhuma promessa de acelerar processamento da GPU.
