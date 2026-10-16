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
