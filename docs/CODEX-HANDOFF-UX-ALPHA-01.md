# Handoff Codex — Zen Workspace 2.0 / Alpha 0.1

**Status:** especificação de UX revisável; não representa código implementado nem aprovação de release.
**Data de referência:** 23/11/2026.
**Repositório-foco:** rastreamento-git/zencontrol, branch feat/ecossistema-homologacao.
**Base inspecionada no preparo:** 988b26a682965a297c033fc241bbef298aeb162d (verificar HEAD novamente ao iniciar).
**Repositórios vinculados:** rastreamento-git/zenfield e rastreamento-git/inventario-v2, ambos em feat/ecossistema-homologacao.

## 1. Objetivo de negócio
Transformar o UX funcional do protótipo em um **workspace executivo, claro e rápido** para operadores da Zen Seguros sem reescrever o produto. Reduzir busca visual, ambiguidade dos botões, rolagem e campos fora da ordem operacional. Melhorar a orientação de pessoas com pouca familiaridade técnica sem esconder ações necessárias.

A fase atual é **Fase 1 / Alpha 0.1: refinamento visual, correção de falhas e organização de fluxos**. A sequência aprovada pelo produto é:
- Protótipo: estruturar, rascunhar, elaborar.
- Alpha 0.1 (atual): visuais, usabilidade e correções.
- Alpha 0.2: Live Test com a equipe do rastreamento.
- Beta 0.10: corrigir feedback do Live Test, segurança, preparar deploy.
- Release 1.0: lançamento e adoção pela equipe.

Não tratar “Zen Workspace 2.0” como release 2.0 nem iniciar desenvolvimento das fases 2–4 do ecossistema. Na fase posterior haverá trabalho próprio de desenho dos endpoints para aplicativos futuros; **nenhum contrato novo está aprovado aqui**.

## 2. Evidências da inspeção do código (não de testes com usuários)
- apps/web/src/components/Records.jsx, componente OrderEditor: um modal largo com dados de OS, ações no topo, fieldsets “01 · Veículo e associado” e “02 · Atendimento e responsável”, e abaixo retorno técnico, responsáveis, integrações, adicionais e histórico. As ações (PDF, encaminhar, concluir, reabrir, adicionar valor) competem com a tarefa de edição.
- apps/web/src/components/TeamForms.jsx, TechnicianForm: FormModal genérico renderiza identificação, telefone, habilidades, base operacional detalhada, vínculo com Estoque Pro, valores iniciais e situação ativa em sequência.
- packages/ui/src/components/service-common.jsx: Field e FormModal são utilitários genéricos com grade de duas colunas e tratamento global de erro, sem agrupamento semântico de seções. A troca do componente deve preservar assinaturas usadas por outros cadastros.
- packages/ui/src/components/Modal.jsx + packages/ui/src/styles/base.css, experience.css e zencontrol.css: modais já usam cabeçalho/rodapé e rolagem; aperfeiçoar sem quebrar foco, escape, conteúdo longo e celular.
- apps/web/src/components/TechnicianFinance.jsx: já há central, fila, filtros, fechamentos, pagamentos, histórico e configurações. Refinar o fluxo **sem apagar** recursos existentes, especialmente políticas, comprovantes, valores por vigência e aprovações.
- apps/web/src/App.jsx: menu atual está dividido em “Visão geral”, “Operação” e “Gestão”; o último reúne cadastros, financeiro, importações e acessos. A navegação precisa refletir a tarefa, não apenas a estrutura interna do código.
- apps/web/src/components/Regionals.jsx e bloco Volunteers de Records.jsx: interfaces de **Regionais** e **Consultores** já existem. O contrato interno permanece /api/volunteers e campos volunteer por compatibilidade com SGA.
- docs/EXPERIENCIA-ZENTRACKING.md descreve componentes/estilos compartilhados e cópias nos três repositórios; usar este documento como referência antes de editar CSS compartilhado.
- docs/HOMOLOGACAO-FASE1-2026-11-12.md ressalva que homologação temporária usa dados sintéticos e não comprova durabilidade.
**Limite:** diagnóstico baseado em repositório, não substitui inspeção visual autenticada nem pesquisa com a equipe.

## 3. Princípios de experiência
1. Uma tela = uma tarefa principal; uma ação primária por contexto.
2. Informação essencial antes de cadastro técnico/legado; detalhes progressivos sem desaparecer.
3. Rótulos em português de operação: Consultor, Regional, Associado, OS, Técnico, TAG, Rastreador. Evitar jargão de implementação.
4. Mostrar próxima ação e por que um botão está indisponível; não só cinza.
5. Erro no campo e resumo de erro; dados digitados jamais devem ser descartados após erro.
6. Listas devem permitir pesquisa, filtros, ordenação útil, estado vazio e estado de carregamento compreensível.
7. Elementos visuais consistentes entre claro/escuro e desktop/mobile.
8. Não misturar FIPE regional (regra de classificação) com “Regionais” administrativas do SGA: domínios distintos.

## 4. Arquitetura de informação sugerida
- **Visão geral:** painel de controle, prioridades da operação (reutilizar fluxos existentes).
- **Operação:** ordens de serviço, agenda, pendências SGA, validações, bloqueios, conversas.
- **Cadastros:** consultores, regionais, técnicos. Técnicos são cadastros atualmente acessados por Equipe e acessos; avaliar link/atalho que reutilize a tela existente, sem criar outro CRUD paralelo.
- **Financeiro:** central financeira, histórico/consultas financeiras conforme permissões existentes.
- **Administração:** equipe e acessos, importações, configurações.
Mapear todos os itens e roles antes de mover. **Não adicionar uma “Central de tarefas” funcional** sem levantamento de domínio e aprovação; prioridade pode ser um agrupamento do painel existente.

## 5. Modelo de telas: ordem de serviço
### Nova OS (proposta de fluxo guiado)
1. Identificação: placa/chassi/código SGA, consulta, associado e contato; mostrar retorno confiável e permitir tratamento atual de falha.
2. Atendimento: instalação, manutenção, retirada, reinstalação ou outra modalidade já aceita; status e particularidades existentes.
3. Equipamentos: quantidades de rastreadores/TAGs, adicionais, dispensas e regras já implementadas.
4. Agendamento: data/hora, turno, técnico, endereço, autorização de deslocamento e observações.
5. Revisão e confirmação: resumo de serviço, associado, veículo, técnico, materiais, pendências; ação de criar.
A navegação por etapas é **apenas apresentação**: preservar estado entre etapas e validações da API. Não introduzir “salvar rascunho” se a API não tiver contrato. Campos condicionais aparecem na etapa coerente; retornar de uma etapa não pode apagar documentos, observações, horários ou resultados da consulta.

### OS existente (proposta de página de trabalho)
Cabeçalho com identificação, serviço, status, responsável, data e próxima ação; abas/seções: Resumo, Cadastro, Evidências, Financeiro, Histórico. Detalhes operacionais, PDF integral, auditoria, integração SGA e ações perigosas ficam em menu/área apropriada, sem removê-los. Evitar múltiplos modais aninhados, não perder estado ao alternar abas. Preservar bloqueios de edição conforme estado da OS e perfis.

**Não mudar:** números de OS, conversão de pendência SGA, quantidades e OS adicionais, documentos/PDF, FIPE, autorização de atendimento sem rastreador, confirmação por foto, fluxo ZenField→Conferência→Estoque Pro, financeiro e logs.

## 6. Cadastro técnico
Subdividir em seções identificáveis:
- Identificação e contato (nome, telefone, e-mail de recuperação quando permitido).
- Base de partida (CEP, rua, número, complemento, bairro, município, UF; caminho para cadastro legado existente).
- Deslocamento e cobertura (transporte, raio, municípios atendidos; **informativo**, não ativar restrições automáticas).
- Capacidades (habilidades).
- Estoque (vínculo técnico no Estoque Pro e disponibilidade do catálogo).
- Condições comerciais (acesso/navegação para política e tarifas do financeiro, não duplicar regras).
- Acesso ao ZenField (estado da conta, ativação e recuperação existentes).
Campos obrigatórios devem continuar obrigatórios; não exigir base de quem já usa modo legado. Preservar o comportamento de edição e a criação de credenciais. Status da conta e atividade técnica são conceitos diferentes.

## 7. Financeiro, listas e páginas auxiliares
Financeiro: foco em “A fechar / Aguardando aprovação / A pagar / Vencidos”, cada indicador como filtro executável; tabela de prioridade por ação, histórico separado de pendências; detalhes de cálculo por técnico/fechamento. Não transferir nem liquidar pagamentos: o sistema registra pagamentos externos, inclusive parciais. Não reimplementar engines de fechamento.
Listagens: mesma organização de cabeçalho, busca, filtros, data, paginação, status e estados vazios. Mobile: cards compactos ou tabela responsiva legível; manter ações e contagens. Consultores e Regionais: sincronização SGA deve exibir progresso e erro sem prometer alteração de dados externos. Importação: estados de consulta, sem duplicidade, fila pendente sem criar OS automaticamente.

## 8. Escopo em outros produtos
ZenField: preservar a experiência mobile-first do técnico e fluxo de fotos, scanner, checklist e envio; mudar somente componentes/tokens compartilhados que estejam mapeados. Estoque Pro: proteger scanner, transferência assistida, carga do técnico e rastreabilidade por serial/IMEI. ZenTracking: preservar login unificado/encaminhamento de perfis. **Não aplicar tela administrativa do ZenControl no ZenField por simples cópia estética.** Nos outros repositórios, desenvolver PRs próprios após o primeiro componente canônico estabilizar no ZenControl.

## 9. Riscos e limites
- A UI não pode contornar autorização do backend: admin/operador/técnico devem conservar exatamente as capacidades atuais.
- Não modificar formas de remuneração, vigência, deslocamento, feriados, aprovação, comprovantes ou reconciliação ao mexer na apresentação.
- Não excluir campos opcionais/legados e não reorganizar payloads de maneira incompatível.
- Não editar migrations, contratos externos, DNS, segredos, serviços Render/Vercel e banco como parte deste projeto UX.
- O ambiente online-demo é temporário/efêmero e não deve ser confundido com dados reais, persistência ou integração SGA disponível.
- Qualquer plano de API futura deve ficar em “candidatos a contrato” (identidade, associados, veículos, OS, equipamentos, deslocamento, mensagens, indicadores e auditoria), com dono, autenticação e versão **a definir** em fase posterior.

## 10. Definição de pronto da Alpha 0.1 (por PR)
- Mudança observável e útil; documentação de antes/depois (capturas com dados fictícios).
- Mesmos fluxos, contratos e permissões; nenhum botão funcional perdido.
- Desktop (1280 e 1440px), tablet (768px), celular (390px e mínimo 360px), claro/escuro.
- Sem rolagem horizontal acidental; alvos de interação confortáveis; rótulos e instruções presentes.
- Operação por teclado: foco visível, tabulação, escape em diálogos e retorno de foco; não quebrar leitura por leitor de tela.
- Validações de campos, carga, erro, perda de conexão, sucesso e alterações não salvas comunicadas corretamente.
- Comandos de teste executados com resultado real; se dependência externa bloquear teste, registrar o bloqueio.
- Revisão com operador antes da Alpha 0.2. Aprovação visual isolada não constitui aceite de negócio.

## 11. Orientação imediata para o Codex
**Começar pelo pacote P0 / Fundamentação dos formulários**, não por uma reescrita de todas as telas. Produzir inventário de campos, ações, regras e permissões de OrderEditor, TechnicianForm e FormModal. Propor layout e comportamento de componentes de seção/campos; implementar em um PR vertical pequeno mantendo o código funcional. Priorizar uma tela de cada vez, com screenshots e regressão. Não implementar todos os cinco passos da OS de uma vez se houver risco de ocultar dados.

## 12. Saída esperada de cada ciclo Codex
- Resumo do problema antes da mudança.
- Mapa de componentes e contratos tocados.
- Capturas antes/depois + estados de desktop/mobile/escuro.
- Testes e casos manuais com resultado.
- Riscos e itens não cobertos.
- PR para feat/ecossistema-homologacao; aguardar aprovação para merge/deploy.
