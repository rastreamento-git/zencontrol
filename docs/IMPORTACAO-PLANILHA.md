# Importação do controle geral por etapa

Em **Configurações → Importar controle de serviços**, um administrador envia o
XLSX (até 10 MB), confere a classificação e digita `IMPORTAR SERVICOS`. A análise
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
para aplicar `016_spreadsheet_imports.sql`. Não exige novas variáveis de ambiente.
Testes: `npm test`, `npm run build` e `scripts/portal-engagement-ui.cjs`.
A planilha real foi analisada para validar o leitor, mas não importada no banco.
