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

As fotos gerais são enviadas juntas em **Fotos do atendimento**, sem selecionar veículo, instalação, serviço ou vistoria. A quantidade mínima permanece a soma dos mínimos anteriores de fotos gerais, incluindo a vistoria obrigatória dos registros atuais. Fotos já salvas nas categorias antigas continuam visíveis e contam para esse total. Checklist assinado e etiquetas não substituem fotos gerais. Não há migração de banco.

O envio sem `kind` é armazenado como `other`. As regras de equipamentos e checklist continuam separadas. O bloco **Foto do rastreador ou da TAG** usa o leitor ZXing WASM do backend para códigos de barras, QR Code e DataMatrix; valida o IMEI/serial com a carga do técnico no EstoquePro e identifica o tipo. A leitura confirmada mostra o código. Foto ilegível, código fora da carga ou múltiplos equipamentos geram aviso no próprio bloco e não criam evidência identificada. Não existe digitação manual para contornar a leitura.

Verificação: `node scripts/field-photos-ui.cjs` (após os builds locais) cobre envio sem categoria, avisos, ausência de evidências em falhas, rastreador por código de barras, TAG por QR, checklist e envio completo no celular. `apps/api/test/equipment-photo.test.js` também testa IMEI em QR Code.

## Seleção múltipla e identidade visual

**Escolher fotos** permite selecionar várias imagens; cada etiqueta deve mostrar um único equipamento. Os arquivos são enviados em fila, com versão atualizada a cada sucesso. Cada imagem mostra seu resultado e pode ser repetida separadamente em caso de erro. Uma recusa de validação não bloqueia a imagem seguinte. Um resultado incerto de rede/servidor interrompe o restante da fila para conferência, sem repetir automaticamente arquivos já recebidos. O limite total continua sendo 30 arquivos por atendimento.

ZenTracking, ZenControl, ZenField e EstoquePro usam o seletor **Aparência**: Claro, Escuro ou Automático. A preferência fica em `zen.appearance` no navegador, sincroniza abas da mesma origem e segue pelas navegações do SSO em `zen_theme` (somente `light`, `dark` ou `system`). O parâmetro é aplicado e removido antes da interface montar e não altera os códigos ou a prova PKCE. A opção Automático acompanha o sistema; uma escolha explícita prevalece sobre ele.

A família de ícones e favicons usa Z estilizado com degradês azuis distintos. O logo oficial da ZEN SEGUROS está na visualização completa da OS no ZenField e em cada página do PDF, com arquivo local para funcionar sem buscar imagens externas. Os PDFs preservam fundo branco para impressão.

A verificação Playwright cobre a fila com equipamento válido, foto ilegível e outro equipamento válido na mesma seleção, fotos gerais múltiplas, envio completo, tema explícito/automático, recarga, navegação nas três origens e ausência de rolagem horizontal no celular. Os testes do PDF protegem a paginação, dados mascarados e conteúdo.
