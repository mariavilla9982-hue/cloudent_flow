# Dashboard — resumo oficial Instagram (29/10/2026)

Mantém o layout aprovado e somente Jujuh/Sahry Japah. Overview usa GET
instagram-metrics-today?summary=1&days=1|7|30|90&account_id=ID, autorizado pelo
mesmo getUser/app_members admin/metricAccount existente. Nenhuma autenticação
ou endpoint interno de diagnóstico novo.

O resumo vem da Meta /IG_USER_ID/insights: views, period=day,
metric_type=total_value, breakdown=media_product_type, since/until.
Total inclui todas as superfícies; Reels e Stories são breakdowns oficiais.
Diferente da versão anterior, mede visualizações recebidas NO período,
incluindo vídeos antigos. Seguidores continuam total atual por conta.

Reaproveita o token privado existente server-side. Conta e período em allowlist:
no máximo oito snapshots pequenos em app_settings, TTL de cinco minutos,
sem tokens/payloads brutos, mídia, novo cron ou migração. Períodos de 90 dias
são divididos em três janelas disjuntas de até30dias. Sem nova consulta Meta
antes do TTL, inclusive após falha; cache em voo coalescido por instância.
A cadência de frontend existente e cache60s permanecem. Falha preserva snapshot
da mesma conta/período/dia com data original, ou mostra indisponível.
Zero só vem de resposta válida. Virada de dia não reutiliza intervalo antigo.

GETs tradicionais de métricas e POSTs de coleta mantêm comportamento anterior;
a rota summary aceita apenas GET e retorna JSON pequeno sem varrer mídia.

Verificação real via consulta autorizada à Meta: HTTP200 nas duas contas para
Hoje e30dias, com valores REEL/STORY/POST/CAROUSEL_CONTAINER. Testes usam formato
real e verificam parser, janelas90dias/cache/falha/escopo, UI, sessão/logout,
período e carregamento PWAv66/dashboardv3. Sem geração/publicação de QA.
Sem inspeção visual da sessão autenticada do celular.

## 30/10/2026 — clareza e virada de dia

Dashboard v4/SWv67 mostra intervalo exato, origem Meta, cache de5min e data mais
antiga das contas no agregado. Dado de intervalo anterior é descartado ao virar
o dia, inclusive durante falha de rede; nunca reapresentado como Hoje. Não muda
valores Meta, seguidores, layout aprovado ou frequência de coleta.
