# ZenTracking — entrada única e operação da central no ZenField

ZenTracking identifica o conjunto de aplicações do setor de rastreamento. A entrada principal usa a origem já configurada da interface central e apresenta três cards ilustrados: ZenControl, ZenField e EstoquePro. A tela de cards fica em `/`; a central operacional fica em `/zencontrol`. O servidor e a Vercel precisam manter o fallback SPA para a navegação direta.

## Perfis

| Perfil | Entrada após login | Acesso |
| --- | --- | --- |
| Administrador | Cards do ZenTracking | Acesso completo aos três sistemas |
| Operador | Cards do ZenTracking | Acesso completo aos três sistemas |
| Técnico | ZenField direto | Somente seu ambiente e suas OS |

Administrador e operador pertencem ao mesmo grupo de acesso completo, incluindo usuários, configurações e financeiro. Confirmação por senha, backup antes de reset, preservação do último administrador e demais regras das operações continuam obrigatórias. A central pode entrar no ZenField mesmo quando o técnico ainda não ativou sua conta; o cadastro do técnico precisa estar ativo.

## Uso no ZenField

1. A central abre o card ZenField e seleciona um técnico ativo.
2. Um aviso permanente identifica o ambiente selecionado e o autor real das ações.
3. A central acessa os mesmos serviços, documentos, evidências, equipamentos, valores, solicitações e financeiro do técnico e executa o mesmo fluxo de registro e envio.
4. **Trocar técnico** encerra o contexto visual anterior e abre a seleção novamente. Requisições em andamento conservam o contexto com o qual foram enviadas.
5. Alterar senha e sair continuam atuando na conta real do usuário. A opção de senha é identificada como **Alterar minha senha** durante a supervisão.

A supervisão não remove validações de evidências, assinatura do checklist, versões, aprovação, confirmação de estoque nem regras financeiras. O funcionário mantém sua identidade e sua sessão; não precisa da senha do técnico e não recebe um token daquele técnico.

## Implementação e auditoria

O frontend envia `X-Zen-Technician-Id` somente nas APIs do ambiente técnico, notificações e documentos financeiros vinculados. O backend valida perfil e técnico ativo em cada requisição, usa contexto assíncrono isolado por requisição e mantém `req.user` intacto. A mesma sessão pode consultar técnicos distintos em requisições simultâneas sem compartilhar estado entre usuários.

`source_user_id` registra quem iniciou o envio. Os eventos operacionais guardam `detail.delegation` com ID, login e perfil do autor, ID e nome do técnico e origem `zenfield_supervision`. A abertura do ambiente e a leitura de notificação também são auditadas. Leituras feitas pela central não marcam a notificação como lida pelo técnico.

O backend recusa técnicos tentando selecionar contextos e funcionários sem seleção nas APIs técnicas. Evidências, OS, solicitações, extratos e comprovantes preservam o vínculo com o técnico selecionado. Não houve alteração de schema ou criação de credenciais para a supervisão.

## Verificação

`apps/api/test/field-supervision.test.js` cobre perfis, seleção, adulteração de contexto, concorrência, atendimento completo com autoria real, financeiro, notificações e desativação. `apps/api/test/unified-access.test.js` cobre SSO e reautenticação dos dois perfis da central. O teste `scripts/unified-access-ui.cjs`, executado após `npm run homologation:build`, percorre os três cards, os três aplicativos, a operação por técnico, a auditoria, troca de contexto, saída global e entrada direta do técnico, com verificação de rolagem e largura em celular.

## Fotos do atendimento no ZenField

As fotos gerais são enviadas juntas em **Fotos do atendimento**, sem selecionar veículo, instalação, serviço ou vistoria. As fotos gerais são opcionais, sem quantidade mínima, inclusive para vistorias. Fotos já salvas continuam visíveis. As etiquetas dos equipamentos previstos na OS e o checklist assinado são conferidos separadamente.

O envio sem `kind` é armazenado como `other`. As regras de equipamentos e checklist continuam separadas. O bloco **Equipamentos previstos nesta OS** usa o leitor ZXing WASM do backend para códigos de barras, QR Code e DataMatrix; valida o IMEI/serial com a carga do técnico no EstoquePro e identifica o tipo. A leitura confirmada mostra o código. Foto ilegível, código fora da carga ou múltiplos equipamentos geram aviso no próprio bloco e não criam evidência identificada. Não existe digitação manual para contornar a leitura.

Verificação: `node scripts/field-photos-ui.cjs` (após os builds locais) cobre envio sem categoria, avisos, ausência de evidências em falhas, rastreador por código de barras, TAG por QR, checklist e envio completo no celular. `apps/api/test/equipment-photo.test.js` também testa IMEI em QR Code.

## Seleção múltipla e identidade visual

**Escolher fotos** permite selecionar várias imagens; cada etiqueta deve mostrar um único equipamento. Os arquivos são enviados em fila, com versão atualizada a cada sucesso. Cada imagem mostra seu resultado e pode ser repetida separadamente em caso de erro. Uma recusa de validação não bloqueia a imagem seguinte. Um resultado incerto de rede/servidor interrompe o restante da fila para conferência, sem repetir automaticamente arquivos já recebidos. O limite total continua sendo 30 arquivos por atendimento.

ZenTracking, ZenControl, ZenField e EstoquePro usam o seletor **Aparência**: Claro, Escuro ou Automático. A preferência fica em `zen.appearance` no navegador, sincroniza abas da mesma origem e segue pelas navegações do SSO em `zen_theme` (somente `light`, `dark` ou `system`). O parâmetro é aplicado e removido antes da interface montar e não altera os códigos ou a prova PKCE. A opção Automático acompanha o sistema; uma escolha explícita prevalece sobre ele.

A família de ícones e favicons usa Z estilizado com degradês azuis distintos. O logo oficial da ZEN SEGUROS está na visualização completa da OS no ZenField e em cada página do PDF, com arquivo local para funcionar sem buscar imagens externas. Os PDFs preservam fundo branco para impressão.

A verificação Playwright cobre a fila com equipamento válido, foto ilegível e outro equipamento válido na mesma seleção, fotos gerais múltiplas, envio completo, tema explícito/automático, recarga, navegação nas três origens e ausência de rolagem horizontal no celular. Os testes do PDF protegem a paginação, dados mascarados e conteúdo.

## Equipamentos previstos e OS adicional

O ZenField exibe o tipo e a quantidade de cada equipamento previsto, com o progresso de identificação das etiquetas. Exemplo: uma OS com rastreador e TAG pede a foto de cada um; uma OS adicional de rastreador pede somente a etiqueta desse rastreador. Fotos gerais não bloqueiam o envio. Equipamentos além do previsto devem ser registrados na OS adicional, para não misturar serviço e remuneração.

A central seleciona **Equipamento adicional (gera outra OS)** ao criar ou editar um atendimento. O contrato anterior `document_data.equipment=[tracker,tag,tracker_extra]` também gera a OS de rastreador adicional automaticamente e mantém na principal somente rastreador e TAG. Marcar as duas formas para o mesmo tipo gera apenas uma OS adicional. O vínculo é persistido em `parent_order_id` e `additional_equipment` pela migração `008_additional_equipment_orders.sql`. A migração vincula os adicionais gerados pelo fluxo anterior, sem alterar valores pagos ou evidências históricas.

Cada adicional tem suas próprias etiquetas, envio, conferência, confirmação no EstoquePro e lançamento financeiro. A tarifa é a vigente e cadastrada para o serviço de instalação/reinstalação do técnico; não foi criado um valor arbitrário para equipamento adicional. A remuneração só fica elegível após a conferência e confirmação do estoque. A principal não remunera o equipamento extra junto com os seus equipamentos planejados. A central e o técnico encontram os adicionais vinculados na OS principal.

Verificação de integração: `apps/api/test/portal.test.js` cobre conclusão sem fotos gerais, rastreador+TAG sem evidências gerais, criação idempotente de adicional, bloqueio de equipamento excedente na principal, duas confirmações reais no estoque e dois lançamentos financeiros independentes. `scripts/field-photos-ui.cjs` verifica os cartões por equipamento, envio com zero fotos gerais e abertura da OS adicional pelo celular.
