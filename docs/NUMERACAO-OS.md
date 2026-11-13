# Numeração das ordens de serviço

As novas OS criadas no ZenControl e importadas pela tela Importação usam `AAAAMMDDXXX`, sem prefixo ou separador. `XXX` é um contador hexadecimal de três posições, de `001` até `FFF`, com letras maiúsculas. São no máximo 4.095 OS para cada data.

| Posição no dia | Número em 13/11/2026 |
| -------------- | -------------------- |
| 1              | 20261113001          |
| 9              | 20261113009          |
| 10             | 2026111300A          |
| 15             | 2026111300F          |
| 16             | 20261113010          |
| 4.095          | 20261113FFF          |

## Data de referência

- **Criação no sistema:** dia em que a OS é gerada, no fuso `America/Sao_Paulo`. O número é definitivo; edição, reagendamento e reenvio não geram outro número.
- **Planilha:** data de **envio do termo**, que representa a geração e o envio da OS para o técnico. Não usa mês da aba, agendamento nem conclusão. Um termo de 30/10/2026 gera um número iniciado por `20261030`.
- **Termo sem data:** por decisão do administrador, utiliza a data efetiva da importação. A origem `import_date` fica registrada em `raw_legacy.numbering`, e a prévia mostra o indicador “Data da importação (termo sem data)”. O campo original do termo permanece vazio.
- **Equipamentos agrupados:** cada OS adicional tem seu próprio número na sequência comum, preservando o vínculo com a principal. Quando há linhas com datas de termo diferentes, cada adicional usa a data da própria origem. A data de criação (`created_date`) das OS importadas corresponde à data usada para a numeração.

A prévia informa a data e a origem. O número só é reservado ao confirmar a importação, dentro da mesma transação que grava as OS. Se a confirmação ocorrer em outro dia, a regra de ausência de termo utiliza esse novo dia.

## Sequência e integridade

O contador por data é persistido em `zc_order_counters` (migration `019_order_numbering.sql`) e atualizado atomicamente pelo PostgreSQL. Criações manuais, adicionais e importações compartilham a mesma sequência. A numeração segue a ordem de gravação; não reorganiza números já emitidos quando uma importação posterior acrescenta registros de uma data antiga.

A exclusão ou o cancelamento de uma OS não libera seu número para reutilização. Uma falha transacional desfaz tanto a criação quanto as reservas da operação. Ao atingir `FFF`, o sistema informa o limite e recusa a operação inteira, sem trocar a data ou criar um sufixo maior. Um lote que exceder a capacidade restante não é parcialmente importado.

O backup inclui os contadores. Backups antigos sem essa tabela continuam aceitos; o primeiro número de cada data é retomado a partir do maior identificador existente nesse formato. Registros históricos anteriores à implantação mantêm seus identificadores e vínculos. A migração técnica de bancos legados preserva os identificadores históricos por compatibilidade; o novo padrão vale para geração no sistema e importação de planilhas.

## Validação

Testes cobrem transições hexadecimais, datas independentes, simultaneidade, rollback, limite diário, retomada de sequência, backup, confirmação repetida sem nova reserva, data de cada equipamento agrupado e indicador de ausência do termo. Os testes da importação conferem também a recusa atômica de lotes acima da capacidade.
