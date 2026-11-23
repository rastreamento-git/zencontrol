# Baseline do Zen Workspace 2.0 · Alpha 0.1

Base auditada em 23/11/2026 no ZenControl, `feat/ecossistema-homologacao` em `5b7d7ce10bf20cc6c01729b2b46af3dc52ff6e21`. O PR #65 já integra o handoff. A consulta ao GitHub retornou zero PRs abertos com destino à branch. Este levantamento da Etapa 0 é o ponto de partida para a Etapa 1.

## Ordem de serviço

Fontes: [Orders e OrderEditor](../apps/web/src/components/Records.jsx), [rotas](../apps/api/src/app.js), [validação e transições](../apps/api/src/orders.js), [dados do documento](../apps/api/src/order-document.js), [campos de serviço](../packages/domain/order-fields.mjs) e [elegibilidade SGA](../apps/api/src/sga-eligibility.js).

| Grupo atual | Campos e comportamento |
| --- | --- |
| Identificação | Placa ou chassi e associado são obrigatórios no formulário. Contato formatado, CPF/CNPJ, RG, chassi separado, Renavam, marca, modelo, ano, tipo e categoria do veículo. |
| Endereço | Endereço do associado com logradouro, número, bloco, complemento, bairro, município e UF. Exibe valor legado quando não há logradouro estruturado. Atendimento usa o endereço do associado por padrão. Ao desmarcar, exibe o endereço de atendimento com os mesmos campos. Há compatibilidade com local salvo no legado. |
| SGA | Código de veículo, classificação, situação, consultor (`volunteer`) e consulta/sincronização. Placa, associado ou chassi alterado invalida a conferência no formulário. Exibe elegibilidade, situação de veículo/associado/financeiro, motivos, validade de 15 minutos, produtos e data de planilha ainda não confirmada. Simulação RJ não consulta SGA. |
| FIPE e veículo | Valor, tipo do veículo, regra regional FIPE padrão/SP/RJ, classificação automática, opção manual e explicação de cálculo. A UF pode preencher a regra inicial. Veículo elétrico exibe orientação de autorização. A regional administrativa do SGA é outro cadastro. |
| Serviço | Serviço previsto, modalidade, sinalização de visita improdutiva ou reagendamento. Instalação permite reinstalação e, nesta modalidade, reaproveitamento de equipamentos. OS adicional tem serviço bloqueado e link para a principal. |
| Equipamentos | Quantidades de rastreadores e TAGs aparecem para instalação prevista sem dispensa. Mostra equipamentos adicionais e efeito sobre serviços e PDF. Adesivo Perfurado é opcional na principal e pode vir do SGA. Dispensa autorizada fica bloqueada em OS concluída e exclui a remuneração. |
| Agendamento | Técnico, data/hora, turno (manhã/tarde/noite), situação e recomendações para admin/operador em OS principal aberta. Recomendação usa endereço e demanda de equipamentos. Selecionar uma sugestão com data pode promover PENDENTE para AGENDADO. Técnico previamente vinculado permanece na lista quando inativo. |
| Deslocamento | Distância total, distância extra ou taxa fixa. Valores mutuamente exclusivos e indisponíveis em OS filha ou após execução/envio bloqueante. API também protege lançamentos já calculados no financeiro. |
| Observações e leitura | Observações da central. Na OS existente, retorno do técnico com códigos, estado de envio e observações somente leitura, abertura/baixa/última alteração, resumo de PDF, conclusão, SGA, filas de integração, valores adicionais, histórico e diferenças auditadas. |

### Obrigatoriedade e estados

- Em toda criação, a API exige veículo válido, associado e serviço. O formulário inicia em Instalação, PENDENTE, um rastreador, zero TAGs e sem técnico/data. Na edição, a versão vigente é obrigatória. Quando informado, telefone deve respeitar a validação da API. FIPE inválida é recusada. PENDENTE pode ficar sem técnico e data.
- AGENDADO e EM EXECUÇÃO exigem técnico e data/hora. Com a guarda SGA ligada, novo agendamento ou alterações relevantes exigem validação elegível e vigente. A simulação RJ é isenta conforme a configuração local.
- Instalação e reinstalação com equipamento novo exigem composição válida de rastreadores/TAGs. Reinstalação com reaproveitamento exige evidência dos equipamentos existentes na conferência. Dispensa segue checklist assinado e conferência, sem baixa de estoque ou remuneração. Na conferência de instalação comum, o estoque confirma o recibo antes de liberar a baixa. Manutenção, retirada, visita e improdutiva seguem evidência do atendimento e não geram instalação. Quantidade e tipos de fotos dependem da configuração por serviço.
- Sinalização improdutiva deriva o serviço Improdutiva. Reagendamento gera REAGENDAR e mantém o serviço previsto. Ao remover a sinalização, técnico e data determinam AGENDADO ou PENDENTE quando aplicável. Visita e situações fora da lista atual podem aparecer em registros legados.
- Situações da lista de metadados: PENDENTE, AGENDADO, EM EXECUÇÃO, EXECUÇÃO FINALIZADA, AGUARDANDO VALIDAÇÃO, AGUARDANDO CONFERÊNCIA, CORREÇÃO SOLICITADA, AGUARDANDO ESTOQUE, REAGENDAR, CONCLUÍDO e CANCELADO. A API controla transições de envio/conferência. O seletor oculta CONCLUÍDO para registros abertos e fica bloqueado nos concluídos.

### Ações e permissões

| Ação | Condição e resposta |
| --- | --- |
| Criar, salvar, salvar e gerar PDF | Central (admin/operador). Edição usa PATCH versionado. Se o PDF falha após salvar, a aplicação informa que o registro foi salvo e orienta a baixar novamente. |
| PDF padrão e integral | OS salva, ociosa e sem alterações locais. A versão padrão mascara documentos e parte do nome. Integral é da central. |
| Consultar/sincronizar SGA | Consulta na criação. Sincronização no registro salvo, inclusive pela entrada que pede sincronização ao abrir. Se houver alterações, solicita confirmação antes de descartar. Para concluída/adicional, atualiza o resultado para conferência. Erro vai para alerta geral. |
| Abrir OS principal ou adicional | Relações existentes. Adicionais agregados pela quantidade aparecem no atendimento/PDF único, com contabilização por instalação. Adicionais legados podem ter navegação própria. |
| Encaminhar, concluir ou conferir | Em OS aberta, encaminhar e concluir são ações de legado. Encaminhar usa técnico/data salvos e opção de mascaramento. Concluir exige motivo/evidência e técnico. Em fluxo controlado, Conferir retorno abre Validações. OS concluída ou cancelada não oferece essas ações. |
| Reabrir, arquivar e valores extras | Central. Reabrir aparece em concluída e arquivar em OS existente. Ambos pedem motivo e versão. A API pode recusar reabertura ou arquivamento por estado, estoque ou vínculo financeiro. Adicionar extra pede tipo e valor, com descrição opcional. Remover extra requer confirmação. |
| Cancelar, fechar e histórico | Voltam à tela de origem. Histórico mostra autor, data, vínculo, motivo e alterações. Mensagem de integração mostra estado e último erro. Técnico atua no ZenField dentro do próprio escopo, sem acesso à gestão da central. |

O estado de edição nasce do servidor. Salvar indisponível durante operação ou enquanto a OS existente não carregou. Alertas gerais aparecem junto ao rodapé; há também avisos SGA, situação legada, retorno rejeitado, data proposta, erros de integração e notificações de sucesso. Os conflitos da API incluem versão divergente, conferência/estoque pendente, OS filha agregada, conclusão controlada, fechamento financeiro e alteração que comprometeria execução ou composição financeira registrada.

## Componentes e módulos

| Componente | Inventário |
| --- | --- |
| [TechnicianForm](../apps/web/src/components/TeamForms.jsx) e [TeamAccess](../apps/web/src/components/TeamAccess.jsx) | Central acessa por Equipe e acessos → Adicionar pessoa → Técnico, ou Editar cadastro. Nome obrigatório; telefone, habilidades, e-mail de recuperação apenas na criação. Base estruturada exige CEP, logradouro, número, bairro, município e UF; complemento, transporte, raio e municípios são opcionais. Modo legado somente leitura preserva o endereço; modo sem base limpa endereço/base no payload. Vínculo de Estoque Pro opcional, com opção de vínculo atual e aviso de indisponibilidade. Tarifas iniciais na criação (instalação, manutenção, retirada e visita improdutiva); edição de tarifas no financeiro. Atividade do cadastro na edição; flag ativa só é enviada se mudou. Conta ZenField é criada ao salvar novo técnico; ativação e recuperação têm fluxo próprio. PATCH usa versão. |
| [Field e FormModal](../packages/ui/src/components/service-common.jsx) | Field controlado com label e opções de input, select e textarea; suporta required, disabled, largura total e restrições nativas. FormModal aceita descritores estáticos ou função dos valores e trata checkbox separadamente. Preserva valores em falha, exibe alerta geral e desabilita cancelamento/salvamento ocupado. Consumidores incluem técnico, contas, consultores e ações da OS. O [common local](../apps/web/src/components/common.jsx) também deve ser conferido ao tocar formulários que embutem controles. |
| [Modal](../packages/ui/src/components/Modal.jsx) | Dialog nativo com título associado, foco inicial do navegador, cabeçalho e rodapé por CSS, Escape e botão de fechar protegidos quando ocupado. Conteúdo e ações vêm dos consumidores. Ações da OS abrem um segundo diálogo. |
| [Lista de OS e Agenda](../apps/web/src/components/Records.jsx) | Usam a mesma entrada e alternam Lista de OS, Agenda e Pendências SGA sem OS. Lista filtra por busca/situação, pagina em 25, abre editor e permite sincronizar o SGA por registro. Agenda traz intervalo, técnico, serviço e situação, atalhos Hoje/Limpar, resumo e acesso à mesma OS. Mantêm carregamento, vazio e erro. |
| [Financeiro](../apps/web/src/components/TechnicianFinance.jsx) | Visão geral e fila por prioridade, cards de situação, seleção de técnico, períodos e prévia, criação e aprovação, a pagar, histórico e configurações. Preservar pagamento externo parcial, comprovante, referência, saldo, ajustes/reembolsos, política de ciclo, vigência de valores, deslocamento, feriados e auditoria. Contratos `/finance-v2`. |
| [Consultores](../apps/web/src/components/Records.jsx) e [Regionais](../apps/web/src/components/Regionals.jsx) | Consultores têm busca, paginação, inclusão, remoção confirmada e sincronização com feedback de andamento e resultado. Contrato `/volunteers`. Regionais têm busca, situação, paginação e sincronização SGA, com dados de catálogo sem CRUD paralelo. Contrato `/regionals`. |
| [Navegação](../apps/web/src/App.jsx) | Visão geral, Operação e Gestão. Agenda e Pendências SGA ficam junto à lista de OS. Importação é exclusiva de admin. Financeiro, histórico, equipe/acessos e configurações já têm visibilidade controlada pelo perfil. Menu móvel abre painel recolhível. |

## Cascata e preparação da Etapa 1

A ordem de importação em [main.jsx](../apps/web/src/main.jsx) é `base → theme → zencontrol → appearance → experience → engagement → signal-theme`. CSS de componentes complementa essa base. A cascata continua sujeita à especificidade. `experience.css` declara Inter local. `signal-theme.css` dá precedência a Manrope no corpo, Sora nos títulos e JetBrains Mono em metadados. A aparência é inicializada antes do React com `data-theme`.

| Uso | Ponto de partida |
| --- | --- |
| Superfícies e tipografia | `--ep-canvas`, `--ep-surface`, `--ep-subtle`, `--ep-text`, `--ep-muted`, `--ep-line` e `--zen-font-*`, com valores claro/escuro existentes. |
| Ações e alertas | `--ep-primary`, `--ep-primary-hover`, `--ep-primary-soft` e `--ep-primary-ink`; pares semânticos vermelho, âmbar e verde. Manter texto de estado e foco visível. |
| Campos e espaçamento | `.zc-form-grid`, `.zc-full`, `.zc-fieldset`, `.zc-checkbox` e `.form-error`. Preservar rótulos e validação nativa. Usar a escala de 4/8/12/16/24/32 px, 24–32 px entre seções, campos de pelo menos 44 px e texto móvel de 16 px. |
| Modal e responsividade | `.pro-dialog`, `.dialog-heading`, `.dialog-actions`. Há quebras em 760 px para a camada visual e em 700 px para a grade de OS. Conferir largura de campo, foco, altura útil, cabeçalho/rodapé aderentes e áreas com rolagem sobrepostas. Há regras existentes para movimento reduzido. |

**Primeiro PR de implementação proposto.** Exercitar seções opcionais em um único `FormModal`, usando o cadastro técnico como candidato por conter modos estruturado, legado e sem base. Manter descritores planos compatíveis; compor grupos nomeados com `fieldset` e `legend`, com ajuda opcional. Acrescentar suporte optativo a ajuda e mensagem por campo com IDs estáveis, `aria-describedby` e `aria-invalid`. Usar erros por campo apenas quando o consumidor tem associação inequívoca; manter alerta geral da API. Preservar o estado controlado ao alternar seções/modos. Documentar um exemplo de uso e verificar antes de compartilhar estilos com ZenField e Estoque Pro.

**Regressão da primeira fatia.** Criar técnico com base estruturada e sem base; editar legado sem converter; alternar modos e retornar sem perder dados; simular erro do catálogo e falha ao salvar; validar CEP/UF, e-mail e vínculo; testar Escape, foco de retorno, tabulação e erro fora do trecho visível. Conferir ação de salvar no teclado e com rolagem longa, 360/390/768/1280/1440 px, temas e movimento reduzido. Usar uma ação de OS e um formulário de conta como consumidores de controle.

## Problemas observados no código

- PDF, encaminhamento, conferência/reabertura e valor extra aparecem antes dos campos na OS existente. A orientação de edição compete com ações de outros momentos do atendimento.
- OrderEditor aguarda dados e recebe erros pela mesma área de alerta no fim do formulário. Campo obrigatório usa validação nativa, sem associação a erros da API. FormModal também usa alerta geral sem foco explícito no erro.
- O editor detecta alterações para bloquear PDF e pedir confirmação ao sincronizar SGA. Cancelar/fechar não usa essa proteção e o cálculo de alterações depende de já existir uma OS.
- Ordem concluída controlada e outros bloqueios do backend ainda podem ter campos e ações apresentados antes da recusa. Testar a comunicação desses estados antes de alterar visibilidade.
- O teste `scripts/order-management-ui.cjs` ainda busca `.zc-fipe-result output`, enquanto o editor renderiza `small` nessa área. O seletor precisa ser revalidado separadamente do redesign.

## Baseline técnica

| Verificação | Resultado |
| --- | --- |
| `npm ci --include=dev --cache /tmp/zen-npm` | Passou após redirecionar o cache. O cache padrão falhou com ENOENT no diretório pessoal do ambiente. |
| `npm run check` | Passou. |
| `npm test` | 305 aprovados (267 API e 38 integração de estoque). |
| `npm run build` | Passou. |
| `npm run homologation:build` | Passou em ZenControl, ZenField (`ca15eee`) e Estoque Pro (`ae0ab33`). |
| `ZEN_CHROMIUM_PATH=/usr/bin/chromium npm run test:frontend` | 6 passaram e 3 tiveram timeout na base. Dois casos de Financeiro (resposta tardia de tarifa e troca de técnico no pagamento) e um de Equipe e acessos (criação/edição). Nenhum erro de execução de página reportado. |

Os três timeouts aconteceram antes de alterar a aplicação. O roteiro de Equipe tenta salvar um técnico novo sem preencher a base estruturada agora obrigatória no modo padrão e ainda procura o campo antigo “Endereço / região base”. Os cenários financeiros devem ser reexecutados com diagnóstico de seletor e conferência dos estados atuais. As verificações locais usam apenas dados fictícios e não validam serviços externos.

## Evidências visuais

Foram capturadas 24 vistas com Chromium local, em 1280 × 900 e 390 × 844, nos temas claro e escuro. Cada prancha reúne menu, OS nova, OS em edição, técnico novo, técnico legado e financeiro. A OS em edição e o cadastro legado vieram das fixtures locais. O formulário novo foi preenchido com exemplos fictícios, sem gravar. As capturas retratam o estado anterior à Etapa 1.

- [1280 px · claro](ux-baseline-alpha-01/1280-light.jpg) e [1280 px · escuro](ux-baseline-alpha-01/1280-dark.jpg).
- [390 px · claro](ux-baseline-alpha-01/390-light.jpg) e [390 px · escuro](ux-baseline-alpha-01/390-dark.jpg).

A amostra de primeiro campo dos quatro formulários teve 44–47 px de altura no desktop e 46–50 px no celular. Texto de campo de 14 px e 16 px, respectivamente. A largura rolável da página e a dos diálogos não ultrapassaram suas áreas visíveis na amostra. O navegador confirmou Manrope no corpo e Sora nos títulos dos diálogos. Escape fechou a nova OS em todas as quatro combinações, mas o foco ficou no documento em vez de voltar para “Nova ordem de serviço”. Corrigir e testar o retorno de foco na Etapa 1. A inspeção de teclado foi limitada a esse fechamento e aos cenários automatizados registrados acima. Os demais tamanhos, estados de erro e verificações com leitor de tela ficam na matriz de aceite da Etapa 1.
