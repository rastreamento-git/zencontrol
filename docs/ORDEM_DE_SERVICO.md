# Documento de ordem de serviço · 6.1

A emissão usa o modelo funcional do gerador independente fornecido como referência, integrado ao cadastro e ao agendamento do ZenControl. O script de referência e suas credenciais não são distribuídos no repositório.

## Conteúdo do PDF

| Bloco | Campos |
| --- | --- |
| Dados do associado | Nome, contato, CPF/CNPJ, RG e endereço do associado |
| Informações do veículo | Placa, Renavam, chassi, marca/modelo, ano, categoria/tipo e FIPE |
| Detalhes do atendimento | Serviço, técnico responsável, data/horário e local do serviço |
| Instruções / observações | Quantidades de equipamentos e relato/instruções da OS |

O identificador da OS aparece no cabeçalho. O retorno é orientado pelo portal do técnico nas novas OS e mantém o fluxo compatível nas OS legadas. Instruções longas recebem páginas de continuação; as fontes são incorporadas para manter a aparência do documento nos diferentes leitores.

## Preenchimento automático

Serviço, agendamento e técnico são lidos dos campos salvos de `zc_orders`. Os dados complementares de documento não podem sobrescrever essas informações. O nome do técnico é resolvido pelo cadastro vinculado à OS; a data é apresentada em português e usa o agendamento salvo, sem substituí-lo pela data da emissão.

Na central, **Salvar e gerar PDF** persiste os campos atuais antes de emitir. O botão **PDF da OS** baixa a versão já salva e fica indisponível enquanto há alterações pendentes no formulário. Se o download falhar após salvar, o registro permanece salvo e a interface orienta a baixar pelo próprio registro.

OS sem técnico ou agendamento indicam explicitamente a pendência; nenhum responsável ou horário é inventado. Equipamentos previstos orientam o atendimento e não geram movimentos de estoque. A confirmação dos IMEIs segue as regras de conferência e integração existentes.

## Consulta SGA

A consulta aceita ID SGA, placa ou chassi. Quando a busca resumida retorna o código do veículo, a ficha completa é consultada por ID; o voluntário também é complementado quando disponível. Somente campos conhecidos de associado/veículo são aproveitados. Dados vazios de uma resposta complementar não apagam valores válidos já obtidos.

O formulário preserva serviço, técnico, horário, equipamentos previstos e local de atendimento já informado durante essa consulta. Endereço do associado e local do serviço são campos distintos. O PDF utiliza o cadastro salvo e não depende de disponibilidade da Hinova durante a emissão.

Configure `INTEGRATIONS_ENABLED=true`, `HINOVA_TOKEN_ASSOC`, `HINOVA_USER` e `HINOVA_PASS` no ambiente do servidor para habilitar a consulta. As validações de software usam respostas fictícias; a integração real depende de credenciais válidas e homologação no ambiente da associação.

## Acesso e proteção dos dados

A versão padrão oculta CPF/CNPJ, RG, Renavam e parte do nome, mantendo contato e endereço necessários ao atendimento. A versão integral é exclusiva de administradores, inclusive nos envios por WhatsApp. Ocultar campos não representa anonimização de todo o documento.

O portal permite baixar a OS somente ao técnico atualmente responsável e sempre entrega a versão protegida, independentemente de parâmetros de URL. Alterações de atribuição retiram o acesso do responsável anterior. O documento gerado manualmente e o anexo enviado pelo worker utilizam o mesmo gerador.

## Atualização de uma instalação

A migração `003_order_document.sql` adiciona `zc_orders.document_data` como JSONB com valor inicial vazio. Campos anteriores, ordens e vínculos permanecem preservados. Execute `npm run migrate` no banco do ZenControl antes de iniciar a versão 6.1, conforme o Pre-Deploy já configurado no Render.

Os dados complementares integram o backup operacional e são restaurados junto da OS. Não é necessário criar um serviço separado para o gerador Python nem cadastrar novamente o agendamento.

## Dispensa de rastreador autorizada

No cadastro ou na edição da OS, a central pode marcar **Dispensa de rastreador autorizada**, indicando que o cliente está autorizado a permanecer sem rastreador. O campo `tracker_waiver_authorized` é booleano, aparece no ZenField, na conferência e nas instruções do PDF e participa da auditoria da OS. O técnico não pode alterar essa autorização.

A OS marcada fica fora dos valores estimados, confirmados e dos fechamentos do técnico, incluindo tarifa base, adicionais e ajustes. Isso vale para o cálculo atual e o legado. A dispensa não cria composição financeira; se a central marcar uma OS ainda aberta que já possua composição, ela é preservada para histórico e excluída dos cálculos. Desmarcar antes da conclusão restaura a elegibilidade normal. OS confirmadas exigem reabertura administrativa quando permitida; OS já incluídas em fechamento não permitem alteração retroativa.

O atendimento com dispensa exige fotos da vistoria, checklist preenchido e assinado e conferência da central. Não exige fotos de instalação/etiqueta nem IMEI, não aceita registro de instalação e não gera movimento no Estoque Pro. A conclusão não envia a classificação padrão de instalação concluída ao SGA.

A migração `007_tracker_waiver.sql` inicializa o campo como `false` nas OS existentes. Execute as migrações antes de subir o backend atualizado; backups passam a incluir o campo junto da OS. Valide a interface com `node scripts/tracker-waiver-ui.cjs` após `npm run homologation:build` e as regras com `node --test apps/api/test/tracker-waiver.test.js apps/api/test/order-document.test.js`.

## Classificação FIPE e veículo elétrico

O **Tipo FIPE** é calculado pelo valor, tipo do veículo e regra regional escolhida (padrão, SP ou RJ). O limite inicial da categoria Média está incluído; R$ 80.000,00 permanece Média. **Alta** vale acima de R$ 80.000,00 para qualquer veículo e UF.

| Tipo | Regra | Baixa | Média |
| --- | --- | --- | --- |
| Automóvel | Padrão | Abaixo de R$ 70.000 | R$ 70.000 a R$ 80.000 |
| Automóvel | SP | Abaixo de R$ 40.000 | R$ 40.000 a R$ 80.000 |
| Automóvel | RJ | Abaixo de R$ 30.000 | R$ 30.000 a R$ 80.000 |
| Moto | Padrão | Abaixo de R$ 40.000 | R$ 40.000 a R$ 80.000 |
| Moto | SP | Abaixo de R$ 25.000 | R$ 25.000 a R$ 80.000 |
| Moto | RJ | Abaixo de R$ 20.000 | R$ 20.000 a R$ 80.000 |

O backend usa o mesmo cálculo do formulário, em centavos, e ignora substituições manuais da categoria. Valores inválidos são recusados. Abaixo ou igual a R$ 80 mil, outros tipos ou dados incompletos ficam sem classificação automática. A consulta SGA não usa o endereço do associado para presumir a regra regional. Rótulos históricos sem dados suficientes são preservados nas edições que não alteram os dados de classificação.

**Veículo elétrico** é uma indicação independente da **Dispensa de rastreador autorizada**. A indicação aparece no ZenField e nas instruções do PDF e pede confirmação do cliente para instalação. Ela não altera automaticamente os equipamentos, a remuneração ou a dispensa.

## Retorno, equipamentos adicionais e auditoria

O IMEI deixa de ser um campo de digitação na central. Os códigos informados pelo técnico aparecem na OS e na listagem depois do envio para validação, inclusive durante a conferência. O rascunho não publica IMEIs. Um envio devolvido continua identificado como pendente de correção, preservando o histórico.

O atendimento permanece em **Em atendimento** enquanto houver uma instalação adicional pendente, mesmo que a OS principal esteja concluída. A OS principal e seus equipamentos adicionais ocupam **uma linha** nas listagens operacionais; busca, paginação e filtros consideram também os adicionais. Nas novas OS com quantidades, todas as etiquetas, fotos e observações são enviadas no mesmo atendimento e passam por uma única conferência. Uma transação de estoque instala todos os aparelhos e seu recibo confirma também os registros financeiros internos, um por equipamento. Registros antigos mantêm a rastreabilidade do fluxo anterior. Se um adicional for reatribuído, o ZenField mostra apenas os registros do técnico selecionado.

O campo **Termo** foi retirado do formulário e das respostas públicas da OS. O histórico legado permanece no banco e nos backups. As **Observações da central** ficam separadas das **Observações do técnico**, que são obrigatórias para finalizar a execução e enviar para conferência no ZenField. A central consulta o relato no retorno técnico, sem editar o original.

A OS mostra responsáveis pela abertura, baixa e última modificação, usando o nome de exibição do usuário. O histórico reúne eventos da OS, evidências e adicionais. As edições da central registram os valores anteriores e novos; a supervisão no ZenField mantém a identidade real do administrador/operador e o técnico selecionado. Eventos novos guardam também o identificador e login para manter rastreabilidade. Autoria antiga desconhecida é explicitada como legado.

A migração `009_equipment_quantities.sql` permite múltiplos adicionais do mesmo tipo sem alterar OS, fotos, recibos ou valores históricos. Ela deve publicar a API e os dois frontends juntos na homologação. Validação: `npm test --workspace apps/api`, builds dos dois frontends e `ZEN_CHROMIUM_PATH=/caminho/chromium node scripts/order-management-ui.cjs` após `npm run homologation:build`.


## Cadastro e PDF único do atendimento

- O formulário de agendamento oferece **Instalação, Manutenção e Retirada**. Instalação permite marcar **Reinstalação**, com ou sem reaproveitamento. Registros antigos de outros tipos continuam legíveis.
- **Visita improdutiva** preserva o serviço previsto e usa a tarifa cadastrada de improdutiva, sem instalação ou adicionais de equipamento. **Reagendamento** mantém a OS em REAGENDAR, sem permitir finalizar/enviar execução até a central confirmar a nova data e retirar a sinalização.
- Instalações começam com **1 rastreador e 0 TAGs**. Os dois campos de quantidade aceitam até 20 aparelhos no total; 2 rastreadores e 2 TAGs significam 1 serviço base + 3 adicionais. As tarifas do técnico definem os valores; não há preço inventado por equipamento.
- Cada unidade adicional tem um registro interno de serviço/financeiro. O técnico fotografa todos os equipamentos na mesma OS, anexa um checklist e envia uma única vez. A central aprova uma vez, e o Estoque Pro confirma todos os seriais atomicamente, sem duplicar movimentos.
- O PDF da OS principal ou de um adicional reúne o atendimento completo, sob o identificador principal. Quantidades, endereço, contato, serviço e data saem no mesmo documento; não são gerados PDFs separados por equipamento. O acesso do técnico continua restrito ao seu atendimento.
- Endereço do associado: **Logradouro, Número, Bloco, Complemento, Bairro, Município e Estado**. O atendimento usa esse endereço por padrão; desmarcar a opção abre os mesmos campos para outro local. Endereços legados não são divididos por suposição e permanecem disponíveis para conferência.
- O contato recebe a máscara **(xx)xxxxx-xxxx**; números fixos de dez dígitos também são formatados. A informação sobre levar equipamentos foi retirada do formulário e do PDF: o transporte pelo técnico é implícito.

No reaproveitamento, a identificação da foto consulta apenas os códigos lidos entre aparelhos já instalados. A central confirma explicitamente que são os equipamentos reaproveitados naquele veículo. O estoque registra o evento de reinstalação e um recibo idempotente, sem consumir novamente a carga ou gerar outra movimentação de uso final. Sem reaproveitamento, os aparelhos precisam estar disponíveis na carga, como numa instalação normal.

O adicional de instalação de bloqueio fica previsto para uma etapa futura.
