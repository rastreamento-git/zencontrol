# Regras de negócio · ZenControl 6

## Autoridade e estados

| Evento | Autoridade | Resultado |
| --- | --- | --- |
| Criar e atribuir OS | Central | Pendente/agendado; fluxo integrado obrigatório |
| Abrir registro | Técnico responsável | Em execução; rascunho vinculado à versão da OS |
| Enviar fotos, códigos e relato | Técnico responsável | Aguardando validação; evidências imutáveis para o técnico |
| Solicitar correção | Central | Correção solicitada, com motivo; novo envio do técnico |
| Aprovar instalação | Central | Aguardando estoque; tarefa com dados aprovados e chave estável |
| Confirmar instalação | API do Estoque Pro | Recibo persistido, OS concluída, elegível ao financeiro |
| Aprovar outro serviço | Central | OS concluída; sem criar instalação |
| Recusar instalação | Estoque Pro | OS continua aberta; erro e envio preservados para correção |

O perfil Técnico não acessa gestão, financeiro, contas, aprovação ou estoque de outro técnico. Desativação ou mudança de perfil revoga sessões anteriores. O vínculo usa IDs explícitos, sem comparação aproximada de nomes.

O rascunho referencia uma versão da OS. Mudanças de veículo, serviço ou atribuição exigem revisão dos dados e novo rascunho. Retornos submetidos e instalações pendentes bloqueiam alterações da OS até a conferência/correção. Aprovação também exige as versões atuais do envio e da OS.

## Evidências

| Serviço | Fotos iniciais | Equipamentos |
| --- | --- | --- |
| Instalação / reinstalação | Placa/chassi, etiqueta, equipamento instalado | Pelo menos um IMEI/serial e etiqueta associada a cada código |
| Manutenção / retirada | Placa/chassi e serviço realizado | Não gera instalação automática |
| Visita / improdutiva | Placa/chassi e evidência do atendimento | Não gera instalação automática |

As quantidades e tipos de foto são configuráveis pela administração, com até 30 fotos por serviço. A foto da etiqueta permanece obrigatória em instalações. Esses valores são a configuração inicial da nova plataforma; ajustes operacionais devem ser feitos em Configurações.

Leitura usa o mesmo componente, scanner, confirmação de quadros e worker ZXing do inventário. Código detectado precisa ser conferido por uma pessoa. O domínio preserva zeros iniciais e admite os seriais alfanuméricos já aceitos pelo Estoque Pro. Ler uma etiqueta identifica um candidato; apenas a carga oficial do estoque confirma sua disponibilidade.

Fotos são autenticadas, reprocessadas em JPEG, redimensionadas até 2400 px e têm hash de integridade. A câmera no telefone exige HTTPS em produção e permissão do navegador. A seleção de fotos também está disponível conforme o navegador. Não há fila offline nesta versão: salvar/enviar exige conexão. Um envio com fotos incompletas nunca recebe baixa.

## Estoque e financeiro

Uma instalação aceita no máximo 20 equipamentos. Todos precisam existir, estar ativos/não arquivados em estado `TECNICO`, e pertencer ao técnico da OS. Modelo vem do cadastro de cada serial, não de texto digitado pelo técnico. Produtos diferentes são processados na mesma transação; falha em qualquer item desfaz o lote inteiro.

A aprovação salva a intenção de instalação. A confirmação exige recibo do Estoque Pro com origem, OS, envio, técnico, códigos e chave correspondentes. A baixa no financeiro só considera OS `CONCLUÍDO`. Aprovação pendente ou recusa não libera pagamento.

Instalação já confirmada não pode ser reaberta livremente nem ter seus dados editados. Ajustes posteriores precisam do processo de estorno/triagem do Estoque Pro e de um novo atendimento rastreável. A versão não automatiza devolução, triagem ou substituição de um equipamento já instalado. Para um equipamento novo, use a OS de instalação correspondente após os movimentos de estoque exigidos.

O Estoque Pro continua aceitando suas operações administrativas habituais, que devem seguir o procedimento interno para evitar que a equipe registre manualmente a mesma instalação enquanto o ZenControl aguarda confirmação. O adaptador não procura inferir uma OS a partir de uma baixa manual anterior.

## Histórico e compatibilidade

A base nova é o fluxo padrão e não aceita `workflow_mode` enviado pelo cliente para desativar as regras. Importadores legados opcionais marcam os registros antigos como `legacy`; apenas esse fluxo mantém a compatibilidade histórica de baixa por WhatsApp. O portal usa exclusivamente novas OS controladas.

Registros de auditoria guardam autor, evento, OS/envio, recibo e motivo. Backups operacionais incluem fotos, hashes, regras de serviço, tarefas e recibos, mas não exportam senhas nem contas. Ao restaurar, recrie os vínculos de acesso dos técnicos. Backups e restaurações de ZenControl e Estoque Pro devem ser coordenados: restaurar só um dos lados para um ponto anterior pode exigir conciliação antes de retomar a fila.
