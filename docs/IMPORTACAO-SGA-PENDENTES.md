# Instalações pendentes do SGA

O SGA tem uma entrada própria no menu **Importação**, ao lado da planilha de controle. O administrador escolhe a classificação/situação **Instalação pendente** no catálogo atual e um horário diário em Brasília. A ativação salva autoriza as próximas coletas. O padrão é desativado; não se presume um código antigo nem se ativa um horário sem configuração do administrador.

A coleta consulta o histórico de mudanças do próprio dia e aceita somente transições do campo configurado para o código escolhido. A data de cadastro, contrato ou de outra alteração não substitui a data dessa transição. O veículo também precisa continuar na classificação/situação pendente ao ser consultado. A paginação do histórico usa páginas 0, 1, 2, conforme a documentação; não confundir com o OFFSET de `listar/veiculo`.

Os cadastros recebidos aparecem em **Ordens de serviço → Instalações pendentes do SGA**, disponíveis para revisão pela operação. Cada entrada preserva o conteúdo original da movimentação, do veículo e dos produtos recebidos, inclusive campos ainda não mapeados. Credenciais e tokens não fazem parte do arquivo operacional. Falha de consulta de produtos é indicada como não confirmada, sem presumir ausência de Perfurado.

Não há número de OS, reserva de sequência, técnico, pagamento, movimentação de estoque ou mensagem externa nesta fase. A chave do veículo no SGA impede repetição; a combinação de associado normalizado e veículo também impede duplicação da entrada. Cadastros já presentes nas OS são ignorados por código SGA ou por associado/veículo. As consultas seguintes não sobrescrevem a entrada original nem os dados locais.

Ao **Revisar e atribuir**, a operação escolhe técnico, data/hora e base HOT/WARM/COLD. Confirma também a opção pelo desconto do adesivo. O servidor consulta novamente a situação do associado, veículo e financeiro, confere a identidade e a permanência na etapa pendente. Uma situação não confirmada ou restritiva impede a atribuição. Somente após a validação é criada a OS, na transação que vincula a entrada à OS. Duas confirmações simultâneas retornam a mesma OS; não consomem dois números. A numeração usa o dia da atribuição em Brasília, não a data da coleta. O conteúdo original continua disponível na origem da OS.

## Produtos vinculados

Consulta documentada: `GET /produto-vinculado-veiculo/listar/:codigoOuPlaca`. A resposta precisa corresponder ao código do veículo pesquisado. A tela lista produtos normais e adicionais com nome, código e situação. **Perfurado 2371** é confirmado somente se for um produto normal ativo; produto inativo, código de produto adicional homônimo ou consulta indisponível não comprovam adesão ativa. Esta consulta não contrata produtos, altera valores ou calcula o desconto no SGA.

O resumo dos produtos acompanha a comprovação assinada da consulta SGA, para continuar visível depois de salvar a OS. A informação histórica recebida na fila é identificada pela data da consulta; atribuir o atendimento exige verificação atual.

## Execução e disponibilidade

- Migration: `021_sga_intake.sql`.
- Servidor: credenciais SGA já configuradas, `SGA_READ_ENABLED=true` e processo de worker ativo (`ZEN_RUN_WORKER=true` no servidor comum, ou `node apps/api/worker.js` em processo dedicado). A homologação integrada inicia seu worker automaticamente.
- O agendador verifica a configuração a cada 30 segundos em um ciclo separado das confirmações do estoque. O horário é `America/Sao_Paulo`. A fila e a configuração são persistidas no PostgreSQL. Existe uma execução automática por dia, retomada com segurança após falha, sem duplicar entradas recebidas.
- Registros que mudarem depois do horário configurado podem ser buscados pela coleta manual do mesmo dia. Uma tarefa não executada até o fim de sua data é encerrada, sem importar outro dia silenciosamente.
- Falhas são exibidas no histórico e podem ter até três tentativas, espaçadas em dez minutos. A coleta manual pode ser iniciada novamente pelo administrador. A coleta não usa as permissões de escrita do SGA.
- Um serviço suspenso/adormecido não executa timers. Para respeitar o horário sem usuários conectados, o backend e o worker precisam de hospedagem continuamente ativa. Não há garantia de pontualidade em instância gratuita que suspende por inatividade. Nenhum plano pago é contratado por esta mudança.
- Backup inclui configuração, execuções e entradas. Backups antigos continuam aceitos. Ao restaurar, a coleta automática fica desativada e tarefas em andamento exigem revisão, evitando consultas inesperadas. A configuração precisa ser reativada pelo administrador.

Fonte do contrato da API: documentação oficial Hinova SGA v2, `https://api.hinova.com.br/api/sga/v2/doc/` (entradas `Produto/Listar_produtos_vinculados` e `Veiculo/Listar_Altera__o_Ve_culo`, consultadas em 16/11/2026). Os testes usam respostas sintéticas conforme os contratos; a disponibilidade do histórico de classificação na associação depende da permissão da credencial SGA.
