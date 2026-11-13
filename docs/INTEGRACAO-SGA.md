# Integração SGA Hinova

A importação de planilhas pode completar os cadastros consultando o SGA v2. A consulta ocorre em segundo plano após o administrador escolher abas, base e gerar a revisão. A aprovação fica bloqueada enquanto essa consulta estiver em andamento; o administrador confere a prévia final e confirma uma vez.

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

Os PDFs são referências históricas. A aplicação consulta classificações, situações, marcas, cores, tipos de veículo e tipos de foto pela API, com cache de 15 minutos e atualização manual. Falha parcial de catálogo é sinalizada; não assume o significado antigo de um código sem descrição atual.

O arquivo chamado “lista produtos” fornecido contém tipos de veículo. Produtos comerciais exigem filtros próprios de regional, cooperativa, tipo, FIPE e cilindrada; não são tratados como o catálogo de tipos de veículo.

Alterações externas existentes continuam exigindo `INTEGRATIONS_ENABLED=true` e os respectivos controles do fluxo (`SGA_SYNC_ENABLED`, quando aplicável). Os mapeamentos `SGA_SCHEDULED_CODE`, `SGA_COMPLETED_CODE` e `SGA_PHOTO_TYPE_CODE` precisam ser configurados explicitamente usando códigos ativos consultados no SGA. Não há mais valores numéricos antigos presumidos por padrão.

## Verificação

A suíte cobre preenchimento assíncrono com API SGA simulada, aprovação bloqueada durante consulta, origem preservada, códigos dinâmicos, divergência de associado, troca de modo, correspondência ambígua e bloqueio de escrita externa em modo consulta. A validação contra a associação real depende das credenciais configuradas no servidor.
