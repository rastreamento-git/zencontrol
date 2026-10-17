# Ecossistema Zen — homologação local

ZenControl 6.4 + ZenField 1.1 + Estoque Pro com o adaptador do PR #4 e histórico individual. Esta entrega é para revisão e homologação. Não executar migrações em produção nem fazer merge/deploy sem a autorização correspondente.

## Iniciar os três sistemas

Requisitos: computador com Node.js 24, npm, Git, espaço local para dependências e bancos. Não exige conta de nuvem, cartão, Docker ou serviço adicional. O PostgreSQL WASM (PGlite) executa SQL PostgreSQL real, persiste em disco e serializa as conexões; não representa um servidor PostgreSQL com múltiplas conexões.

Clone os três repositórios lado a lado, na mesma pasta:

```bash
git clone --branch feat/ecossistema-homologacao https://github.com/rastreamento-git/zencontrol.git
git clone --branch feat/ecossistema-homologacao https://github.com/rastreamento-git/zenfield.git
git clone --branch feat/ecossistema-homologacao https://github.com/rastreamento-git/inventario-v2.git
cd zencontrol
npm ci --include=dev
cd ../zenfield
npm ci --include=dev
cd ../inventario-v2/invent-back
npm ci --include=dev
cd ../invent-front
npm ci --include=dev
cd ../../zencontrol
npm run homologation:build
npm run homologation
```

O inicializador recusa `DATABASE_URL`, `TEST_DATABASE_URL` e `NODE_ENV=production`. Use um terminal de desenvolvimento sem essas variáveis. Ele cria **dois bancos locais próprios** e desliga WhatsApp, SGA e qualquer integração bancária. O adaptador de estoque utilizado pelo demonstrador vem do repositório oficial `inventario-v2`, não da cópia de compatibilidade interna.

| Aplicação       | Endereço local        |
| --------------- | --------------------- |
| ZenControl      | http://127.0.0.1:4320 |
| ZenField        | http://127.0.0.1:4319 |
| Estoque Pro     | http://127.0.0.1:4321 |
| API ZenControl  | http://127.0.0.1:4317 |
| API Estoque Pro | http://127.0.0.1:4318 |

O terminal informa a senha fictícia do administrador. O login é `admin` no ZenControl e no Estoque Pro. As credenciais locais geradas ficam em `.homologation/access.json`, protegido e ignorado pelo Git. Não são credenciais produtivas. O primeiro acesso dos técnicos usa login individual, `zen123`, código de ativação e uma nova senha de no mínimo 12 caracteres. Nenhuma senha definitiva de técnico é gravada em texto simples.

Use Ctrl+C para encerrar: o worker termina a tarefa atual, os servidores fecham e os bancos são persistidos. Os dados permanecem ao reiniciar. Não rode dois inicializadores nas mesmas portas. Se uma inicialização for interrompida antes de popular a base, preserve a pasta incompleta com outro nome e inicie uma instância nova; não use comandos de reset em banco remoto.

Para caminhos personalizados: `ZEN_FIELD_REPO` e `ZEN_INVENTORY_REPO` apontam para clones locais. `ZEN_HOMOLOGY_INSTANCE=meu-teste` cria uma pasta independente `.homologation-meu-teste`. Não muda as portas; execute uma instância por vez.

## Base demonstrativa

Somente dados fictícios:

- José da Silva Martins (`jose.martins`), com ciclo semanal e carga de rastreador/TAG.
- Maria de Souza Lima (`maria.lima`), com ciclo de 14 dias e carga separada.
- Instalação agendada por técnico, OS históricas, tarifas iniciais e notificações.
- Um fechamento de José com pagamento parcial **simulado**, para demonstrar saldo e quitação.
- Etiquetas Code128 e QR, imagem de vistoria e checklist PDF de demonstração em `.homologation/fixtures/`.

Os arquivos também podem ser baixados, por exemplo, em http://127.0.0.1:4319/demo-files/rastreador-jose.jpg. O checklist é fictício; não substitui um formulário operacional real. A imagem lisa serve para testar o envio e a rejeição de etiquetas ilegíveis; a conferência humana continua obrigatória.

## Roteiro de aceite A–J

### A — Cadastro e primeiro acesso

1. Entre no ZenControl como administrador, abra **Equipe técnica** e cadastre José da Silva Martins, ou use o José já populado.
2. Um cadastro novo devolve login e ativação. Para um existente, use **Gerar código de acesso ZenField**. A emissão revoga as sessões desse usuário e expira em 24 horas.
3. Abra o ZenField. A senha `zen123` sozinha deve falhar.
4. Marque **Primeiro acesso ou redefinição**, informe login, senha provisória, código e nova senha com pelo menos 12 caracteres.
5. Entre com a nova senha. Reutilizar o código deve falhar.
6. Entre como Maria e confirme que OS, evidências, estoque, solicitações e demonstrativos de José não aparecem. As APIs também recusam IDs de outro técnico.

### B — Distribuição interna

1. Crie uma instalação no ZenControl e selecione técnico, veículo, associado e agendamento fictícios.
2. Abra o ZenField: o sino deve mostrar **Nova ordem de serviço** e a lista deve mostrar a OS.
3. Altere o agendamento: um novo aviso deve aparecer. Cancele outra OS de teste e verifique o aviso de cancelamento.
4. Não há botão de despacho por WhatsApp em OS novas. A atribuição no cadastro já distribui o serviço.

### C — Execução, envio e conferência

1. No ZenField, abra **Meus serviços**, filtre por veículo/OS/data/tipo/situação e selecione a instalação.
2. Abra a OS/PDF, confira os dados e toque em **Começar registro**.
3. Envie fotos do veículo, instalação e vistoria. Tente usar a imagem de vistoria como etiqueta: deve ser recusada como ilegível, sem liberar IMEI digitado manualmente.
4. Envie `rastreador-jose.jpg` para José ou `rastreador-maria.jpg` para Maria. O servidor reconhece Code128/QR e confere o serial na carga correta. Etiqueta de outro técnico é recusada.
5. Para uma OS com TAG, marque o equipamento exigido na criação e use a etiqueta QR correspondente. OS que exigem dois tipos precisam de ambos.
6. Anexe `checklist-ficticio.pdf`, confirme preenchimento/assinatura, informe a data efetiva e observações. **Salvar rascunho** permite retomar.
7. **Registrar execução finalizada** registra essa etapa separadamente. **Enviar e aguardar confirmação** muda para **Aguardando conferência**, sem concluir o serviço.
8. Na central, o sino mostra **Novo serviço aguardando conferência** com OS/técnico/serviço. Em **Validações**, abra fotos e checklist.
9. Solicite correção em uma OS de teste e verifique o aviso no ZenField; o técnico inicia outro rascunho. Em outra, confirme os itens de conferência e aprove.

### D — Confirmação de estoque

1. Após a aprovação da instalação, verifique **Aguardando estoque**.
2. O worker local envia a instalação ao Estoque Pro com chave idempotente. O estoque valida todos os seriais na carga, grava movimento/recibo na mesma transação e responde.
3. Somente após conferir o recibo o ZenControl conclui a OS e libera a remuneração como conferida.
4. No Estoque Pro, consulte o serial: deve estar instalado, com um único movimento de uso final. No ZenField, a carga diminui e o histórico mostra a OS.
5. Em **Meu estoque**, solicite reposição, recebimento, devolução ou transferência. A central pode decidir a solicitação. **Aprovar a solicitação não movimenta o inventário**: esses quatro contratos de escrita não existem no PR #4. O operador registra a movimentação pelos fluxos oficiais do Estoque Pro e confere o resultado no histórico. Não há ajuste direto de saldo pelo técnico.

### E/F — Ciclos e fechamento

1. Na central, abra **Financeiro**, selecione José e confira valores estimados, conferidos e saldo.
2. Em **Política de fechamento e tarifas**, configure a referência, unidade, intervalo, dias de corte e vencimento. José semanal e Maria a cada 14 dias já estão populados.
3. Ciclos em dias aceitam 10, 14 ou N dias; semanas aceitam N semanas; meses aceitam N meses; duas vezes por mês usa dois cortes fixos. Dias úteis opcionais aplicam-se aos ciclos em dias e ao vencimento. Cadastre feriados explicitamente; não há consulta paga nem calendário nacional presumido.
4. Os intervalos incluem início/fim e usam datas civis em America/Sao_Paulo. Cortes 29–31 são limitados ao último dia do mês. Em N meses, a referência inicia o primeiro bloco de N meses. Períodos anteriores à referência são recusados.
5. Gere a prévia de um período encerrado. Para demonstrar a instalação executada hoje antes do fim da semana, marque **Fechamento extraordinário autorizado** e preencha a justificativa.
6. Confira OS, tarifas, extras, ajustes e competência anterior. Crie o fechamento, que começa **Em conferência**, e depois **Aprove o fechamento**. A composição fica preservada.
7. Baixe PDF e exportação JSON. O cadastro original de fechamentos legados permanece disponível nas APIs antigas; a nova interface usa o fluxo com aprovação e pagamentos.

### G — Reajuste e contraproposta

1. No ZenField, em **Meus valores**, solicite novas tarifas com vigência e justificativa.
2. Na central, um administrador autorizado pode aprovar, rejeitar, pedir informações ou apresentar contraproposta. Operadores comuns não aprovam valores.
3. Uma contraproposta só cria a tarifa após o aceite do técnico. Aceitar com outro usuário ou repetir uma decisão desatualizada deve falhar.
4. A vigência autorizada não pode ser anterior ao dia da autorização. Há uma versão por técnico/data de início. Datas futuras são permitidas.
5. Compare um serviço já registrado antes do reajuste com um novo: o antigo preserva sua composição. O valor é congelado quando a execução finaliza ou é enviada pela primeira vez, com base na data executada. Correções não recalculam silenciosamente.
6. Para uma OS específica, use **Contestar valor de uma OS** no financeiro. A aprovação registra ajuste auditado; se a OS já estiver fechada, ele segue para fechamento seguinte sem alterar o original.

### H — Aprovação tardia

1. Registre uma execução com data de competência anterior e mantenha a conferência pendente.
2. Feche outros serviços daquele período. Aprove a execução atrasada posteriormente.
3. Na prévia de um período elegível atual, confira **Competência anterior** e a data original. A seleção usa execução + confirmação, desconta OS já incluídas e não altera o fechamento antigo.
4. A elegibilidade financeira depende de conclusão oficial; evidência enviada, conferência pendente ou estoque pendente não libera pagamento.

### I — Pagamentos externos simulados

1. Escolha um fechamento aprovado com saldo e use **Registrar pagamento externo**.
2. Informe valor parcial, data, referência única e, opcionalmente, comprovante PDF/foto de até 4 MB.
3. Confira **Pagamento parcial**, histórico e saldo no ZenField.
4. Registre o restante com outra referência fictícia: a situação muda para **Quitado**.
5. Repetir a mesma requisição com a mesma chave retorna o registro anterior. Referência duplicada no mesmo fechamento e valor acima do saldo são recusados.
6. Não há endpoint de Pix, transferência bancária ou envio de dinheiro.

### J — Falhas e recuperação

- Foto ilegível, formato inválido ou carga errada: mensagem compreensível, sem evidência pronta/baixa.
- Resposta de upload perdida: atualize o envio; compare os arquivos persistidos antes de reenviar. Fotos ficam no rascunho do servidor; a seleção ainda não enviada permanece só na memória do navegador.
- Sessão expirada/revogação: acesso recusado, login solicitado. O rascunho já salvo permanece no banco.
- Estoque indisponível/resposta perdida: OS fica pendente, fila persistente repete a mesma chave. Não confirme manualmente como concluída.
- Recusa de carga: confira vínculo e inventário oficial; solicite correção somente depois de resolver tarefas incertas. Use a fila de integrações para tentativas autorizadas.
- Banco indisponível: `/healthz` retorna 503. Transações não são confirmadas parcialmente.
- Financeiro: gere uma nova prévia se a composição mudou. Reutilize a chave nas repetições; pagamentos também possuem identidade externa única por fechamento.
- Reinicie o inicializador e valide a persistência. Faça o teste de backup abaixo antes de aceitar a homologação.

## Testes automatizados

```bash
# ZenControl: API, financeiro, mídia, migrações e adaptador de compatibilidade
npm run check
npm test
npm run homologation:build

# UI móvel e desktop, usando o inicializador oficial e bancos novos por execução
npx playwright install chromium
node scripts/homologation-ui.cjs

# Estoque Pro oficial
cd ../inventario-v2/invent-back
npm run check
npm test
cd ../invent-front
npm run lint
npm test
npm run build

# ZenField
cd ../../zenfield
npm run check
VITE_API_URL=http://127.0.0.1:4317 npm run build
```

O roteiro Playwright inicia uma instância fictícia nova, usa o Estoque Pro oficial, testa ativação, solicitações, fotos, checklist, conferência, recibo, fechamento, pagamento e isolamento de origens. Gera screenshots e `ui-result.json` na pasta `.homologation-ui-*`, ignorada pelo Git. Requer portas livres e os três builds locais. Pode receber `ZEN_CHROMIUM_PATH` para um Chromium instalado; `ZEN_CHROMIUM_MODULE` é um adaptador opcional usado no ambiente de execução desta entrega.

Os testes de API usam PGlite por padrão. Para exercitar múltiplas conexões em **PostgreSQL real local**, opcionalmente:

```bash
docker compose -f compose.homologation.yaml up -d
TEST_DATABASE_URL=postgres://zen_homolog:local-test-only-password@127.0.0.1:5444/zen_homolog npm test
docker compose -f compose.homologation.yaml stop
```

A URL acima é exclusivamente local. Os testes criam/removem schemas aleatórios. Nunca substitua por Aiven/produção. O CI dos PRs também possui PostgreSQL 17. Docker não estava disponível no ambiente local desta implementação; resultados de PGlite e CI devem ser identificados separadamente.

## Backup e recuperação locais

1. Pare o inicializador com Ctrl+C.
2. Execute `node scripts/homologation-backup.cjs backup`. Isso copia **os dois bancos inteiros**, usuários, hashes, arquivos, configurações fictícias e códigos locais, com manifesto SHA-256. Nenhum serviço remoto é acessado.
3. Confira: `node scripts/homologation-backup.cjs verify CAMINHO_INFORMADO`.
4. Para testar restauração sem sobrescrever o original: `ZEN_HOMOLOGY_INSTANCE=restauracao node scripts/homologation-backup.cjs restore CAMINHO_INFORMADO`.
5. Inicie `ZEN_HOMOLOGY_INSTANCE=restauracao npm run homologation` e confirme contas, fotos, recibos, fechamentos e saldo. O restaurador recusa destino existente e corrupção. Execute apenas uma instância nas portas locais.

Guarde backups em pasta privada: a cópia integral contém segredos fictícios do ambiente. Não versionar `.homologation*`. O botão de backup operacional do ZenControl também inclui novos lançamentos e comprovantes; esse formato preserva contas do destino e não transporta senhas, ativações ou marcações individuais de leitura. Para recuperar identidades locais, use a cópia integral acima. Para um PostgreSQL servidor futuro, planejar `pg_dump` e cópia do bucket privado com a mesma janela de recuperação.

## Limitações e aceite

- As duas planilhas Google não foram acessíveis. Não houve leitura de abas/fórmulas nem alteração dos originais. A equivalência com suas regras reais **continua pendente**; tarifas e ciclos do demonstrador vêm do escopo e de valores fictícios explícitos.
- A homologação entregue é local. Planos, saldos e cotas de Render/Vercel/Aiven/Supabase não foram inspecionados. Nenhum novo recurso desses provedores foi criado.
- O armazenamento local é durável somente no disco do computador. Não utilizar esse modo para evidências permanentes em Render efêmero. O backend já suporta Supabase privado, cuja adoção nesta homologação online depende de verificar conta/cota e obter o ambiente isolado autorizado.
- Notificações internas atualizam ao abrir/focar e a cada 60 s quando a aba está visível. Não são push com o navegador fechado. Eventos de carga ficam no estoque e são incorporados ao abrir o histórico. Web Push não foi habilitado.
- A demonstração não expõe portas na rede. Celular físico requer um ambiente HTTPS acessível e autorizado. A interface móvel foi exercitada em Chromium com largura de 390 px; isso não substitui a validação dos modelos reais de celular/câmera.
- Solicitações de estoque são persistentes e auditadas, mas a movimentação de reposição/recebimento/devolução/transferência permanece manual no Estoque Pro. O contrato automático disponível é de instalação.
- Paginação de serviços, alertas e movimentos é feita no servidor. O demonstrativo individual mostra até 1.000 lançamentos e 200 fechamentos/solicitações recentes por consulta; exportação por fechamento preserva a composição completa. Grandes históricos exigem expandir a paginação desses relatórios antes do uso operacional prolongado.
- PGlite tem conexão serializada. Testes de concorrência de múltiplos processos exigem PostgreSQL servidor, como no CI/Compose opcional.
- Não houve migração de dados reais, teste em produção, envio de mensagens, Pix ou contratação.

### Checklist de aceite

- [ ] A: login normalizado, colisão, ativação, senha forte e isolamento.
- [ ] B: criação, agendamento, cancelamento e distribuição interna sem WhatsApp.
- [ ] C: fotos, QR/barcode, checklist, data executada, rascunho, conferência/correção.
- [ ] D: recibo oficial e uma única baixa; carga/histórico por técnico.
- [ ] E/F: semanal, 14 dias, demais ciclos, feriados e vencimento.
- [ ] G: versão de tarifa, contraproposta com aceite e contestação específica.
- [ ] H: aprovação tardia sem modificar fechamento aprovado.
- [ ] I: parcial/quitação, comprovante e proteção contra repetição.
- [ ] J: falhas, reinício e backup/restauração.
- [ ] Comparar fórmulas, campos e competências com as planilhas quando o acesso for disponibilizado.
- [ ] Aprovação operacional humana antes de qualquer integração na principal ou deploy.

Veja [API-ECOSSISTEMA.md](API-ECOSSISTEMA.md) e [RELATORIO-HOMOLOGACAO.md](RELATORIO-HOMOLOGACAO.md).

Fechamentos existentes antes da migração recebem `legacy_unverified`: não são presumidos como dívida nem como pagos. Conferir o histórico antes de aprovar/importar os pagamentos externos; esses totais ficam separados do saldo confirmado.

Fechamento autorizado de valor zero termina como `no_payment_due` (sem valor a pagar), sem criar transferência fictícia. Resumos financeiros agregam toda a conta, independentemente do limite de itens exibidos, separam fechamentos em conferência e incluem ajustes aprovados pendentes. A API antiga de fechamento permanece apenas para OS legadas; OS controlada exige o fluxo Financeiro 6.4.
