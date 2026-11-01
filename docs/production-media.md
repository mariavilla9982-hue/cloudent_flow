# Produção IA: prévia e download

Prévia usa `production-preview&kind=result`: o player recebe URL temporária do armazenamento privado e pode usar Range/metadata sem esperar um Blob completo pela Edge Function. Download usa `production-download&mode=link`, com nome e Content-Disposition assinados pelo backend. O navegador transfere o vídeo; há link explícito caso bloqueie o disparo automático. Nenhuma URL assinada é persistida em logs ou armazenamento local.

Preparação tem timeout de 20s, refresh de sessão limitado a uma tentativa, proteção contra mudança de usuário e cliques repetidos de download. Fechar a prévia aborta a consulta pendente e impede reabertura tardia. Erro do player permite tentar novamente/baixar. O alias antigo getProductionResultBlobUrl mantém compatibilidade com controladores em cache, retornando URL de streaming. SW69 atualiza production-studio v4.

O endpoint link já estava implantado em cloudent-api v26 ao iniciar a correção. O fonte do Git foi sincronizado com essa versão real, incluindo dependências de desconexão/health já existentes no servidor; nenhuma nova implantação Edge foi feita. Nenhum job, workflow, calendário, mídia ou plano foi alterado.

Validação: scripts/test-production-media.cjs cobre rotas reais com mocks, streaming sem Blob, link de download, fallback visível, timeout/401 limitado, fechamento da janela, mudança de sessão e cliques repetidos. Regressões de filtros, Motion automático e painéis. Não equivale a download real no Android autenticado; ausência/indisponibilidade externa da mídia continua sendo falha de armazenamento.
