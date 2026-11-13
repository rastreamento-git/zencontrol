# Importação do controle geral

Em **Configurações → Importar controle de serviços**, um administrador envia um
arquivo XLSX de até 10 MB, analisa a prévia e digita `IMPORTAR HISTORICO` para
confirmar. Operadores e técnicos não podem acessar os endpoints, inclusive os de
consulta. Nenhuma ordem é criada durante a análise.

## Escopo inicial

- Abas mensais com nomes como `NOVEMBRO 2026`, mantendo as colunas A:T do controle
  geral. O cabeçalho deve estar na primeira linha. Ativos e abas auxiliares são
  excluídas; não há sincronização direta com o Google Sheets.
- Linhas de controle, totais, separadores e nomes de técnicos sem atendimento
  são ignorados. Uma observação “Verificado até aqui” em uma OS válida não a exclui.
- A prévia separa linhas prontas, ignoradas, pendentes e possíveis duplicidades,
  com aba, número da linha e motivo. Corrigir pendências no Excel e analisar
  novamente; não há edição ou liberação forçada de duplicidades nesta versão.
- A detecção conservadora de duplicidades usa serviço, associado e placa/chassi.
  Atendimentos legítimos repetidos também podem exigir revisão. Nenhum registro
  existente é sobrescrito. A confirmação revalida a base e grava em transação;
  repetir a confirmação do mesmo lote não duplica registros.
- Datas inválidas, serviços e situações desconhecidos ficam pendentes. Não são
  deduzidos agendamentos a partir das observações. IMEI/TAG textual mantém zeros
  iniciais; zeros que o Excel já removeu não podem ser reconstruídos.

## Destino e rastreabilidade

As linhas aprovadas ficam em **Ordens de serviço → Base COLD**, com fluxo legado.
O menu Histórico registra a auditoria da importação, não a listagem dessas OS.
Mesmo situações pendentes ou agendadas são preservadas como histórico; esta etapa
não ativa atendimento no ZenField. Uma migração operacional exige revisão própria.

O nome do técnico é preservado sem vincular conta ou gerar pagamento. A importação
não cria usuários, movimentações de estoque, notificações ou tarefas externas.
São mantidos os valores lidos de A:T, aba, linha e lote na origem da OS. P:T são
preservadas com identificação da coluna, sem deduzir significado. Não se arquivam
o arquivo XLSX completo, fórmulas, cores ou formatação original.

Prévias expiram para aprovação após 24 horas. Lotes, resultado e auditoria ficam
armazenados, inclusive no backup; não há exclusão automática desses dados. Ao
restaurar, referências de usuário do lote são removidas porque contas não fazem
parte desse backup, preservando o registro textual de auditoria.

## Publicação e verificação

Publicar API e frontend juntos, instalar dependências e executar `npm run migrate`
para aplicar `016_spreadsheet_imports.sql` antes de disponibilizar a tela. Não é
necessária alteração de variáveis de ambiente.

Validação: `npm test`, `npm run build` e o cenário administrativo de
`scripts/portal-engagement-ui.cjs`. Os testes usam dados fictícios e verificam
permissões, confirmação, duplicidade, concorrência, expiração, validação das
linhas e ausência de efeitos operacionais. A planilha real não foi importada.
