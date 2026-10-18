# Reels Teste por publicação e acesso X Studio

O agendamento principal continua sendo a única vaga normal. `schedules.trial_video_id` é opcional: null mantém o mesmo vídeo; preenchido escolhe um resultado pronto da Produção IA. O trigger existente sincroniza somente o registro `reel_test_publications` vinculado, com status, container, tentativas e publicação independentes. Configuração de antecedência existente foi preservada (20 minutos por padrão; modo de lote mantém sua configuração).

A associação exige administrador ativo, conta Instagram explícita no mesmo workspace, vídeo pronto do próprio usuário e compatibilidade de conta. A associação não muda `video_id`, `scheduled_at` ou `platform_account_id` do post principal. Um teste que já iniciou não pode trocar de mídia. A exclusão de resultado associado preserva o arquivo; a exclusão do vídeo principal usado por outro teste é bloqueada antes de remover o arquivo.

O scheduler usa `claim_due_trial_reels`, com reserva atômica compartilhada. O publicador principal usa `claim_calendar_publish_schedule`, com a mesma reserva da `job_queue`. Antes de publicar, cada um persiste sua identificação e marca de envio. Resposta de publicação incerta exige confirmação e não dispara envio cego em retry. Falha do teste não interrompe o processamento dos principais.

No calendário, “Reels Teste” abre a seleção de mesmo vídeo ou vídeo separado. Em Produção IA, resultados prontos têm “Adicionar como Reels Teste”, com conta, data e publicação principal. Não se cria outro agendamento.

O papel existente `x_user` continua isolado no banco e nas funções. Login/session verificam Auth nativo, sessão ativa e membro habilitado. O proxy emite cookie HttpOnly/Secure/SameSite=Lax para verificar rotas de página no servidor. APIs continuam exigindo Bearer e rejeitando áreas não-X para `x_user`. Rotas restritas redirecionam esse usuário para `/x-studio`; a SPA também valida permissões. Admin mantém acesso completo. Links de convite usam a origem real de produção.

## Validação

- `scripts/test-calendar-trial.cjs`: concorrência, replay após resposta incerta, falha independente e roteamento exato de conta, com Meta simulada.
- `scripts/test-calendar-trial-ui.cjs`: modos padrão/separado e associação via Produção IA.
- `scripts/test-route-guard.cjs`: páginas para admin, X-only, sessão revogada e redirects canônicos.
- Testes existentes `test-x-studio-isolation.cjs`, `test-x-studio-ui.cjs`, `test-auth-recovery.cjs`.
- `supabase/tests/separate_calendar_trial.sql`: transação real com rollback; seleção, antecedência, preservação do slot, conta incorreta, papel X, bloqueio de troca em execução e reserva única do principal. Nenhuma chamada externa de publicação.

Não houve publicação real para teste nem alteração de workflow RunningHub. Em 17/10/2026 BRT, após o usuário concluir o login no painel, a configuração global do Supabase foi corrigida: Site URL `https://cloudent-flow.vercel.app`; allowlist exata com `/`, `/x-studio`, `/primeiro-acesso.html` e `/recuperar-acesso.html`. O painel confirmou a gravação das quatro URLs e não possui localhost nessa configuração. Login real do administrador e leitura do calendário passaram; modal de teste de um post existente mostrou principal 07:30, teste 07:10 e opções de vídeo separado carregadas, sem salvar alterações. O login fornecido no teste foi admin: teste visual autenticado como colega x_user ainda não foi executado; isolamento dessa role foi validado pelos testes de backend/SQL/rotas, sem alterar suas credenciais.
