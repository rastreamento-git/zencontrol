# Homologação online temporária

Este modo publica uma demonstração descartável, com dados fictícios. **Não substitui um ambiente persistente.** Nenhum banco Aiven ou bucket Supabase é usado. A configuração recusa credenciais externas. Não há SGA, WhatsApp nem pagamento bancário.

Uma instância Render **Free** executa as duas APIs e um banco PostgreSQL WASM com schemas separados para central e estoque. ZenField e Estoque Pro têm Static Sites e sessões independentes. O gateway expõe somente a API do estoque sob `/stock-api`, a central na raiz e arquivos fictícios sob `/demo-files`. Os demais listeners são locais. Os frontends e o backend usam a branch `feat/ecossistema-homologacao`, sem merge em `main`.

**Perda de dados:** reinício, novo deploy ou suspensão por inatividade do Render apagam os registros e imagens temporários e recriam os exemplos. A senha administrativa continua a mesma variável privada, mas as ativações individuais são recriadas. Obtenha novo código na central. Baixe o backup operacional autenticado antes de encerrar uma rodada. A cópia integral de disco do guia local não fica disponível remotamente.

Cada operação seleciona o schema correto ao obter a conexão; o banco WASM serializa conexões; esse modo não é ensaio de carga nem teste PostgreSQL multiconexão. Uma instância Free tem memória limitada: use poucos usuários e fotos de teste pequenas. Fotos continuam limitadas e privadas pelas mesmas APIs autenticadas. Não se afirma disponibilidade contínua ou custo ilimitado: há franquias de horas, tráfego e builds compartilhadas no workspace.

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

O build baixa apenas o código público oficial do inventário, fixado no commit `27417a75742e95138304623a9799aa7d41e5bc34`. Não inclui credenciais nos bundles, logs ou arquivos versionados. A senha fica em `ONLINE_DEMO_PASSWORD` no Environment do novo serviço. Login: `admin`.

O build inicializa o template PostgreSQL e gera as etiquetas antes de empacotar o serviço. A inicialização recusa um template ausente, evitando executar `initdb` dentro da memória limitada do runtime. Após essa preparação, a medição local de memória inicial foi de aproximadamente 278 MiB; o uso real do Render deve ser acompanhado durante a leitura de fotos.

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
