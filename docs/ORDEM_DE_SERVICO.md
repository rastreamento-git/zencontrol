# Documento de ordem de serviço · 6.1

A emissão usa o modelo funcional do gerador independente fornecido como referência, integrado ao cadastro e ao agendamento do ZenControl. O script de referência e suas credenciais não são distribuídos no repositório.

## Conteúdo do PDF

| Bloco | Campos |
| --- | --- |
| Dados do associado | Nome, contato, CPF/CNPJ, RG e endereço do associado |
| Informações do veículo | Placa, Renavam, chassi, marca/modelo, ano, categoria/tipo e FIPE |
| Detalhes do atendimento | Serviço, técnico responsável, data/horário e local do serviço |
| Instruções / observações | Equipamentos previstos, orientação de transporte e relato/instruções da OS |

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

O atendimento permanece em **Em atendimento** enquanto houver uma instalação adicional pendente, mesmo que a OS principal esteja concluída. A OS principal e seus equipamentos adicionais ocupam **uma linha** nas listagens operacionais; busca, paginação e filtros consideram também os adicionais. Os adicionais são acessíveis dentro do atendimento para registrar suas evidências. Cada registro continua com conferência, estoque e composição financeira próprios, permitindo contabilizar cada instalação uma única vez. Se um adicional for reatribuído, o ZenField mostra apenas os registros do técnico selecionado.

O campo **Termo** foi retirado do formulário e das respostas públicas da OS. O histórico legado permanece no banco e nos backups. As **Observações da central** ficam separadas das **Observações do técnico**, que são obrigatórias para finalizar a execução e enviar para conferência no ZenField. A central consulta o relato no retorno técnico, sem editar o original.

A OS mostra responsáveis pela abertura, baixa e última modificação, usando o nome de exibição do usuário. O histórico reúne eventos da OS, evidências e adicionais. As edições da central registram os valores anteriores e novos; a supervisão no ZenField mantém a identidade real do administrador/operador e o técnico selecionado. Eventos novos guardam também o identificador e login para manter rastreabilidade. Autoria antiga desconhecida é explicitada como legado.

Esta atualização usa `document_data`, envios e auditoria já existentes, sem nova migração de estrutura. Ela deve publicar a API e os dois frontends juntos na homologação. Validação: `npm test --workspace apps/api`, builds dos dois frontends e `ZEN_CHROMIUM_PATH=/caminho/chromium node scripts/order-management-ui.cjs` após `npm run homologation:build`.
