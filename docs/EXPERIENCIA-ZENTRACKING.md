# Experiência visual do ecossistema ZenTracking

O ZenTracking, ZenControl, ZenField e Estoque Pro compartilham uma base visual corporativa azul, com contraste próprio nos modos claro e escuro. As interfaces mantêm as operações e permissões existentes.

## Padrões comuns

- Fonte Inter variável hospedada no próprio aplicativo, sem requisição a serviços de fontes. Licença OFL acompanha o arquivo em `public/brand`.
- Texto de interface de 13–14 px, campos de pelo menos 44 px e fonte de 16 px nos campos no celular para evitar zoom durante a digitação.
- Superfícies neutras, bordas discretas, cantos consistentes e azul reservado para ações e seleção. Situações usam texto além da cor.
- Menu lateral com grupos claros na central e no estoque; seletor de aparência e dados da sessão sempre acessíveis.
- Diálogos com título e ações de salvamento visíveis durante a rolagem. Foco de teclado visível, link para pular a navegação e animações reduzidas conforme a preferência do dispositivo.

## Navegação e prioridades

O ZenTracking apresenta os três aplicativos em cards ilustrados, com suas funções e uma ação explícita para abrir cada ambiente. O perfil da sessão permanece identificado.

O painel do ZenControl destaca conferências e agenda da equipe. As listas de OS e os últimos atendimentos passam de tabela para cartões com rótulos no celular, mantendo o acesso à edição e aos detalhes. O Estoque Pro destaca a entrada de equipamentos no painel e usa a mesma base de controles nas telas de movimentação e rastreabilidade.

No ZenField, o início reúne serviços em atendimento, concluídos, correções, previsão financeira e equipamentos em carga. Os indicadores abrem a lista correspondente. Filtros podem ser expandidos e exibem a quantidade de critérios ativos. No celular, a navegação fica na parte inferior com área reservada para não cobrir o fim do conteúdo.

O atendimento mostra o resumo da OS primeiro e mantém o documento completo em uma seção expansível. O registro oferece atalhos com foco para fotos opcionais, equipamentos previstos, checklist e envio. A identificação dos equipamentos, o checklist assinado, o vínculo da OS adicional e as validações de estoque e financeiro seguem os contratos existentes.

## Manutenção

A base canônica fica em `packages/ui/src/styles/experience.css` e o componente de apresentação do acesso em `packages/ui/src/components/AuthStory.jsx`. As cópias do ZenField ficam em `src/ui`; as do inventário, em `invent-front/src`. Os arquivos são idênticos entre os três repositórios para permitir builds independentes. Mudanças nessa base devem ser replicadas e verificadas nos três. Os ajustes específicos ficam em `tracking.css` e `field-experience.css`.

O navegador aplica a aparência antes de montar a aplicação. A cor da barra do navegador acompanha a paleta e a preferência continua seguindo a navegação SSO. Nenhuma dependência de runtime foi acrescentada.

## Verificação

Builds dos três frontends; verificações de fontes do ZenField; lint e testes existentes do inventário. Os roteiros `scripts/unified-access-ui.cjs` e `scripts/field-photos-ui.cjs` cobrem acesso entre aplicativos, perfis, supervisão, temas, rolagem, envio de fotos, leitura de etiquetas e OS adicional. A revisão visual inclui desktop, celular, modo claro/escuro, navegação por etapas e telas de movimentação do estoque.

Publicação restrita à branch e aos projetos de homologação existentes. Esta revisão de interface não requer migração nem reinício da API.
