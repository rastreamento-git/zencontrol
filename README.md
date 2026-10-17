> **ZenControl 6.4 — branch de homologação.** Use o [guia local do ecossistema](https://github.com/rastreamento-git/zencontrol/blob/feat/ecossistema-homologacao/HOMOLOGACAO.md). Requer API ZenControl 6.4. Não executar deploy/migrações em produção nesta etapa.

# ZenControl · plataforma de atendimento

ZenControl 6.3 reúne agenda, ordens de serviço, conferência da central, financeiro e API para o Portal do Técnico independente. React 19, Vite, Express 5, Node.js 24 e PostgreSQL. A identidade visual, autenticação, componentes e leitor de etiquetas seguem a base do Estoque Pro.

**Fluxo:** o técnico registra fotos e IMEIs → a central confere → o Estoque Pro confirma a instalação → a OS é concluída. O envio do técnico nunca conclui o serviço sozinho.

## Organização

| Caminho                          | Responsabilidade                                                         |
| -------------------------------- | ------------------------------------------------------------------------ |
| `apps/web/src/components`        | Agenda, gestão e conferência da central                                  |
| `ZenField (repositório próprio)` | Aplicativo separado dos técnicos, com build e endereço próprios          |
| `apps/api/src`                   | API, autorização, regras, fila e integração                              |
| `apps/api/migrations`            | Schema PostgreSQL versionado do ZenControl                               |
| `packages/ui`                    | Tema e componentes compartilhados; leitor original do Estoque Pro        |
| `packages/server`                | Base de autenticação, transações e validação                             |
| `integrations/estoque-pro`       | Backend do inventário com o adaptador de instalação; referência testável |
| `docs`                           | Regras, implantação e contrato entre os sistemas                         |
| `.github/workflows`              | Verificação automática em PostgreSQL e build do frontend                 |

O ZenControl tem banco próprio. O estoque existente continua no banco do Estoque Pro. A comunicação usa API autenticada entre os servidores; o navegador não recebe a chave de integração e o ZenControl não grava diretamente no banco do inventário.

## Ordem de serviço no modelo independente

O PDF usa os quatro blocos do gerador independente: associado, veículo, detalhes do atendimento e instruções/observações. Serviço, data/horário e técnico vêm automaticamente da OS salva; o técnico não precisa preenchê-los outra vez. Campos complementares e equipamentos previstos ficam persistidos no banco. **Salvar e gerar PDF** usa os dados atuais do formulário e salva antes de emitir.

A versão padrão oculta CPF/CNPJ, RG, Renavam e parte do nome. A versão integral é exclusiva da administração. O técnico pode baixar a versão protegida apenas das OS atribuídas a ele. A emissão e o envio por WhatsApp usam o mesmo modelo e não dependem de uma consulta à Hinova naquele momento.

A consulta SGA aceita código, placa ou chassi, complementa a ficha por ID e preenche dados do associado/veículo. Configure as credenciais `HINOVA_*` no ambiente do servidor e `INTEGRATIONS_ENABLED=true` para consultá-la. Serviço, agendamento e atribuição técnica são preservados durante essa consulta. As credenciais de arquivos de referência não fazem parte do repositório.

Detalhes em [documentos de OS](docs/ORDEM_DE_SERVICO.md). Ao atualizar uma instalação existente, execute `npm run migrate` para adicionar o campo complementar, antes de iniciar a aplicação.

## Hospedar no Render Free

A versão 6.2 aceita fotos em bucket privado no Supabase, preservando a autorização da central e dos técnicos. Configure `MEDIA_STORAGE=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `SUPABASE_STORAGE_BUCKET=zencontrol-evidencias` somente no backend. O `render.yaml` usa plano Free, sem disco, e executa as migrações no comando de início. O PostgreSQL permanece no Aiven. Confira o [passo a passo e limites](docs/IMPLANTACAO.md) antes de habilitar serviços reais.

## Subir localmente

Requisitos: Node.js 24 e Docker Compose ou PostgreSQL 16+ disponível.

```bash
npm ci --include=dev
npm run setup
docker compose up -d db
npm run migrate
npm run build
```

Consulte o usuário e a senha inicial no `.env` gerado. Ative `ZEN_RUN_WORKER=true` nesse arquivo para a API executar a fila no mesmo processo e inicie:

```bash
npm start
```

Abra `http://127.0.0.1:3000`. A central é exclusiva para administrador/operador. O ZenField fica em seu próprio repositório e é iniciado/publicado conforme o README dele. Em desenvolvimento, `npm run dev:web` serve o frontend e usa a API local. Para executar todos os containers: `docker compose up --build -d`; nesse modo, o Compose já inicia um worker separado com o mesmo volume de fotos.

As migrações criam uma base operacional vazia e as regras de evidência. Não importam os arquivos antigos, não conectam ao inventário sem configuração e não executam limpeza de outro banco. `npm run demo` é opcional e cria dados explicitamente fictícios apenas em uma base vazia; não faz parte da implantação.

## Conectar ao Estoque Pro

1. Aplicar no repositório `rastreamento-git/inventario-v2`, pasta `invent-back`, a integração correspondente a `integrations/estoque-pro`. Executar a migração aditiva `003_zencontrol.sql` e publicar o backend atualizado.
2. Definir `ZENCONTROL_INTEGRATION_SECRET` no ambiente do backend do Estoque Pro com o **mesmo** valor de `STOCK_API_SECRET` do ZenControl. `npm run setup` gera essa chave localmente; transfira-a pelo gerenciador de segredos da hospedagem.
3. No ZenControl, configurar `STOCK_API_URL` com a URL HTTPS do backend do Estoque Pro, `STOCK_ENABLED=true` e `ZEN_RUN_WORKER=true` quando não houver um worker separado. Manter `STOCK_SOURCE_SYSTEM=zencontrol` estável para esta base.
4. Em **Equipe técnica**, vincular cada técnico ao cadastro correspondente consultado no Estoque Pro. Em **Equipe e acessos**, criar um usuário com perfil **Técnico** e selecionar seu cadastro no ZenControl.
5. Em **Configurações**, revisar as fotos exigidas por serviço. Distribuir os equipamentos aos técnicos pelo Estoque Pro antes da instalação.
6. Validar uma OS: técnico envia as evidências, central aprova em **Validações**, fila confirma o estoque e OS passa para **Concluído**.

WhatsApp e SGA são opcionais, configurados separadamente. `INTEGRATIONS_ENABLED` controla esses serviços; `STOCK_ENABLED` controla o Estoque Pro. Mesmo com a baixa automática legada habilitada, as novas OS sempre exigem aprovação da central.

## Regras e validação

- Cada técnico vê apenas suas próprias OS e fotos; o servidor bloqueia rotas administrativas, financeiro e aprovação para esse perfil.
- Instalação/reinstalação exigem pelo menos um IMEI/serial e uma foto de etiqueta vinculada a cada código.
- O estoque aceita somente equipamentos não arquivados em estado `TECNICO`, na carga do técnico vinculado à OS. O lote é confirmado integralmente em uma transação.
- A integração chama a mesma regra de instalação do Estoque Pro: estado `INSTALADO`, movimento `USO_FINAL`, histórico por serial e saldo recalculado.
- Aprovar uma instalação cria uma tarefa persistida. A OS fica em **Aguardando estoque**, sem entrar no financeiro, até o recibo autenticado.
- Uma chave por envio impede duplicidade mesmo quando a instalação ocorre e a resposta de rede se perde. Falhas transitórias são retomadas; recusas de negócio ficam visíveis para correção.
- A central pode solicitar correção. Técnico recebe o motivo e cria novo envio. Fotos de envios aprovados e dados de uma OS confirmada permanecem preservados.
- Manutenção, retirada, visita e improdutiva exigem evidências e aprovação, mas não registram uma nova instalação. Retorno de equipamento instalado continua pelo processo de triagem do Estoque Pro.

Detalhes em [regras de negócio](docs/REGRAS_DE_NEGOCIO.md), [integração](docs/INTEGRACAO_ESTOQUE_PRO.md) e [implantação](docs/IMPLANTACAO.md).

```bash
npm run check
npm test
npm run build
```

Os testes executam SQL PostgreSQL real através de PGlite localmente. Com `TEST_DATABASE_URL`, usam um servidor PostgreSQL isolado por schema. O CI executa esse segundo modo. A suíte inclui o backend do inventário, aprovação, autorização, evidências, recusa atômica e recuperação de resposta perdida sem baixa duplicada.

Credenciais, fotos de clientes, bancos antigos e dados de produção não pertencem ao repositório. A criação de uma instância de banco na hospedagem e a configuração dos segredos são etapas de implantação; o código e as migrações não provisionam uma conta de nuvem.

## Portal do técnico

O ZenField tem repositório, dependências, login, build e hospedagem próprios; a central permanece em `apps/web`. Configure `VITE_API_URL` no portal e `TECHNICIAN_PORTAL_URL` no backend. O caminho antigo `/tecnico` redireciona para o endereço próprio quando configurado. Fotos das etiquetas identificam automaticamente o código e o tipo do aparelho na carga do técnico. Novos envios exigem fotos da vistoria e checklist assinado; a central aprova antes da conclusão e do fechamento financeiro. Confira [operação, limites e ativação](docs/PORTAL_TECNICO.md).
