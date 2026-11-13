# Importação do controle geral por etapa

A prévia mostra apenas **Nome, Placa e IMEI** no resumo. Os demais campos ficam
disponíveis em **Revisar conteúdo completo** e permanecem na importação.

No menu **Importação**, um administrador envia o
XLSX (até 10 MB), escolhe os meses e a base de destino, gera a prévia de revisão e clica em **Importar N atendimentos**. A análise
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

O agrupamento é exclusivamente manual: o responsável marca dois registros do mesmo
nome e placa/chassi e clica em **Agrupar pares selecionados**. A primeira linha
selecionada fornece os dados principais e o IMEI principal. A segunda fornece o
IMEI adicional. Podem ser dois rastreadores ou rastreador e TAG.
Não há seleção global que una pares automaticamente. Mesmo um par compatível
permanece separado até a escolha explícita; situações semelhantes podem ser
sinalizadas como possíveis duplicidades para conferência.

A API valida nome e placa/chassi normalizados, seriais distintos e uso único de
cada linha. A detecção de possíveis duplicidades usa nome e veículo, sem depender
do serviço, técnico ou data. Diferenças entre as linhas aparecem como alerta;
serviço, situação, técnico e demais campos principais seguem a primeira linha.
Ambas as origens ficam preservadas. A OS adicional segue vinculada à principal,
com tipo e serial correspondentes à segunda linha, mantendo uma única entrada
na listagem. Atendimentos que já contêm vários equipamentos não são reagrupados
como se representassem um único equipamento.

**Desfazer agrupamento** separa o par antes da aprovação e invalida a confirmação
anterior. A escolha manual fica registrada no lote. O campo de busca aceita nome,
placa/chassi ou IMEI; possíveis duplicidades são ordenadas por nome e veículo.

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
| Pendente, agendado, em execução ou reagendar | Operação integrada; base escolhida pelo administrador |
| Concluído ou cancelado | Registro encerrado; base escolhida pelo administrador |
| Agendamento vencido | Preservar etapa e indicar atraso, sem inventar conclusão/cancelamento |
| Concluído sem data de conclusão | Usar a data efetiva da importação, com indicador persistido de origem |
| Conclusão futura, inválida ou contraditória | Revisão necessária |
| Inadimplente, cancelamento pendente, segurado sem rastreador ou outra situação administrativa | Revisão necessária; não presumir cancelamento nem dispensa autorizada |
| Etapa de conferência/estoque sem dados do fluxo integrado | Revisão necessária, sem inventar evidências ou lançamentos |

A base não é inferida pelo mês, idade ou situação. O administrador escolhe
explicitamente **HOT, WARM ou COLD** para o lote selecionado; não há opção inicial
preenchida. A API recusa revisão sem uma base válida. Alterar a base invalida a
confirmação anterior e exige nova revisão. A etapa do atendimento continua sendo
identificada pelos dados, independentemente da base escolhida.

A prévia exibe etapa, destino, competência, justificativas e contagens. Casos
incompletos ou ambíguos ficam pendentes. Corrigir a origem/cadastro e gerar nova
prévia; não há liberação forçada de conflitos nem edição manual da prévia.

## Técnicos e equipamentos

Serviços em aberto entram no fluxo `controlled`, na base escolhida pelo administrador. O vínculo automático exige nome
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
associado e veículo é conservadora: atendimentos repetidos legítimos
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
análise (versão 7, seleção de abas, base administrativa e agrupamento manual). `GET /healthz` anuncia
`spreadsheet_import_version: 7`. Os endpoints de consulta, envio, revisão e aprovação
são autenticados e exclusivos de administrador.

Se aparecer rota inexistente/incompatibilidade, verificar o serviço apontado por
`VITE_API_URL` e publicar a API da mesma revisão do frontend, incluindo a migration
017. Publicar somente o site não adiciona endpoints ao backend. O Blueprint usa
`npm run migrate && npm start` e deploy automático desligado. A compatibilidade
é validada pela tela sem substituir uma falha de rota por uma lista vazia.

## Exportação completa da revisão

**Exportar revisão completa (XLSX)** baixa um arquivo com o resumo Nome/Placa/IMEI,
uma aba de revisão com todos os campos mapeados, base, situação, classificação e
agrupamentos manuais, e abas de origem com todos os valores lidos dos meses
selecionados, incluindo linhas pendentes/ignoradas e campos complementares. Números
de série são células de texto para preservar zeros iniciais. A exportação usa
escrita por streaming e não grava OS nem confirma a importação.

Prévias da versão 4 devem ser refeitas: sua base tinha sido calculada automaticamente.
A versão 5 exige a escolha explícita do administrador. Não há nova migração de banco.

## Conclusão sem data e navegação

Se a situação for Concluído e a data estiver vazia, a prévia sinaliza que usará a
data de importação. Na aprovação é usada a data daquele dia em America/Sao_Paulo,
com `completion_date_source: import_date` no documento e na origem da OS. O indicador
aparece na revisão e na listagem/detalhe da OS; o valor original vazio é preservado.
Datas preenchidas inválidas continuam exigindo revisão. O marcador não pode ser
alterado manualmente por edição comum do documento.

A importação fica no menu próprio, exclusivo de administrador. Configurações mantém
backup e conexões, com arquivamento avançado e regras de conferência recolhidos.
API e frontend devem ser publicados juntos na versão 7. Não há nova migração.

## Ações em lote e confirmação simples

A confirmação não exige digitar uma frase. O botão **Importar N atendimentos** envia
a aprovação do administrador com o token da prévia revisada; permissões, revisão,
expiração e proteção contra duplicidade permanecem verificadas no servidor.

Todos os registros prontos da seleção mensal entram na importação. As caixas de
seleção de linhas servem somente para agrupar equipamentos. Há ações para selecionar
todos os meses, todos os registros, todos os resultados filtrados (inclusive fora
da página atual) ou apenas a página atual, além de limpar a seleção.

**Agrupar pares selecionados** processa de uma vez os pares de mesmo nome e veículo
escolhidos pelo responsável. Registros sem par continuam separados. Mais de duas
linhas do mesmo atendimento ou serial repetido ficam sinalizados para revisão;
não é escolhido um par arbitrário. A primeira linha selecionada continua principal.
