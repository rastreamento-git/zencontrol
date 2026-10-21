# Relatório da implementação e homologação

Data: 16/10/2026. Escopo: branches de revisão dos três repositórios. Produção não foi usada como ambiente de teste.

## Auditoria de origem

| Repositório | Base inspecionada                                                       | Constatação                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ZenControl  | `ac09353` em `main`, mais as alterações locais 6.3 ainda não integradas | API 6.2 publicada na principal; captura avançada 6.3 precisava ser incluída na branch; financeiro antigo usava valores do cadastro sem versões |
| ZenField    | `59268a5` em `main`                                                     | Frontend separado e login próprio; faltavam ativação, notificações, estoque detalhado e acompanhamento financeiro                              |
| Estoque Pro | `a5eca40` em `main`; PR #4 em `01d94cc`                                 | Adaptador de instalação ainda em PR rascunho, com transação/recibo/idempotência; faltava consulta de movimentos individuais                    |

O PR [#4 do Estoque Pro](https://github.com/rastreamento-git/inventario-v2/pull/4) foi lido antes da extensão. A regra de instalação original foi preservada; os testes verificam recusa atômica, autenticação, repetição concorrente, unicidade por origem/OS e backup/restauração do recibo. A branch de homologação do estoque parte desse PR e acrescenta contrato de leitura de histórico, sem merge na principal. Seu PR complementar deve apontar para `feat/zencontrol-installation`, formando uma revisão encadeada.

As duas planilhas de referência não ficaram acessíveis. A conexão Google Drive não estava disponível, e os URLs não permitiram leitura pela ferramenta. Não foram inferidas fórmulas, abas ou valores operacionais. A conferência da equivalência financeira e do mapeamento de campos permanece pendente de acesso ou exportação autorizada. Nenhum arquivo original foi alterado.

## Alterações implementadas

### ZenControl 6.4

- Migração aditiva `005_ecosystem.sql`: ativação, auditoria de autenticação, notificações/leitura por usuário, datas de execução/conferência, tarifas, políticas, feriados, ledger, solicitações/decisões, ajustes e pagamentos.
- Cadastro cria conta técnica com login normalizado e tratamento de colisões, na mesma transação. `zen123` não autentica; código individual expira/é consumido; senha definitiva usa scrypt e mínimo de 12 caracteres. Reset e desativação revogam sessões.
- Notificações persistentes e deduplicadas, sino, contagem e acesso ao atendimento/solicitação. Leitura da central é individual.
- Novas OS distribuídas internamente. Botões/grupos/configurações de despacho WhatsApp removidos da operação nova; webhooks não associam mídia nova a OS controlada. Histórico e fluxo legado continuam preservados, assim como SGA/Hinova.
- Execução finalizada, envio para conferência, correção, aprovação, espera por estoque e conclusão têm registros separados. O envio técnico nunca conclui a OS.
- Tarifas versionadas por vigência, composição congelada por execução, políticas de ciclos, feriados, aprovação tardia, reajuste/contraproposta com aceite e ajuste específico de OS.
- Fechamento em conferência, aprovação, pagamento externo parcial/quitação, comprovante privado, PDF e exportação. Unicidade de OS, chave lógica da operação, referência externa por fechamento e limites de saldo protegem contra duplicidade.
- Reconciliação financeira, health 503 em indisponibilidade do banco, logs sem payload sensível, backup operacional com novos lançamentos/comprovantes.
- Inicializador e cópia/restauração integral locais, com dados fictícios e nenhum endereço de banco remoto.

### ZenField 1.1

- Mantido como repositório independente, usando a autenticação/API do ZenControl.
- Primeiro acesso/redefinição com ativação e senha forte; aviso claro para backend anterior à versão 6.4.
- Navegação móvel: Início, Meus serviços, Meu estoque, Meu financeiro e Meus valores.
- Filtros/paginação de OS, data executada, etapa de finalização e rascunho no servidor, fotos com leitura de QR/barcode/IMEI, vistoria e checklist assinado.
- Estoque individual com categorias/modelos/seriais, associação às OS, movimentos e solicitações auditadas.
- Demonstrativos próprios, estimativas separadas de valores confirmados, versões de tarifas, solicitações, contrapropostas, contestações, fechamentos, comprovantes e saldo.
- Atualização moderada de alertas, formulários com rótulos associados e telas sem dependências comerciais.

### Estoque Pro

- PR #4 incorporado somente na branch de homologação, preservando o inventário e seus perfis, triagem, devoluções e rastreabilidade.
- Consulta autenticada de histórico individual, paginada, com vínculo de OS persistido por evento na migração 004. Isso evita atribuição incorreta quando um serial é reutilizado/reinstalado. Eventos anteriores ficam sem vínculo inferido, preservando os recibos originais. Carga expõe situação e data da última alteração.
- O demonstrador usa os módulos do repositório oficial e bancos separados. O frontend nunca lê o banco de outra aplicação.
- Bloqueio de deploy automático da branch de homologação em `vercel.json`, inclusive na raiz `invent-front` usada pelo projeto conectado.

## Evidências de testes

Os testes ficam versionados junto ao código, usam dados fictícios e bancos isolados. As quantidades finais e resultados de navegador/CI devem ser conferidos na seção de validação ao final deste relatório e nos checks dos PRs.

| Cobertura                                                                                              | Onde                                                                 |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| A: login, colisões, ativação expirada/reutilizada, senha e isolamento                                  | `apps/api/test/ecosystem.test.js` e roteiro Playwright               |
| B/C: distribuição interna, filtros, fotos, checklist, avisos e correção                                | `portal.test.js`, `ecosystem.test.js`, `scripts/homologation-ui.cjs` |
| D: lote atômico, recibo, resposta HTTP perdida, uma baixa e histórico                                  | `portal.test.js` e `invent-back/test/zencontrol.test.js`             |
| E/F: ciclos semanais, 14/10/N dias, N semanas/meses, cortes, ano bissexto, feriados                    | `financial-calendar.test.js` e `ecosystem.test.js`                   |
| G: reajuste e contraproposta com aceite, autorização e histórico congelado                             | `ecosystem.test.js` e UI                                             |
| H: execução antiga, confirmação tardia e snapshot preservado                                           | `ecosystem.test.js`                                                  |
| I: pagamento parcial/quitação, referência única, excesso de saldo e recibo privado                     | `ecosystem.test.js` e UI                                             |
| J: indisponibilidade de mídia/banco, resposta perdida, versões, sessão, arquivo inválido e recuperação | testes existentes + novos; backup com corrupção de comprovante       |

O cenário de interrupção de conexão é exercitado por falha no armazenamento e perda da resposta de confirmação, além da recuperação do estado no navegador. Não houve teste de queda física de rede em aparelhos reais nem ensaio de carga distribuída. PGlite serializa conexões; os testes de SQL multiconexão ficam no PostgreSQL 17 do CI ou Compose local opcional. Nenhuma evidência local deve ser apresentada como teste em Aiven/produção.

## Custos operacionais adicionais

O ambiente demonstrado opera em disco/processos locais existentes. Não foram contratados nem criados bancos/planos/domínios/serviços de mensagem. Não houve API de IA por consumo no sistema, tráfego bancário ou pagamento real. Isso elimina contratação adicional para a demonstração local; não mede energia, conexão ou custo já contratado do computador/ambiente de desenvolvimento.

| Recurso                                   | Uso nesta entrega                                     | Verificação/limite                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node, React/Vite, PostgreSQL WASM e ZXing | Execução e reconhecimento locais                      | Não requer assinatura de infraestrutura; limitado por CPU/RAM/disco locais                                                                                           |
| GitHub                                    | Código, branches e PRs dos três repositórios públicos | Visibilidade pública verificada pela API; workflows usam runners Ubuntu padrão, sem upload de artefatos/cache adicional configurado                                  |
| GitHub Actions                            | Testes de revisão com PostgreSQL 17                   | Documentação oficial confirma execução gratuita em repositórios públicos com runners padrão; runners maiores e armazenamento adicional não foram habilitados         |
| Render                                    | Não utilizado para esta homologação                   | Plano/cota/saldo da conta não verificados. Documentação pública informa suspensão, horas gratuitas e disco efêmero; isso não comprova capacidade disponível na conta |
| Vercel                                    | Deploy automático desta branch desabilitado no código | Plano/cotas da conta não verificados. Nenhum domínio ou plano criado; regra `git.deploymentEnabled` específica para a branch                                         |
| Supabase                                  | Nenhum projeto/bucket usado pelo demonstrador         | Planos/cotas reais não verificados. O suporte existente a bucket privado foi preservado para implantação futura autorizada                                           |
| Aiven                                     | Nenhum acesso/migração de produção                    | Plano/cota real não verificado, nenhuma ampliação                                                                                                                    |
| Mensagens/Web Push/monitoramento externos | Não utilizados                                        | Notificações internas e logs locais; sem serviço contratado                                                                                                          |
| Banco/Pix                                 | Não utilizados                                        | Somente registros fictícios de pagamentos externos                                                                                                                   |

Fontes oficiais consultadas em 16/10/2026: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Render Free](https://render.com/docs/free), [Supabase pricing](https://supabase.com/pricing), [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration). Documentação pública não substitui verificar a contratação e o consumo na conta. Não foi presumida gratuidade de uma homologação online.

Para a modalidade online, a condição de custo adicional zero **não foi validada**: seria necessário conferir planos, cotas remanescentes, armazenamento, tráfego, projetos permitidos e controles de cobrança, além de preparar banco/bucket isolados. Essa modalidade não foi ativada. Não se promete disponibilidade contínua/SLA em free tier.

## Limitações e próximos passos

1. Obter acesso somente leitura às planilhas e comparar campos, fórmulas, competências e regras reais; parametrizar diferenças e criar casos de regressão com amostras anonimizadas autorizadas.
2. Homologar em celulares físicos e com o formulário real, verificando iluminação, foco, câmeras e PDFs; o teste entregue usa viewport móvel e arquivos fictícios.
3. Formalizar APIs de escrita para reposição/recebimento/devolução/transferência no Estoque Pro se a operação desejar automatizar essas solicitações. Hoje a decisão é interna e a movimentação permanece no sistema oficial.
4. Ampliar paginação de grandes demonstrativos/solicitações, coleta de órfãos de mídia e regras de expurgo após definir retenção. As consultas atuais têm limites documentados.
5. Web Push opcional, com consentimento, pode ser acrescentado por padrões abertos; a operação já funciona com alertas internos.
6. Antes de produção, revisar permissões operacionais de financeiro, plano de recuperação, monitoramento e política de retenção com responsáveis. Nenhum merge/deploy é realizado por este relatório.

### Evolução paga futura — somente proposta

Se a empresa posteriormente autorizar investimento: instância/banco sem suspensão, backup gerenciado com restauração pontual, armazenamento com retenção, monitoramento de disponibilidade e auditoria independente, worker contínuo e testes de carga em PostgreSQL. Dimensionar a partir de volume medido e orçamento aprovado; não habilitar automaticamente nem vincular esta homologação a contratação.

## Validação final

Validação local concluída:

- API ZenControl: **101 testes passaram**, incluindo atualização de base legada sem presumir dívida/pagamento, fechamento de valor zero e agregados financeiros além da paginação.
- Adaptador/Estoque Pro: **32 testes passaram**; o teste adicional percorre instalação, triagem, reuso e nova instalação do mesmo serial, preservando cada OS no evento correto.
- Frontend Estoque Pro: **48 testes passaram** e lint sem avisos.
- Build dos três frontends: aprovado com URLs exclusivamente locais; `check` do ZenField confirma independência das fontes.
- Navegador Chromium: ativação real, viewport 390 px e desktop, solicitações, foto ilegível, Code128, checklist, conferência, recibo oficial, fechamento da instalação e pagamentos simulados parcial/quitação; sem erros de JavaScript/rolagem horizontal.
- Backup operacional: novos lançamentos e comprovante PDF restaurados; corrupção detectada antes da aplicação.
- Backup local integral: manifesto com **2.152 arquivos verificados**; restauração em instância nova, login e histórico financeiro preservados.

Logs e screenshots locais não contêm dados produtivos e não são publicados no GitHub. Reproduzir pelos comandos do guia. O estado do CI PostgreSQL fica nos checks dos PRs; a execução local acima usou PGlite, não Docker. Instruções reproduzíveis: [HOMOLOGACAO.md](HOMOLOGACAO.md). Contratos: [API-ECOSSISTEMA.md](API-ECOSSISTEMA.md).
