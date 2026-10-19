# Homologação online temporária

Este modo publica uma demonstração descartável, com dados fictícios. **Não substitui um ambiente persistente.** Nenhum banco Aiven ou bucket Supabase é usado. A configuração recusa credenciais externas. Não há SGA, WhatsApp nem pagamento bancário.

Uma instância Render **Free** executa as duas APIs e PostgreSQL nativo com dois bancos separados para central e estoque. ZenField e Estoque Pro têm Static Sites e sessões independentes. O gateway expõe somente a API do estoque sob `/stock-api`, a central na raiz e arquivos fictícios sob `/demo-files`. Os demais listeners são locais. Os frontends e o backend usam a branch `feat/ecossistema-homologacao`, sem merge em `main`.

**Perda de dados:** reinício, novo deploy ou suspensão por inatividade do Render apagam os registros e imagens temporários e recriam os exemplos. A senha administrativa continua a mesma variável privada, mas as ativações individuais são recriadas. Obtenha novo código na central. Baixe o backup operacional autenticado antes de encerrar uma rodada. A cópia integral de disco do guia local não fica disponível remotamente.

Os dois bancos são acessíveis somente por loopback e usam pools separados; esse modo não é ensaio de carga. O demonstrador local original continua usando WASM. Uma instância Free tem memória limitada: use poucos usuários e fotos de teste pequenas. Fotos continuam limitadas e privadas pelas mesmas APIs autenticadas. Não se afirma disponibilidade contínua ou custo ilimitado: há franquias de horas, tráfego e builds compartilhadas no workspace.

## Serviço da central e APIs

- Repositório: `rastreamento-git/zencontrol`.
- Branch: `feat/ecossistema-homologacao`.
- Runtime: Node 24; plano `free`; região Virginia.
- Auto deploy: desligado.
- Build: `node scripts/online-demo-build.cjs`.
- Start: `node scripts/homologation.cjs`.
- Node: `NODE_OPTIONS=--max-old-space-size=128`.
- Não usar `npm run migrate` remoto neste modo.
- Health: `/healthz`; inventário: `/stock-api/healthz`; características: `/demo-info`.

Variáveis: `NODE_VERSION=24`, `NODE_ENV=production`, `SKIP_INSTALL_DEPS=true`, `ZEN_HOMOLOGATION_MODE=online-demo`, `ZEN_HOMOLOGY_INSTANCE=online-demo`, `ONLINE_DEMO_PASSWORD` (aleatória, mínimo 16 caracteres), `ONLINE_DEMO_SECRET` (aleatório, mínimo 32 caracteres), `ONLINE_FIELD_URL` e `ONLINE_STOCK_URL` com as origens HTTPS reais dos Static Sites. `RENDER=true`, `RENDER_EXTERNAL_URL` e `PORT` são fornecidos pelo Render. Não definir `DATABASE_URL`, `SUPABASE_*` ou `STOCK_API_URL`. As integrações permitidas são configuradas internamente somente em loopback.

O build baixa apenas o código público oficial do inventário, fixado no commit `6a0407896c1a639cffc2f01529138c36841ab4ca`. Não inclui credenciais nos bundles, logs ou arquivos versionados. A senha fica em `ONLINE_DEMO_PASSWORD` no Environment do novo serviço. Login: `admin`.

O build instala `embedded-postgres@18.4.0-beta.17`, com binários nativos, em uma pasta privada de runtime e gera as etiquetas. O PostgreSQL inicia sem privilégios root, aceita conexões apenas em `127.0.0.1:54321`, usa SCRAM e não cria usuários no sistema operacional. As duas APIs usam bancos distintos. O runtime WASM anterior foi recusado pelo limite de 512 MiB do Render, por isso não é usado online. O consumo deve ser acompanhado durante os testes de fotos.

## Frontends independentes

ZenField: repo `rastreamento-git/zenfield`, build `npm ci --include=dev && npm run build`, publicação `dist`, `VITE_API_URL=https://ENDERECO-DA-CENTRAL`.

Estoque Pro: repo `rastreamento-git/inventario-v2`, build `cd invent-front && npm ci --include=dev && npm run build`, publicação `invent-front/dist`, `VITE_API_URL=https://ENDERECO-DA-CENTRAL/stock-api`.

Ambos: mesma branch de homologação, `NODE_VERSION=24`, `SKIP_INSTALL_DEPS=true`, auto deploy desligado. Acrescente ao HTML o aviso de demonstração temporária, conforme `banner()` em `scripts/online-demo.cjs`. O gateway usa as origens reais em CORS, sem curinga. Os aplicativos atuais usam navegação interna sem rotas SPA, portanto os links de acesso usam a raiz dos sites.

## Roteiro de teste

1. Login de administrador na central e no estoque. No ZenControl, gerar ativação para José; ativar e definir senha no ZenField.
2. Selecionar instalação; testar uma foto ilegível, depois a etiqueta fictícia em `/demo-files/rastreador-jose.jpg`.
3. Anexar vistoria e `/demo-files/checklist-ficticio.pdf`; concluir e enviar para conferência.
4. Conferir/aprovar na central; verificar recibo e baixa única no estoque.
5. Verificar financeiro e registrar somente pagamento simulado.
6. Baixar backup antes de parar ou deixar a instância suspender. Não inserir dados reais.

Para manter registros e imagens entre reinícios, preparar posteriormente bancos exclusivos de homologação no Aiven e bucket privado separado no Supabase, verificar cotas e usar o start convencional. Isso exige as configurações privadas desses ambientes e nova validação; não é parte do modo efêmero.

## Migração das interfaces para Vercel

Criar projetos exclusivos `zencontrol-homolog` e `zenfield-homolog`, conectados aos respectivos repositórios, publicando a branch `feat/ecossistema-homologacao`. Não alterar o projeto de produção do Estoque Pro. Os dois usam Node 24, Root Directory vazio, instalação `npm ci --include=dev`, build `npm run build` e `VITE_API_URL=https://zencontrol-homolog.onrender.com`. A saída da central é `apps/web/dist`; a do ZenField é `dist`. O `vercel.json` desta branch habilita seu deploy e impede indexação por buscadores.

A API temporária continua no Render. Depois de obter os endereços estáveis dos dois novos projetos, definir `ONLINE_CENTRAL_URL` (origem HTTPS da central Vercel) e atualizar `ONLINE_FIELD_URL` (origem HTTPS do ZenField Vercel) no serviço `zencontrol-homolog`. Fazer um único deploy manual da API. `ONLINE_CENTRAL_URL` é opcional e, quando ausente, preserva a origem anterior no Render. O CORS aceita apenas as origens exatas configuradas, sem curinga para previews.

No Vercel, `Production` é o destino de publicação do projeto **exclusivo de homologação**; usar essa opção somente nesses dois projetos novos, com a branch de teste. Não promover a branch de teste em projetos produtivos. Os dados continuam temporários. Nunca copiar segredos do backend para variáveis `VITE_*`.

Validar as telas, a resposta de sessão a partir de cada origem, a ativação individual, uma foto fictícia, checklist e conferência na central antes de retirar os frontends antigos do Render. Só a hospedagem das interfaces muda; nenhuma transferência de banco ou fotos é necessária.

## Acesso único ZEN

A entrada principal é a interface do ZenControl na Vercel. Uma conta individual é cadastrada em **ZenControl → Usuários**: administradores e operadores usam a central e o botão **Abrir Estoque Pro**; técnicos seguem automaticamente para o ZenField. O ZenField e o estoque oferecem **Entrar com conta ZEN**. O primeiro acesso do técnico continua exigindo o código individual e a troca da senha provisória; a ativação também está disponível na entrada principal.

O inicializador de homologação configura `SSO_LOGIN_URL`, `SSO_STOCK_URL` e `TECHNICIAN_PORTAL_URL` na central, e `ZEN_IDENTITY_API_URL`, `ZEN_LOGIN_URL`, `ZENCONTROL_INTEGRATION_SECRET` no estoque. Apenas os endereços públicos aparecem nos frontends. A integração usa o segredo já existente do estoque, exclusivamente nos servidores. No modo normal, configurar os valores equivalentes explicitamente antes de ativar o recurso; sem essa configuração, o login legado é preservado.

A passagem entre origens usa um código de uso único, válido por 60 segundos e vinculado ao aplicativo, estado e prova PKCE do navegador. O código é removido do fragmento após a chegada. As sessões do estoque são opacas e validadas pela central a cada solicitação: a API recusa técnicos, contas desativadas e sessões cuja versão mudou. O estoque mantém uma identidade local vinculada por ID, separada de usuários nativos homônimos, para preservar as referências da auditoria. O gerenciamento de contas é feito somente na central. Sair de um aplicativo invalida as sessões dessa conta nos três sistemas; senhas são confirmadas na central nas ações sensíveis.

Validação local: `node --test apps/api/test/unified-access.test.js` cobre os limites da API; `node scripts/unified-access-ui.cjs` verifica acesso entre origens, perfis, saída global e rolagem móvel. O segundo comando usa Playwright e requer Chromium instalado ou `ZEN_CHROMIUM_PATH`; `ZEN_CHROMIUM_MODULE` permite carregar argumentos de uma distribuição compatível, sem desabilitar a segurança da web.
