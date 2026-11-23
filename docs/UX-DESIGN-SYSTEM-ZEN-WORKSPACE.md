# Zen Workspace 2.0 — Design System operacional

**Proposta de UX para a Alpha 0.1.** Preferir os componentes e tokens atuais; este documento especifica decisões de interface, não autoriza trocar a arquitetura ou dependências.

## 1. Linguagem visual
Estilo corporativo executivo, contido, organizado e confiável: azul Zen Seguros, superfícies neutras, branco no tema claro, texto de alto contraste, indicadores legíveis e feedback discreto. Evitar excesso de ornamentos, gradientes, vidro, neon, sombra pesada, ícones sem semântica e submenus intermináveis.

Paleta de referência (confirmar mapeamento com CSS atual):
- Azul de marca/ação: #195CCD
- Azul de hover: #144CAB
- Navegação escura: #10264B (aceita aproximação ao token já consolidado no código)
- Fundo: #F2F6FC
- Superfície clara: #FFFFFF
- Texto principal: #13233C
O tema escuro usa tokens semânticos com contraste equivalente, não as cores claras fixas em cada componente.
Situações usam cor + texto, nunca exclusivamente cor.

**Fonte:** priorizar fontes já empacotadas/localizadas pelo projeto. Conferir CSS/asset atual antes de mexer em família tipográfica; não incorporar fontes externas desnecessárias. O documento anterior da experiência menciona Inter local, enquanto dependências atuais também incluem Manrope, Sora e JetBrains Mono: tratar como decisão pendente de verificação no runtime, não impor troca.

## 2. Hierarquia de interface
- Página: breadcrumb discreto, título claro, subtítulo de uma linha, UMA ação principal.
- Cabeçalho de seção: rótulo + orientação curta quando necessário; resumo de dados mais útil acima das tabelas.
- Grupo de campos: título significativo em português, ajuda opcional, separação de 24–32px; não transformar cada grupo em uma caixa colorida.
- Conteúdo secundário: abas, accordion ou painel lateral somente quando reduz esforço; evitar esconder a informação que determina a próxima ação.
- Metadados, histórico e auditoria: sempre acessíveis em local previsível.
- Botão primário reservado para a ação principal; secundário para voltar/exportar; ação destrutiva isolada com confirmação.

## 3. Espaçamento, campos e densidade
Usar escala coerente de 4/8/12/16/24/32px, evitando exceções por tela. Campos de pelo menos 44px de altura, labels visíveis e texto de input 16px no celular. Em telas largas, dois campos por linha quando fazem sentido; não forçar endereço/logradouro extenso em meia coluna. Em celular, uma coluna, área de ação ao alcance, não depender de hover. Limitar largura útil de formulários longos para legibilidade.

Padrão de formulário:
- Título específico: “Cadastrar técnico”, “Agendar instalação”, “Editar associado”.
- Campos obrigatórios assinalados no label e validados perto do erro.
- Ajuda contextual curta; placeholders são exemplo, não substituem label.
- Campos condicionais têm regras explícitas, sem apagar dados ao ocultar.
- Anexos têm estados de upload, erro, anexo existente e confirmação.
- Botões salvar/cancelar fixos quando útil; dialog responsivo, fechamento acessível e feedback de alterações não salvas.
- Ações perigosas ficam afastadas da ação primária e requerem confirmação.
- Validação do backend continua fonte de verdade; frontend nunca presume sucesso sem resposta.

## 4. Componentes candidatos a reutilização
Primeiro considerar extensão segura de:
- packages/ui/src/components/service-common.jsx: Field, FormModal e primitivas associadas.
- packages/ui/src/components/Modal.jsx: diálogos genéricos.
- packages/ui/src/styles/{base,experience,zencontrol,signal-theme}.css (conferir cascata e precedência).
- apps/web/src/components/common.jsx: Intro, Panel, Empty, Pager, Loading.
- apps/web/src/components/Records.jsx: OrderEditor e listagens.
- apps/web/src/components/TeamForms.jsx: TechnicianForm.
- apps/web/src/components/TechnicianFinance.jsx: central financeira.
- apps/web/src/components/Regionals.jsx: listagem SGA.

Preferir criar componentes composicionais opcionais (por exemplo SectionHeader, FieldGroup, FormSection, StatusBadge, ActionBar) com APIs pequenas e retrocompatíveis. Não refatorar todos os FormModal de uma vez. Não adicionar biblioteca de UI sem comparação de custo/benefício e aprovação.

## 5. Navegação e status
Menu agrupado por finalidade (Operação, Cadastros, Financeiro, Administração) e visibilidade por papel. Item selecionado destaca página; ícones são auxiliares, não substituem labels.
Status têm texto operacional consistente; nomes de estados internos persistem. Usar badges neutras por padrão e cor somente onde informa prioridade, erro, sucesso ou ação.

## 6. Responsividade e acessibilidade
- Testar 360/390/768/1280/1440px.
- CSS sem overflow horizontal acidental; tabelas adaptadas sem perder ações.
- Focus-visible em botões, campos e abas; tab order reproduz fluxo de leitura.
- Tecla Esc fecha modal apenas quando seguro; focus restore ao elemento iniciador.
- aria-label/aria-describedby para status e erros; role=status em consultas assíncronas, alert em erros.
- Preferir outline/borda e contraste reais; não depender apenas de placeholders.
- Respeitar prefers-reduced-motion.
- Ao esconder ações por permissão, a API deve continuar protegendo operação independentemente do frontend.
- Tema claro e escuro são critérios de aceite igualmente obrigatórios.

## 7. Anti-padrões a remover gradualmente
- Wizard obrigatório com cinco telas para editar um único campo de OS já cadastrada.
- Painel com mais de uma ação primária.
- Informações críticas escondidas em “mais opções”.
- Sequência de 25+ campos sem títulos orientadores.
- Status transmitido só por cor.
- Reload que perde dados de formulário.
- Simulação de sucesso sem confirmação do backend.
- URLs, endpoints ou condições de pagamento introduzidos apenas para viabilizar o layout.
- Alterar simultaneamente ZenControl, ZenField e Estoque Pro sem testes/PRs independentes.

## 8. Checklist de revisão visual
[ ] Consegue identificar em 3 segundos qual é a ação principal?
[ ] Campos são organizados pela ordem real de trabalho?
[ ] O usuário entende onde está, o que falta e o próximo passo?
[ ] Existe diferença clara entre editar, aprovar e concluir?
[ ] Indicadores e filtros respondem ao clique?
[ ] Erros dizem o que fazer e preservam dados?
[ ] Funciona com teclado, mobile e tema escuro?
[ ] Fluxos antigos, permissões e controles financeiros permanecem intactos?
