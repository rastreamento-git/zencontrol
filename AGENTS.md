# Instruções do Codex — Ecossistema ZenTracking

Antes de editar qualquer interface, leia:
1. docs/CODEX-HANDOFF-UX-ALPHA-01.md — contexto, limites, fluxo e critérios de aceite.
2. docs/UX-DESIGN-SYSTEM-ZEN-WORKSPACE.md — padrões visuais e acessibilidade.
3. docs/UX-IMPLEMENTATION-BACKLOG.md — ordem das entregas, tarefas e testes.
4. docs/REGRAS_DE_NEGOCIO.md, docs/EXPERIENCIA-ZENTRACKING.md e docs/REPOSITORIOS.md — contratos existentes.

## Contexto de produto
O produto está na **Fase 1 / Alpha 0.1**. “Zen Workspace 2.0” é o nome da proposta de UX; NÃO é a versão de release da plataforma. Protótipo → Alpha 0.1 (atual) → Alpha 0.2 (Live Test interno) → Beta 0.10 → Release 1.0. Não antecipar uma fase por ter concluído somente a interface.

## Restrições mandatórias
- A branch de integração é feat/ecossistema-homologacao. Não presumir que main contém a versão integrada.
- Abrir PR pequeno por módulo ou camada; não alterar produção, Vercel, Render, banco ou migrations sem solicitação específica. Não realizar merge automaticamente.
- Priorizar UX, ordem visual e legibilidade. Preservar APIs, nomes de payloads e IDs existentes; nomes visíveis ao usuário usam **Consultores**, mas o SGA ainda utiliza voluntario.
- Não alterar regras de OS, permissões, estados, confirmações, estoque/IMEI, FIPE, financeiro, auditoria ou autenticação em tarefas apenas visuais.
- Usar dados fictícios em demonstrações e testes; nunca copiar credenciais, bancos reais, logs sensíveis ou registros de associados.
- Não criar telas vazias nem ações decorativas; manter todos os caminhos existentes acessíveis, inclusive ações pouco frequentes em áreas secundárias.
- UI deve funcionar em desktop, tablet e celular, teclado, foco, tema claro/escuro e baixo movimento.
- O modo online-demo é efêmero e não comprova persistência nem acesso a serviços externos.
- Não implementar endpoints para apps futuros: apenas mapear requisitos, dependências e contratos candidatos; aguardar uma fase específica de arquitetura.

## Procedimento
1. Conferir estado atual da branch e existência de PRs pendentes; verificar os componentes antes de propor substituições.
2. Levantar fluxos/roles e registrar critérios de aceite da fatia.
3. Implementar sem dependências visuais desnecessárias e com componentes reutilizáveis.
4. Executar os checks compatíveis; reportar comandos, resultados reais, screenshots e limitações.
5. Entregar PR com antes/depois, riscos, checklist de regressão e orientações para homologação.

Comandos orientativos no zencontrol: npm ci --include=dev; npm run check; npm test; npm run build; npm run homologation:build; npm run test:frontend (este último requer dependências e navegador de teste; ver docs/REPOSITORIOS.md).
