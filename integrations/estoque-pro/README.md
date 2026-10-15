# Invent Back — Estoque Pro

API Express/PostgreSQL para usar com `rastreamento-git/invent-front` da mesma entrega.
Node.js 24.x. Banco PostgreSQL 16 ou superior recomendado.

## Instalação local

```bash
npm ci
```

Copie `.env.example` para `.env` e ajuste `DATABASE_URL`.
Para PostgreSQL local use `DATABASE_SSL=disable`. Para nuvem prefira `verify-full`
e forneça `DATABASE_CA` se o provedor usa uma CA própria. `require` é uma opção
explícita de compatibilidade com TLS sem verificar o certificado; não é o padrão.

```bash
npm run migrate
npm run reconcile
npm start
```

A API escuta na porta 3000 por padrão. `/healthz` verifica a conexão com o banco.
Em um banco novo não há produtos nem técnicos: cadastre-os pela interface.

## Atualização de banco existente

Faça backup e teste numa cópia antes de atualizar a produção. Não havia um DDL
versionado no repositório original; a migração preserva as tabelas existentes e
assume as colunas já utilizadas pela API anterior. Ela adiciona `arquivado`,
a tabela `eventos_seriais`, índices e controle de migrações. Não apaga o estoque
nem altera automaticamente os saldos antigos.

1. Pare a API antiga para evitar gravações enquanto atualiza/reconcilia o banco.
2. Execute `npm run migrate`.
3. Execute `npm run reconcile` para conferir diferenças entre saldos e seriais.
4. Se todos os equipamentos físicos estiverem cadastrados por serial, execute
   `npm run reconcile -- --apply` para recalcular os saldos. Se havia estoque
   apenas em quantidade, cadastre/valide os seriais faltantes antes de aplicar.
5. Inicie esta API e publique o frontend revisado em conjunto.

A reconciliação usa os seriais como fonte do saldo. Dados com modelo, técnico ou
status inválido exigem correção manual. Os registros legados de movimentação
continuam disponíveis, mas não contêm a lista de IMEIs; somente as novas operações
gravadas nesta versão possuem histórico individual por serial. IMEIs excluídos
pela limpeza antiga não podem ser recuperados a partir destes repositórios.

## Produção e Render

Build: `npm ci`. Start: `npm run migrate && npm start`. Health check: `/healthz`.
Defina no ambiente do serviço:

| Variável | Uso |
| --- | --- |
| NODE_ENV | `production` |
| DATABASE_URL | URL privada do PostgreSQL |
| DATABASE_SSL | `verify-full`; `disable` somente em conexão local/interna sem TLS |
| DATABASE_CA | Certificado CA do provedor, se necessário, com `\n` entre linhas |
| CORS_ORIGINS | Domínios exatos do frontend, separados por vírgula, sem `/` final |
| APP_PASSWORD | Senha para inicializar o primeiro administrador; mínimo 12 caracteres |
| SESSION_SECRET | Segredo aleatório com no mínimo 32 caracteres |
| TRUST_PROXY | `1` somente quando houver um proxy confiável na frente da API |
| PORT | Normalmente fornecida automaticamente pela hospedagem |

Gere o segredo com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
Configure os segredos no painel da hospedagem, nunca no GitHub nem no frontend.
O container do backend exige o banco já migrado. No Render, use o Start Command
acima para aplicar migrações antes de iniciar.

## Contrato e regras

As rotas anteriores permanecem, com as seguintes correções:

- `entrada`, `transferir`, `instalar`, `estorno` e `triagem/receber` aceitam de 1 a
  1.000 seriais em texto. Preservam zeros iniciais, validam o lote inteiro e
  devolvem 400/404/409 para dados inválidos, ausentes ou em conflito.
- Um serial já cadastrado faz a entrada inteira falhar com 409. Não há entrada
  parcial nem aumento do saldo por duplicados. Atualize a lista antes de repetir
  uma operação após timeout.
- Todas as gravações de estoque usam uma única conexão de transação e um lock
  transacional compartilhado entre instâncias. As gravações são serializadas,
  adequado ao volume de um inventário administrativo; reavaliar para alta carga.
- Transferência/baixa/devolução conferem modelo, técnico e estado de cada serial.
  A devolução do técnico só aceita `TECNICO`. Instalados retornam por triagem.
- Receber em triagem desconta o saldo de origem. Aprovar/reprovar exige estado
  `TRIAGEM`; repetir a avaliação não aumenta o estoque novamente.
- `GET /api/imeis` inclui `produto_id` e `tecnico_id`; comparação por nomes não é
  necessária. `?incluir_arquivados=true` inclui os instalados arquivados.
- `GET /api/imeis/:codigo/historico` consulta o histórico individual.
- `DELETE /api/limpeza-instalados` **arquiva**, não exclui, instalados com mais de
  30 dias. Resposta: `arquivados`, `apagados: 0`. A identidade permanece única.
- Correção de entrada na matriz remove o serial, mas conserva a auditoria do
  cancelamento. Modelos com equipamentos ou histórico não podem ser excluídos.
- `PUT /api/configurar-alerta` também aceita `tipo: CATEGORIA`, para atualizar todos
  os modelos da categoria numa única transação. Limite zero é válido.
- O dashboard usa o fuso America/Sao_Paulo nas conexões e inclui os sete dias,
  inclusive sem instalações. O desempenho da equipe representa os últimos 30 dias.
- Compras mantêm a fórmula de consumo médio: ponto de pedido = 22,5 dias de
  consumo e meta = 52,5 dias, respeitando o mínimo cadastrado. Valores são inteiros.

## Acesso e contas

`POST /api/auth/login` recebe `{ "login": "admin", "password": "..." }` e devolve um token de sessão assinado, válido por oito horas, junto com o perfil público do usuário. Envie `Authorization: Bearer TOKEN`. `GET /api/auth/session` informa o usuário autenticado.

A migração `002_users_admin.sql` cria `usuarios`, `auditoria_admin` e a coluna `operador` nas movimentações. Na primeira inicialização, sem contas, o login padrão `admin` é criado com a senha de `APP_PASSWORD`. `APP_ADMIN_USER` permite outro login inicial. APP_PASSWORD não sobrescreve senhas de contas existentes. Senhas usam scrypt, sal aleatório por conta e comparação em tempo constante.

Perfis: `operador` consulta e movimenta o inventário; `admin` também acessa `/api/admin/*`. Troca de senha, alteração de perfil e desativação aumentam a versão de sessão da conta e invalidam os seus tokens anteriores. Trocar SESSION_SECRET invalida todos os tokens.

Há limite de tentativas de login. Em produção são exigidos APP_PASSWORD de pelo menos 12 caracteres e SESSION_SECRET de pelo menos 32. Em desenvolvimento sem APP_PASSWORD, acesso é livre; reset e restauração exigem autenticação configurada. A limitação de login é mantida em memória por instância.

## Rastreabilidade e administração

- `GET /api/rastreabilidade`: todos os seriais presentes no cadastro ou no histórico individual. Parâmetros: `q`, `status`, `categoria`, `tecnico_id`, `arquivo` (`todos`, `ativos`, `arquivados`), `page` e `pageSize` (até 100). Retorna linhas, totais, páginas e filtros disponíveis.
- `GET/POST /api/admin/users`: listar/cadastrar contas. Criação recebe nome, login, password e papel. A API não expõe senha_hash.
- `PUT /api/admin/users/:id`: ativar/desativar, alterar perfil ou definir `nova_senha`; preserva ao menos um administrador e impede retirar o próprio acesso administrativo.
- `GET /api/admin/backup`: exporta as seis tabelas de inventário, contagens e SHA-256 do conteúdo. Exclui contas, hashes, segredos e auditoria administrativa.
- `POST /api/admin/reset`: exige perfil admin, senha atual, `confirmation: "thereisnourflevel"`, `scope: "all"` ou `"stock"` e `expectedChecksum` do backup atual. Se os dados mudaram, responde 409. Preserva usuários, auditoria administrativa e migrações.
- `POST /api/admin/restore`: exige perfil admin, senha atual, `confirmation: "restaurar"`, backup compatível e `expectedChecksum` do inventário antes da substituição. Valida integridade, colunas e restrições do banco. Restaura tabelas e sequências de IDs em uma transação; falhas causam rollback.
- `GET /api/admin/audit`: últimas 100 operações administrativas, sem senhas.

O checksum detecta alterações no conteúdo; não é uma assinatura criptográfica. Todas as gravações, o snapshot do backup, o reset e a restauração usam o mesmo lock transacional para evitar substituição de dados modificados depois da exportação. O JSON local não substitui o backup integral do PostgreSQL.

## Testes

```bash
npm run check
npm test
npm audit --omit=dev
```

Por padrão os testes usam PGlite, que executa SQL PostgreSQL em WASM, sem depender
do banco de produção. Para testar conexões concorrentes de verdade use um banco
**exclusivo de teste**:

```bash
TEST_DATABASE_URL=postgresql://... npm test
```

Esse modo cria e remove esquemas temporários, nunca deve apontar para produção.
O teste local com PGlite possui uma conexão e enfileira acessos; não reproduz a concorrência de
várias conexões. A entrega foi validada localmente com PGlite e navegador; não
houve acesso ao banco ou à hospedagem do projeto em produção.

## Integração com ZenControl

A migração aditiva `003_zencontrol.sql` cria recibos de instalação com chave idempotente e unicidade por origem/OS. Configure `ZENCONTROL_INTEGRATION_SECRET` com pelo menos 32 caracteres, igual a `STOCK_API_SECRET` no servidor ZenControl. Sem esse segredo, o adaptador responde indisponível. Ele não depende de um login de operador e a chave nunca deve ser enviada ao navegador.

O prefixo `/api/integrations/zencontrol` oferece catálogo, carga por técnico e `POST /installations` autenticado por Bearer. Instalação exige `Idempotency-Key` e `{source_system,order_id,submission_id,technician_id,serials,operator}`. Confere todos os seriais na carga correta e reutiliza a regra `instalar`: `USO_FINAL`, estado `INSTALADO`, auditoria e saldo. O lote inteiro e seu recibo são confirmados na mesma transação. Chave repetida com mesmos dados retorna o recibo anterior; dados diferentes ou segunda chave para a mesma OS retornam 409. Backups atuais preservam os recibos; backups antigos sem a tabela continuam aceitos.

O ZenControl só conclui a OS após validar o recibo. Sua central aprova o retorno enviado pelo técnico. Este adaptador não altera os fluxos existentes de triagem, devolução ou estorno.
