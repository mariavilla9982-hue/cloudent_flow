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
