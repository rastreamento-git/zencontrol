# Backlog de implementação para Codex — Zen Workspace 2.0

**Todas as tarefas abaixo são propostas, NÃO foram implementadas por esta documentação.**
**Destino de PRs:** feat/ecossistema-homologacao. **Versão de maturidade:** Alpha 0.1.

## Princípios de entrega
Cada item deve ter PR revisável, capturas com dados fictícios, casos de regressão, impacto de acessibilidade, e não deve mudar backend/regra financeira sem justificativa e aprovação. Rever o estado do GitHub antes de iniciar. Se PR anterior não tiver merge, partir do commit correspondente/registrar dependência para evitar conflito.

## Etapa 0 — Baseline e inventário (P0, sem redesign ainda)
- [ ] Mapear todas as ações, campos, condicionais, papéis, mensagens e estados do OrderEditor; registrar quais são obrigatórios por serviço.
- [ ] Mapear TechnicianForm, FormModal, lista de OS, Agenda, Financeiro e cadastro de Consultores/Regionais.
- [ ] Conferir classes CSS, responsividade, tema escuro, estrutura de fontes e precedência dos estilos.
- [ ] Coletar screenshots sintéticos: OS nova, OS em edição, cadastro técnico novo/legado, financeiro, menu, 390px e 1280px, claro/escuro.
- [ ] Rodar baseline de builds/testes e registrar qualquer falha preexistente.

**Aceite:** inventário auditável e sem mudanças nas regras ou banco.

## Etapa 1 — Fundamentos UX e formulários reutilizáveis (P0)
- [ ] Definir tokens semânticos atuais e mapear espaçamento, campos, ações, labels e alertas.
- [ ] Introduzir FormSection/FieldGroup e feedback de erro por campo de modo opcional; não quebrar uso atual de Field/FormModal.
- [ ] Melhorar modal longo: cabeçalho, rodapé, scroll, foco e comportamento responsivo.
- [ ] Documentar novas primitivas com exemplos no código.
**Aceite:** formulário antigo continua funcional, sem perda de dados, sem regressão de outros modais.

## Etapa 2 — Ordem de serviço (P0)
- [ ] Reordenar OS nova conforme fluxo identificação → atendimento → equipamentos → agendamento → revisão; considerar implementação progressiva da primeira etapa antes de wizard completo.
- [ ] Separar ações de consulta/identificação de PDF, concluir, reabrir, arquivar e valores extras.
- [ ] Para OS existente, apresentar resumo e tabs/seções coerentes sem apagar campos nem iniciar novos contratos.
- [ ] Preservar condições específicas de reinstalação, extras, FIPE, atendimento sem rastreador, SGA e estados controlados.
**Aceite:** criação/edição, PDF, conferência, envio, ações condicionais e histórico seguem acessíveis; nenhuma alteração nas versões/transações.

## Etapa 3 — Técnicos e equipe (P0/P1)
- [ ] Agrupar cadastro técnico por identificação, base de deslocamento, abrangência, estoque, financeiro e ZenField.
- [ ] Mostrar modo de endereço legado explicitamente e não convertê-lo automaticamente.
- [ ] Deixar claro quais dados de raio e municípios são informativos.
- [ ] Unificar acessos visuais com “Equipe e acessos” sem duplicar contas/cadastros.
**Aceite:** cadastro, edição, vinculação de estoque, ativação e recuperação preservados.

## Etapa 4 — Financeiro (P1)
- [ ] Fortalecer central com filtros clicáveis e fila por tarefa/vencimento.
- [ ] Diferenciar “conferir”, “aprovar”, “a pagar” e “registrar pagamento externo”.
- [ ] Manter histórico, políticas, vigências, despesas, comprovantes, pagamentos parciais e auditoria.
**Aceite:** todas as ações do fluxo atual continuam possíveis e a central reduz o número de cliques para tarefas frequentes.

## Etapa 5 — Navegação, tabelas e cadastros (P1)
- [ ] Reorganizar menu por finalidade, sem criar recursos inexistentes.
- [ ] Consultores e Regionais: melhorar pesquisa/filtros, progresso e erros de sincronização, mantendo contratos /api/volunteers e /api/regionals.
- [ ] Padronizar tabela/cards, filtros, paginação, estado vazio, carregamento e erro em OS/Agenda/Importação.
- [ ] Adequar ações a papéis e não expor funcionalidades administrativas a perfil técnico.
**Aceite:** todos os caminhos antigos ainda localizáveis e autorizados.

## Etapa 6 — Consistência entre aplicativos (P1, PRs separados)
- [ ] Auditar diferenças de tokens/componentes nos repositórios zenfield e inventario-v2.
- [ ] Replicar base compartilhada com PR próprio e build independente em cada repositório.
- [ ] Manter ZenField mobile-first; preservar upload/fotos/scanner/checagem.
- [ ] Manter Estoque Pro com scanner de entrada, transferência assistida, carga e rastreabilidade.
**Aceite:** UX consistente sem padronizar fluxos de trabalho diferentes à força.

## Regressões mínimas por PR
- [ ] npm run check
- [ ] npm test
- [ ] npm run build
- [ ] npm run homologation:build, se houver impacto no conjunto
- [ ] npm run test:frontend, quando ambiente de homologação local e Chromium estiverem prontos
- [ ] Testar 360/390/768/1280/1440px, claro/escuro, teclado e carregamento/erro.
- [ ] Registrar testes não executados e por quê; nunca afirmar teste aprovado sem execução.
- [ ] Não gerar migrations nem alterar Vercel/Render/prod em PR apenas visual.

## Gate de saída da Alpha 0.1
UX consistente e testes técnicos aprovados, pendências P0 tratadas, roteiro de Live Test pronto, evidências e responsáveis registrados. Isso habilita propor a Alpha 0.2 — não significa automaticamente Release 1.0.

## Primeiro comando sugerido no Codex
Leia AGENTS.md e os três documentos docs/CODEX-HANDOFF-UX-ALPHA-01.md, docs/UX-DESIGN-SYSTEM-ZEN-WORKSPACE.md e docs/UX-IMPLEMENTATION-BACKLOG.md. Trabalhe apenas a Etapa 0 e prepare o PR da Etapa 1 depois de mapear as regras existentes. Respeite a branch feat/ecossistema-homologacao, preserve todos os contratos e papéis, não faça deploy/merge, capture antes/depois com dados fictícios e reporte testes.
