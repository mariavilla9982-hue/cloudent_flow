# CloudentFlow — regras obrigatórias para agentes

Este repositório não deve ser tratado isoladamente. O repositório `mariavilla9982-hue/cloudentflow-brain` é a fonte oficial de contexto do projeto.

## Antes de qualquer alteração

1. Conferir o HEAD atual deste repositório e trabalhar sobre a versão mais recente.
2. Ler no CloudentFlow Brain, no mínimo:
   - `00 - Estado atual.md`
   - `01 - Arquitetura.md`
   - `04 - Bugs.md`
   - `06 - Decisões.md`
3. Se o patch tocar backend, banco, workers, autenticação, storage, publicação, métricas ou scheduler, conferir também o estado real do Supabase antes de alterar.
4. Não reconstruir o projeto do zero.
5. Preservar funcionalidades existentes que não fazem parte do patch.

## Depois de qualquer alteração concluída

1. Validar o código/deploy afetado.
2. Atualizar o CloudentFlow Brain sem esperar uma solicitação do usuário:
   - sempre: `00 - Estado atual.md` e `07 - Changelog.md`;
   - quando aplicável: `04 - Bugs.md`;
   - quando houver decisão nova: `06 - Decisões.md`;
   - documentação específica em `Produção/` quando a mudança afetar esses fluxos.
3. Registrar SHA/versão real do que foi implantado.
4. Nunca salvar tokens, API keys, refresh tokens, service-role keys, senhas ou outros segredos no Brain.

## Regra de sincronização

O Brain possui auto-sync técnico do HEAD do GitHub. Isso não substitui a atualização semântica após patches: o agente continua responsável por documentar o que mudou, por quê e o estado funcional resultante.

## Proteção obrigatória do Supabase — 2026-10-18

- Antes de atender qualquer pedido, avaliar impacto em banco Postgres, Storage, egress, funções e cotas do Supabase. Medir uso e confirmar limites atuais do plano; não tratar tamanho do banco como prova de folga em egress/Storage.
- Se houver risco concreto de exceder limite, bloquear a ação de risco e informar uso, limite, impacto estimado e alternativa econômica. Só prosseguir após autorização específica para aquela ação; autorizações gerais anteriores não cobrem ultrapassar cotas, aumentar plano ou assumir cobranças.
- Se o consumo/limite necessário não puder ser verificado, não executar cargas grandes ou migrações de mídia para Supabase às cegas. Trabalhar em alternativa que caiba no limite e preservar serviço/dados existentes.
- Não apagar vídeos, calendário, métricas ou aprendizado para liberar espaço sem autorização específica. Priorizar mídia no Backblaze e evitar duplicações e leituras repetidas.
- Esta regra é política operacional persistente. Registro em app_settings não constitui, por si só, bloqueio automático universal; não afirmar cobertura técnica que não foi implementada/testada.
