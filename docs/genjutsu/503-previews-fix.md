# GENJUTSU — prévias e recuperação HTTP 503

Estado: correção local pronta, não publicada. O envio à origem mariavilla9982-hue/cloudent_flow foi bloqueado pela revisão automática por exigir confirmação explícita do destino. A publicação Edge também permanece pendente; não rearmar o trabalho antes do worker corrigido.

## Diagnóstico confirmado

O único job GENJUTSU consultado, 24661df9-bed6-4b7a-8bd4-bcd960687421, falhou com a mensagem exata “Gemini recusou a operação (HTTP 503).”. Checkpoint generating; sem runninghub_task_id, result_video_id ou dispatch intent. A interface não renderizava mídias na fila e bloqueava a retomada por tratar 503 como geração incerta.

## Correção

- Prévias de vídeo original e frame preparado pelos endpoints existentes, com autorização por dono; carregamento por visibilidade, cache de URLs por 15 minutos e vídeo sem pré-carregamento. Polling não recria o player quando a apresentação não mudou.
- Etapas compactas substituem o percentual arbitrário. Campos de upload menores no celular e controles de vídeo acessíveis.
- Resposta explícita 503 agenda retomada no worker com espera de 1/2/4/8/16 minutos, respeitando Retry-After até uma hora; depois de cinco retentativas a análise falha com mensagem clara e pode ser repetida manualmente. Mídias existentes reutilizadas. Não troca modelo/tier.
- Timeout de generateContent permanece incerto e bloqueia replay. O caso histórico com mensagem exata 503 pode ser retomado; tentativas ambíguas não são liberadas.
- Workflow e entradas 970/496/910, captura 482 e cancelamento após cópia verificada preservados.

## Validação e limites

Testes de adaptador Gemini (503, orçamento, mídia reutilizada e timeout), worker real em VM, interface em DOM simulado (fontes de preview, poster, preload e identidade durante refresh), manual frame, retry, pipeline, captura/cancelamento e labels. Chromium indisponível: download de instalação retornou arquivo inválido; não afirmar revisão visual em navegador. Nenhuma geração real ou nova task iniciada pelo agente. Banco consultado: 187004595 bytes; Storage 5871970 bytes; cotas mensais de egress/Edge não foram inferidas a partir disso. Sem mídia migrada para Supabase, DDL ou alterações de calendário.

## Publicação pendente

Após confirmação do usuário: publicar commit revisado na main pelo fluxo normal; implantar cloudent-motion-control-worker com genjutsu-stage/gemini e cloudent-api com image-pipeline-api/retry. Preservar verify_jwt e autenticação interna atuais. Conferir conteúdo remoto e hashes. Retomar somente o job acima se ainda tiver erro503, status failed, nenhuma task/resultado/intent e metadados inalterados; preservar os arquivos. Atualizar Estado atual/Changelog/Bugs/Decisões no Brain com SHAs e versões efetivamente publicadas. Não registrar conclusão de geração até comprová-la.
