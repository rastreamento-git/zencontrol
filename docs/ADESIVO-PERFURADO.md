# Adesivo Perfurado — produto SGA 2371

A operação registra na OS a opção do cliente pelo desconto do adesivo. Essa opção é uma sinalização, sem cálculo de valor ou percentual. O código 2371 identifica o produto de referência; a ação não altera contratação ou produtos no SGA.

No ZenControl, marque **Cliente optou pelo desconto do adesivo Perfurado (produto SGA 2371)** na OS principal e atribua o técnico. O técnico recebe a instrução de aplicar uma unidade no ZenField e no PDF da OS. A opção integra o registro do atendimento. Equipamentos adicionais não duplicam o consumo do adesivo.

No Estoque Pro, a seção **Adesivos Perfurados** controla quantidades sem serial/IMEI: recebimento na matriz, entrega ao técnico e devolução. O saldo inicial é zero. Não se criam unidades fictícias. Há histórico de movimentações com responsável, quantidade e OS quando aplicada. A carga do técnico no ZenField também apresenta o saldo disponível.

A baixa de uma unidade ocorre apenas na confirmação do atendimento pela central, na mesma transação do recibo do estoque. Repetir a confirmação não duplica a baixa. Se faltar adesivo, a confirmação fica aguardando regularização da carga: nenhum rastreador é instalado parcialmente no estoque. Após a reposição, a integração pode ser repetida com a mesma chave. A opção também pode acompanhar manutenção e dispensa de rastreador; não depende de um IMEI para o adesivo e não cria uma remuneração adicional.

Implantação: migration `020_sga_eligibility_sticker.sql` no ZenControl e `006_adesivos.sql` no Estoque Pro. Publicar o backend do estoque usado pelo ambiente, os frontends ZenControl/Estoque Pro/ZenField e o backend central de forma coordenada. A cópia do adaptador em `integrations/estoque-pro` usa as mesmas regras do repositório `inventario-v2`.

Backup do estoque inclui `adesivo_saldos` e `adesivo_movimentos`; backups anteriores continuam aceitos. Os resets administrativos abrangem esses saldos e movimentos dentro das confirmações e backups já exigidos pelo painel.
