# Importação do controle geral por etapa

Em **Configurações → Importar controle de serviços**, um administrador envia o
XLSX (até 10 MB), escolhe os meses, gera a prévia de revisão e digita `IMPORTAR SERVICOS`. A análise
não cria OS. Operadores e técnicos não têm acesso aos endpoints de importação.

## Leitura da estrutura

O leitor identifica abas de mês e ano, como `NOVEMBRO 2026` ou `MARÇO - 2027`,
sem fixar um ano no código. Busca os cabeçalhos nas primeiras 30 linhas, reconhece
variações de nomes e colunas reordenadas. Ativos e abas não mensais ficam fora.
Linhas de controle, totais e separadores são ignoradas; uma observação “Verificado
até aqui” numa OS válida não a exclui. Cabeçalho não reconhecido gera pendência.

A competência vem do nome da aba; não vira uma data de criação fictícia. Datas
explícitas prevalecem. Uma data `dd/mm` recebe o ano da aba. Agendamento vem de
coluna identificada por cabeçalho ou, no layout original, do par P/Q com data e
turno reconhecido. Uma data isolada nas observações não basta para agendar.

## Seleção e revisão obrigatórias

Nenhuma aba vem autorizada automaticamente. Após a leitura, o administrador marca
os meses desejados e clica em **Revisar abas selecionadas**. Abas auxiliares aparecem
identificadas e não podem ser selecionadas. A aprovação grava somente as linhas
prontas da seleção salva. Alterar meses ou agrupamento exige nova revisão; o token
da prévia evita aprovar uma composição antiga em outra janela.

O agrupamento é exclusivamente manual: o responsável marca uma linha de instalação
(rastreador) e outra de TAG e clica em **Confirmar agrupamento das duas linhas**.
Não há seleção global que una pares automaticamente. Mesmo um par compatível
permanece separado até a escolha explícita; situações semelhantes podem ser
sinalizadas como possíveis duplicidades para conferência.

A API valida o par escolhido: mesma aba, associado, veículo, técnico, situação,
conclusão, agendamento e turno compatíveis; seriais iguais e uso repetido de uma
linha em mais de um grupo são recusados. As duas linhas passam a um atendimento
com plano de dois equipamentos. A OS adicional segue vinculada à principal e a
listagem apresenta uma única entrada. Seriais e ambas as origens são preservados.
O botão **Desfazer agrupamento** permite separar o par antes da aprovação, gerando
nova prévia e invalidando a confirmação anterior. A escolha manual fica no lote.

O resumo permite conferir situação, composição, seriais, destino e dados antes de
confirmar. Conteúdos incorretos devem ser corrigidos na origem/cadastro e analisados
novamente; a prévia não libera conflitos automaticamente.

## Etapa proposta na prévia

| Evidência | Tratamento |
| --- | --- |
| Situação reconhecida | Preservar a etapa, validando coerência e requisitos |
| Situação vazia e data de conclusão válida | Concluído |
| Situação vazia e agendamento identificado | Agendado, exigindo técnico ativo identificável |
| Situação vazia, sem conclusão nem agendamento | Pendente |
| Pendente, agendado, em execução ou reagendar | Operação integrada, base HOT, mesmo em aba antiga |
| Concluído ou cancelado | Registro encerrado; HOT no mês corrente, WARM de 1 a 3 meses, COLD a partir de 4 meses |
| Agendamento vencido | Preservar etapa e indicar atraso, sem inventar conclusão/cancelamento |
| Conclusão sem data, futura ou contraditória | Revisão necessária |
| Inadimplente, cancelamento pendente, segurado sem rastreador ou outra situação administrativa | Revisão necessária; não presumir cancelamento nem dispensa autorizada |
| Etapa de conferência/estoque sem dados do fluxo integrado | Revisão necessária, sem inventar evidências ou lançamentos |

A retenção de encerrados usa a conclusão quando disponível e, caso contrário,
a competência da aba, seguindo os intervalos já adotados pelo sistema. A aba de
um mês passado, sozinha, nunca encerra um atendimento.

A prévia exibe etapa, destino, competência, justificativas e contagens. Casos
incompletos ou ambíguos ficam pendentes. Corrigir a origem/cadastro e gerar nova
prévia; não há liberação forçada de conflitos nem edição manual da prévia.

## Técnicos e equipamentos

Serviços em aberto entram no fluxo `controlled`. O vínculo automático exige nome
exato normalizado e único de técnico ativo. Agendado/em execução sem esse vínculo
fica pendente para revisão; outros serviços podem entrar na operação aguardando
atribuição. Mudanças de vínculo entre análise e aprovação exigem nova prévia.
Encerrados conservam o nome original sem vínculo financeiro retroativo.

TAG, duas TAGs e instalação + TAG em aberto são convertidas em instalação com a
quantidade correspondente. Equipamentos adicionais geram OS filhas, apresentadas
na prévia e contadas separadamente no resultado. Bloqueios continuam para revisão
no módulo específico. Nenhum acesso de técnico é criado automaticamente.

## Segurança e rastreabilidade

A aprovação usa transação e verifica novamente duplicidades, inclusive IDs de
origem. Repetir a confirmação do mesmo lote não duplica registros. A detecção por
serviço, associado e veículo é conservadora: atendimentos repetidos legítimos
podem exigir revisão. Nenhuma OS existente é sobrescrita.

Não há pagamento, movimentação de estoque ou envio de mensagens durante a
importação. Serviços ativos vinculados passam a estar disponíveis no fluxo normal
do técnico; ações futuras seguem as regras de execução e conferência existentes.

São mantidos valores lidos, aba, linha, competência, justificativa e versão do
leitor. IMEI textual conserva zeros iniciais; zeros já perdidos no Excel não são
reconstruídos. O arquivo completo, fórmulas e formatação não são arquivados. Não há
sincronização direta com Google Sheets.

Prévias expiram para aprovação após 24 horas. Prévias do leitor anterior, que
importava tudo para COLD, devem ser refeitas e não podem ser aprovadas nesta versão.
Lotes e auditoria integram o backup; não há exclusão automática. Na restauração,
as referências de usuários do lote são removidas, preservando a auditoria textual.

## Publicação

Atualizar API e frontend juntos, instalar dependências e executar `npm run migrate`
para aplicar `016_spreadsheet_imports.sql` e `017_spreadsheet_review.sql`. Não exige novas variáveis de ambiente.
Testes: `npm test`, `npm run build` e `scripts/portal-engagement-ui.cjs`.
A planilha real foi analisada para validar o leitor, mas não importada no banco.

## Verificação de rota e versão

A interface verifica `GET /api/spreadsheet-imports/capabilities` antes de liberar
análise (versão 4, seleção de abas e agrupamento manual). `GET /healthz` anuncia
`spreadsheet_import_version: 4`. Os endpoints de consulta, envio, revisão e aprovação
são autenticados e exclusivos de administrador.

Se aparecer rota inexistente/incompatibilidade, verificar o serviço apontado por
`VITE_API_URL` e publicar a API da mesma revisão do frontend, incluindo a migration
017. Publicar somente o site não adiciona endpoints ao backend. O Blueprint usa
`npm run migrate && npm start` e deploy automático desligado. A compatibilidade
é validada pela tela sem substituir uma falha de rota por uma lista vazia.
