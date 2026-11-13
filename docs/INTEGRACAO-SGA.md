# Integração SGA Hinova

A importação de planilhas pode completar os cadastros consultando o SGA v2. A consulta pode ocorrer em segundo plano após o administrador escolher abas, base e gerar a revisão. A opção **Consultar depois, nas ordens de serviço** importa sem chamar o SGA, sinalizando o cadastro pendente para completar na OS. Enquanto consulta, o botão de confirmação informa que aguarda o SGA. O administrador pode aguardar o preenchimento ou usar **Parar consulta SGA e revisar agora** para interromper a tarefa e continuar com os dados já visíveis na prévia. Os resultados da consulta interrompida não são aplicados; a origem da planilha permanece preservada. A importação exige a confirmação posterior do administrador.

## Configuração no servidor

Defina no ambiente da API (Render), nunca no frontend:

| Variável                | Finalidade                                   |
| ----------------------- | -------------------------------------------- |
| `HINOVA_API_URL`        | `https://api.hinova.com.br/api/sga/v2`       |
| `HINOVA_TOKEN_ASSOC`    | Token da associação fornecido pela Hinova    |
| `HINOVA_USER`           | Usuário de integração com acesso de consulta |
| `HINOVA_PASS`           | Senha do usuário de integração               |
| `SGA_READ_ENABLED=true` | Habilita consulta e preenchimento automático |

As variáveis são lidas na inicialização. Publique API e frontend juntos (compatibilidade de importação 9) e execute as migrations, incluindo `018_sga_import_tasks.sql`. A tela Importação mostra a disponibilidade da configuração e permite atualizar os catálogos. Configuração presente não comprova credenciais válidas: confira uma atualização de códigos e uma revisão antes do uso operacional.

O ambiente de homologação encaminha essas variáveis à API, mantendo `INTEGRATIONS_ENABLED=false`. Assim pode consultar o SGA sem ativar mensagens ou alterações externas. Sem configuração, a importação normal continua disponível, com aviso de que o preenchimento SGA não ocorreu.

## Correspondência e preservação

- A busca usa placa ou chassi normalizado e exige correspondência exata. O registro completo é consultado pelo código retornado. Resultados ambíguos ou identificadores divergentes não completam o cadastro.
- O modo padrão preenche campos vazios. Se o nome do associado divergir, não copia documentos e endereço de outra pessoa: registra a divergência para revisão.
- O administrador pode escolher explicitamente usar os dados cadastrais atuais do SGA. As informações substituídas continuam preservadas na origem da importação e na trilha SGA. Trocar de modo e revisar novamente reaplica o preenchimento a partir da origem anterior.
- Campos consultados: associado, telefone, placa/chassi, código SGA, CPF/CNPJ, RG, endereço estruturado, marca, modelo, cor, ano, Renavam, tipo/categoria, voluntário, valor FIPE e classificação/situação cadastral no SGA, conforme disponíveis na resposta.
- Serviço, etapa operacional, técnico, datas, IMEIs/equipamentos e base HOT/WARM/COLD não são decididos pelo SGA. A base continua sendo escolhida pelo administrador.
- A origem integral da planilha permanece preservada. Os registros duplicados são agrupados pelas regras atuais de nome e veículo, após o preenchimento, mantendo equipamentos e procedência.
- O lote guarda progresso e proveniência do preenchimento; a auditoria operacional grava apenas contagens. Consultas interrompidas por reinicialização são sinalizadas; gere uma nova revisão para tentar novamente.
- A consulta não cadastra nem altera veículos no SGA, não envia fotos, não lança pagamentos, não movimenta estoque e não dispara mensagens.

## Códigos atuais

Os PDFs são referências históricas. A aplicação consulta classificações de veículos e associados, situações, marcas, cores, tipos de veículo e tipos de foto pela API, com cache de 15 minutos e atualização manual. Falha parcial de catálogo é sinalizada; não assume o significado antigo de um código sem descrição atual.

O arquivo chamado “lista produtos” fornecido contém tipos de veículo. Produtos comerciais exigem filtros próprios de regional, cooperativa, tipo, FIPE e cilindrada; não são tratados como o catálogo de tipos de veículo.

Alterações externas existentes continuam exigindo `INTEGRATIONS_ENABLED=true` e os respectivos controles do fluxo (`SGA_SYNC_ENABLED`, quando aplicável). Os mapeamentos `SGA_SCHEDULED_CODE`, `SGA_COMPLETED_CODE` e `SGA_PHOTO_TYPE_CODE` precisam ser configurados explicitamente usando códigos ativos consultados no SGA. Não há mais valores numéricos antigos presumidos por padrão.

## Verificação

A suíte cobre preenchimento assíncrono com API SGA simulada, aprovação bloqueada durante consulta, interrupção pelo administrador com confirmação imediata da prévia, cancelamento da requisição em voo e ausência de alterações posteriores do worker, origem preservada, códigos dinâmicos, divergência de associado, troca de modo, correspondência ambígua e bloqueio de escrita externa em modo consulta. No navegador, cobre também progresso lento, atualização automática da prévia após falha transitória e desbloqueio pela interrupção explícita. A validação contra a associação real depende das credenciais configuradas no servidor.

## Situação e bloqueio de agendamento

Com `SGA_SCHEDULING_GUARD=true`, é obrigatória uma consulta correspondente ao veículo e associado, realizada nos últimos 15 minutos, para criar ou alterar um agendamento e para distribuir a OS. O padrão acompanha a ativação explícita de `SGA_READ_ENABLED`; a homologação com consulta ativa exige validação. A opção de adiar a consulta na importação não libera o agendamento.

A API consulta a situação financeira do veículo, a situação do associado por CPF/CNPJ e seu cadastro pelo código, conferindo os identificadores retornados. As classificações usam catálogos atuais. Estados reconhecidos como ativos/regular e financeiro adimplente/regular/em dia permitem o agendamento; inadimplência, inatividade, cancelamento, suspensão, bloqueio ou exclusão impedem a liberação. Resposta ausente, desconhecida ou indisponível mantém a OS pendente, sem presumir regularidade. A conferência dessas informações no navegador não substitui a validação no servidor.

A consulta emite uma comprovação assinada pelo servidor, vinculada ao nome, placa/chassi e horário. A OS guarda o resumo consultado. Informações editadas no navegador não comprovam situação. Trocar nome/veículo invalida a consulta anterior. Novas consultas e reagendamentos reavaliam as restrições. O rascunho pode ser salvo mesmo com restrição, para regularização.

OS abertas importadas com agendamento não validado são gravadas como pendentes. A data original fica em `proposed_scheduled_at`, visível como proposta; o conteúdo original continua preservado. Concluídos históricos mantêm sua etapa. API e telas apresentam classificação/situação do veículo, classificação/situação do associado e regularidade financeira.
