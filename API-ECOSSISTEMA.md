# API do ecossistema — ZenControl 6.4

Todas as rotas são JSON, exceto downloads de documentos. O prefixo abaixo é `/api`. Autenticação é `Authorization: Bearer <token>`. Senhas, códigos, tokens e segredos nunca devem aparecer em logs ou no frontend compilado. `VITE_API_URL` é pública e contém somente a URL da API.

## Compatibilidade e permissões

- ZenField 1.1 requer `api_version >= 6.4` na sessão/login. Backend anterior exibe aviso de atualização e não abre dados incompletos.
- `admin`: cadastros de acesso, emissão de ativação, tarifas, políticas, decisões financeiras, fechamentos e pagamentos.
- `operador`: OS, agenda e conferência de evidências; não aprova tarifas/pagamentos.
- `tecnico`: somente seu vínculo ativo e suas OS, evidências, estoque, financeiro e solicitações. IDs de outros técnicos são recusados pelo backend.
- Tokens expiram em oito horas; mudança de senha/ativação e desativação invalidam sessões por versão no banco. Desativar o técnico também bloqueia imediatamente suas contas vinculadas.
- Login e ativação têm limite de tentativas. A senha definitiva usa scrypt com salt individual.

## Acesso e ativação

| Método/rota                        | Permissão         | Entrada/saída                                                                                                    |
| ---------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /auth/session`                | Pública           | `authenticated`, `user`, `api_version`                                                                           |
| `POST /auth/login`                 | Pública, limitada | `login,password,audience` (`central`/`technician`); retorna token, vencimento e versão                           |
| `POST /auth/activate`              | Pública, limitada | `login,password:"zen123",code,new_password`; consome código, troca hash e revoga sessões; não retorna token      |
| `POST /technicians`                | Admin             | Cadastro existente; agora retorna `id,access:{login,code,expires_at,temporary_password}` para entrega individual |
| `POST /technicians/:id/activation` | Admin             | Emite/renova código da conta vinculada; revoga sessões. Código só aparece nessa resposta                         |
| `POST /auth/password`              | Autenticada       | `current_password,new_password`; nova senha entre 12 e 128 caracteres; requer novo login                         |

Login automático: primeiro nome + último sobrenome normalizados, minúsculos, sem acentos, separados por ponto; sufixo numérico resolve colisões. A geração acontece na mesma transação do cadastro. O banco armazena somente hash do código, vencimento e consumo. `zen123` não corresponde ao hash aleatório inicial e não libera sessão. A ativação é válida por 24 horas.

## Notificações persistentes

| Rota                                 | Comportamento                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `GET /notifications?page=1&limit=30` | Caixa autorizada, limite máximo 100, `items,unread,page,limit`                      |
| `POST /notifications/:id/read`       | Idempotente; leitura individual por usuário; alerta de outra conta/área retorna 404 |

Cada evento tem chave única. Criação/alteração de OS, envio, correção, aprovação, conclusão, solicitação, fechamento e pagamento persistem dentro da transação de negócio. Eventos de carga usam o identificador durável da movimentação oficial e são incorporados quando o histórico é consultado. Uma pessoa ler um alerta da central não marca como lido para os demais operadores.

O frontend consulta ao abrir/focar e a cada 60 s quando visível. Não há WebSocket, serviço de mensagens ou push pago. Um processo suspenso não gera consultas; os eventos persistem para a próxima abertura.

## Operação e evidências

As APIs de OS e conferência existentes são preservadas. OS novas são sempre `workflow_mode=controlled`. Informar `legacy` na criação não contorna a conferência.

| Rota                                  | Entrada/saída principal                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /technician/me`                  | Vínculo ativo, nome e usuário                                                                                                      |
| `GET /technician/orders`              | `q` (OS), `vehicle`, `service`, `status`, `from`, `to`, `view=open/closed`, `page`, `limit<=100`; retorna `items,total,page,limit` |
| `GET /technician/orders/:id`          | OS autorizada, documento, regra e histórico de envios                                                                              |
| `GET /technician/orders/:id/pdf`      | PDF da OS, preservando os limites de exposição do portal                                                                           |
| `POST /technician/orders/:id/draft`   | `version` da OS; cria/recupera rascunho                                                                                            |
| `POST /technician/batches/:id/photos` | `version,kind,image` em data URL; normalização, leitura de etiqueta e validação no servidor                                        |
| `PATCH /technician/batches/:id`       | `version,serials,notes,checklist_signed,executed_on`; salva rascunho                                                               |
| `POST /technician/orders/:id/finish`  | `version,executed_on`; registra etapa de execução finalizada e composição estimada                                                 |
| `POST /technician/batches/:id/submit` | `version,serials,notes,confirmed:true,checklist_signed:true,executed_on`; valida evidências e gera conferência/avisos              |
| `POST /orders/:id/conference`         | Central; registra início da conferência sem concluir a OS                                                                          |
| `POST /batches/:id/reject`            | Central; `version,reason`; solicita correção                                                                                       |
| `POST /batches/:id/approve`           | Central; `version,order_version,reason,serials,checklist_reviewed:true`; exige confirmação de todos os itens                       |
| `GET /technician/evidence/:id`        | Mídia privada somente do vínculo proprietário                                                                                      |

Datas civis usam `AAAA-MM-DD`, sem conversão pelo fuso do computador do técnico. Execução futura é recusada. Para compatibilidade de envios antigos, a data ausente usa a registrada no rascunho/OS ou o dia local do servidor.

Fotos aceitam JPEG/PNG/WebP, são decodificadas/normalizadas e têm limites de bytes/pixels. Checklist aceita PDF até 8 MB/30 páginas ou imagens. A leitura de QR/barcode ocorre com ZXing WASM empacotado; não chama API de IA. Tipo/modelo/serial são conferidos com a carga oficial. Não se aceita substituir uma foto ilegível por um IMEI digitado em capturas novas.

Etapas: Pendente → Agendado → Em execução → Execução finalizada → Aguardando conferência → Correção solicitada ou aprovação → Aguardando estoque (instalações) → Concluído. Cancelamento é explícito. `executed_on`, `execution_finished_at`, `conference_started_at`, `submitted_at`, `reviewed_at` e `completed_at` preservam os momentos distintos. Serviços sem instalação podem concluir após a conferência; instalações exigem recibo oficial.

`POST /orders/:id/dispatch` em OS controlada apenas reafirma a notificação interna, sem job de WhatsApp. A interface remove esse botão de novos serviços. Webhooks antigos só associam evidências a OS `legacy`; históricos existentes não são apagados. Hinova/SGA permanece independente.

## Carga e histórico

| Rota                                   | Contrato                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /technician/stock`                | Carga oficial, vínculo e associação com rascunhos/envios; situação disponível/reservado na OS/pendente de conferência |
| `GET /technician/stock/history?page=1` | Página de 50 movimentos do próprio técnico, serial/modelo/categoria/situação e OS da instalação                       |

Reserva na OS é uma associação do ZenControl, não uma reserva transacional no inventário. A disponibilidade final é revalidada na confirmação da instalação. Duplicar a intenção não duplica a baixa: um segundo serviço que perdeu a disponibilidade é recusado pelo Estoque Pro.

## Solicitações e decisões

`POST /technician/requests` exige `kind`, `reason`, `request_key` única (12–160 caracteres), `proposed` e, para contestação, `order_id` próprio.

```json
{
  "kind": "rate",
  "request_key": "uuid-da-tentativa-logica",
  "reason": "Justificativa do técnico",
  "proposed": {
    "effective_on": "2026-12-01",
    "prices": {
      "Instalação": 9000,
      "Reinstalação": 9000,
      "Manutenção": 6000,
      "Retirada": 4500,
      "Visita": 3000,
      "Improdutiva": 3000
    }
  }
}
```

Todos os valores numéricos financeiros são **centavos inteiros**. As seis tarifas são obrigatórias e não negativas.

- `kind=dispute`: `order_id`, `proposed:{amount_cents:1500}`; ajuste pode ser negativo, com justificativa. A aprovação registra lançamento auditado, sem trocar a tabela permanente.
- `kind=stock`: `proposed:{action,quantity,model,serials,destination}`. `action`: `replenishment`, `receipt`, `return` ou `transfer`. Registra solicitação; não modifica inventário.
- `GET /technician/requests`: próprias, até 200 recentes.
- `GET /requests?state=pending`: central, até 200 recentes.
- `POST /requests/:id/decision`: admin; `version,action,reason`; `action=approve/reject/information/counteroffer`. Contraproposta exige `proposed` de tarifas e só existe para reajuste.
- `POST /technician/requests/:id/respond`: proprietário; `version,action,reason`; `accept/decline` para contraproposta ou `resubmit` com informações adicionais. O aceite cria a versão autorizada nesse momento.

Uma decisão usa comparação de versão e histórico append-only no fluxo da aplicação. Repetir chave de criação retorna a solicitação anterior somente com dados equivalentes. Decisão de outro técnico ou versão ultrapassada é recusada.

## Tarifas e políticas

| Rota                                     | Permissão/contrato                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /technician/rates`                  | Próprias versões com vigências                                                  |
| `GET /finance-v2/technicians/:id/rates`  | Admin; versões do técnico                                                       |
| `POST /finance-v2/technicians/:id/rates` | Admin; `effective_on,prices`; cria versão, não reprifica lançamentos existentes |
| `PUT /finance-v2/technicians/:id/policy` | Admin; `version,policy`                                                         |
| `GET /finance-v2/holidays`               | Admin; feriados cadastrados                                                     |
| `PUT /finance-v2/holidays/:day`          | Admin; `{name}` e data civil válida                                             |

Exemplo de política:

```json
{
  "version": 0,
  "policy": {
    "unit": "days",
    "every": 14,
    "anchor": "2026-10-01",
    "cut_day": 31,
    "days": [15, 31],
    "due_days": 2,
    "business_days": false,
    "due_business_days": true
  }
}
```

`unit=days/weeks/months/twice_monthly`. `every` define o intervalo; `cut_day` vale para meses, `days` para dois cortes mensais. Dias úteis no ciclo só afetam `days`; semanas são intervalos civis de sete dias. O primeiro bloco de N meses começa na referência e termina no corte do N-ésimo mês elegível. Dia além do fim do mês é ajustado ao último dia. Datas de referência anteriores ao período são necessárias. Feriados são fornecidos pela operação, não presumidos.

O ledger guarda tarifa/versão, data, extras e total na primeira finalização/envio. Confirmação oficial grava `eligible_on`. Edições financeiras posteriores exigem ajuste auditado. Alterar técnico/serviço com composição existente é recusado; preserve a execução e crie outra OS. Cancelamento/reabertura alteram a elegibilidade, sem apagar a composição original. OS com recibo de instalação exigem o fluxo de estorno no Estoque Pro e um novo atendimento, não reabertura silenciosa.

## Fechamentos e pagamentos

| Rota                                                 | Contrato                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /technician/finance`                            | Ciclo atual/próximo, estimado, conferido, ledger, ajustes, fechamentos/pagamentos e saldo próprios                                        |
| `GET /finance-v2/technicians/:id`                    | Admin; mesmo demonstrativo do técnico                                                                                                     |
| `GET /finance-v2/preview?technician_id=&start=&end=` | Admin; composição e `preview_hash`                                                                                                        |
| `POST /finance-v2/closings`                          | Admin; `technician_id,start,end,preview_hash,request_key`; extraordinário exige `extraordinary:true,reason`; vencimento opcional `due_on` |
| `POST /finance-v2/closings/:id/approve`              | Admin; aprova composição congelada                                                                                                        |
| `POST /finance-v2/closings/:id/payments`             | Admin; registra pagamento externo                                                                                                         |
| `GET /finance-v2/closings/:id/pdf`                   | Admin ou proprietário; PDF                                                                                                                |
| `GET /finance-v2/closings/:id/export`                | Admin ou proprietário; JSON do snapshot                                                                                                   |
| `GET /payments/:id/receipt`                          | Admin ou proprietário; download privado                                                                                                   |
| `GET /finance-v2/reconcile`                          | Admin; excessos de pagamento, OS concluídas sem ledger e fila de estoque pendente                                                         |

A prévia inclui serviços oficialmente concluídos, executados até o fim, confirmados até o fim e ainda não incluídos em fechamento. Execuções antigas aprovadas depois entram no próximo período elegível com data/competência original. `zc_settlement_orders.order_id` é único: uma OS não entra em dois fechamentos. Ajuste de OS já fechada entra como lançamento separado, ligado ao original.

Fechamento: `draft` → `awaiting_payment` → `partial` → `paid`. Fechamentos legados `approved` continuam aceitos para registro externo. Snapshot não é alterado pelo fluxo de pagamentos. A API recusa fechamento futuro e exige alinhamento à política ou justificativa extraordinária; recalcula/verifica o hash antes de persistir.

```json
{
  "amount_cents": 4500,
  "paid_on": "2026-10-16",
  "reference": "SIMULADO-EXTERNO-001",
  "request_key": "uuid-da-tentativa-logica",
  "receipt": "data:application/pdf;base64,..."
}
```

Comprovante é opcional, PDF/imagem até 4 MB, privado e incluído no backup. Data futura, saldo excedido, referência duplicada no mesmo fechamento ou chave reutilizada com dados divergentes são recusados. **Não existe integração bancária nem execução de Pix.**

## Estoque Pro — contrato entre servidores

Prefixo oficial: `/api/integrations/zencontrol`. Bearer usa `ZENCONTROL_INTEGRATION_SECRET` do estoque, igual a `STOCK_API_SECRET` do ZenControl, com pelo menos 32 caracteres. O navegador nunca recebe essa chave.

| Endpoint                              | Função                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| `GET /catalog`                        | Técnicos ativos e modelos                                          |
| `GET /technicians/:id/items`          | Carga disponível individual, categoria/modelo/status/data          |
| `GET /technicians/:id/history?page=1` | Novo: eventos da carga, 50 por página, OS por recibo de instalação |
| `POST /installations`                 | PR #4; exige `Idempotency-Key` e payload de instalação             |

Instalação recebe `source_system,order_id,submission_id,technician_id,serials,operator`. Confere todo o lote na carga correta, executa a regra oficial de instalação, grava recibo e movimento na mesma transação. Repetição com identidade/dados iguais devolve o recibo; outra chave para a mesma origem/OS ou dados diferentes retorna 409. O ZenControl valida integralmente o recibo antes da conclusão.

Sem contratos automáticos para reposição/recebimento/devolução/transferência: solicitações seguem o procedimento humano do Estoque Pro. Não adicionar caminhos alternativos de escrita de saldo no ZenField.

## Falhas, armazenamento e variáveis

- `GET /healthz` retorna 200/503. Logs de erros centrais usam evento/método/código, sem payload/senhas.
- Operações financeiras e notificações usam transações. A fila de estoque tem retries controlados, chave estável e estados persistentes. Suspender o processo adia as tarefas; não há garantia de execução contínua em free tier.
- Uploads perdidos exigem consultar o rascunho antes de repetir. Uploads falhos não se tornam evidências prontas. Arquivos sem referência após falha de transação não liberam serviço nem pagamento; a coleta de órfãos remotos permanece uma melhoria futura.
- `DATABASE_URL`, `DATABASE_SSL`, `APP_PASSWORD`, `SESSION_SECRET`, `ZEN_WEBHOOK_SECRET`, `ZEN_DATA_DIR`, `ZEN_PUBLIC_URL`, `TECHNICIAN_PORTAL_URL`, `CORS_ORIGINS`, `STOCK_ENABLED`, `STOCK_API_URL`, `STOCK_API_SECRET`, `STOCK_SOURCE_SYSTEM` são variáveis do backend. `VITE_API_URL` é variável pública de build dos frontends.
- O inicializador local gera/define esses valores internamente e recusa URLs externas de banco. Mídia usa disco local próprio. Para produção futura, seguir a configuração existente de Supabase privado e conferir cotas, sem depender do disco efêmero do Render.
- HTTP só é permitido nas origens locais explicitamente admitidas pela configuração. Conexões entre servidores online devem usar HTTPS.

Fechamentos existentes antes da migração recebem `legacy_unverified`: não são presumidos como dívida nem como pagos. Conferir o histórico antes de aprovar/importar os pagamentos externos; esses totais ficam separados do saldo confirmado.

Fechamento autorizado de valor zero termina como `no_payment_due` (sem valor a pagar), sem criar transferência fictícia. Resumos financeiros agregam toda a conta, independentemente do limite de itens exibidos, separam fechamentos em conferência e incluem ajustes aprovados pendentes. A API antiga de fechamento permanece apenas para OS legadas; OS controlada exige o fluxo Financeiro 6.4.
