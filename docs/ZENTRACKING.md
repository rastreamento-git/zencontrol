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
