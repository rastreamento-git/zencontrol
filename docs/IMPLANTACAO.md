# Implantação e banco de dados

## Banco novo

Crie um banco PostgreSQL dedicado ao ZenControl, com usuário próprio e credenciais no ambiente do serviço. Não use a URL do banco do Estoque Pro. O repositório contém as migrações, não as credenciais de uma instância provisionada na nuvem.

`npm run setup` gera `.env` com senha inicial, sessão, webhook, chave do estoque e credenciais locais. Para desenvolvimento, `docker compose up -d db` cria o PostgreSQL local e seu volume. `npm run migrate` aplica os arquivos versionados de `apps/api/migrations` em uma transação. Repetir o comando não duplica o schema.

## Variáveis essenciais

| Variável | Valor / finalidade |
| --- | --- |
| `DATABASE_URL` | Banco exclusivo do ZenControl |
| `DATABASE_SSL` | `verify-full` em banco remoto; `disable` somente local/rede privada apropriada |
| `DATABASE_CA` | CA do provedor, quando necessária |
| `APP_ADMIN_USER`, `APP_PASSWORD` | Inicialização da primeira conta administrativa |
| `SESSION_SECRET`, `ZEN_WEBHOOK_SECRET` | Segredos individuais, pelo menos 32 caracteres |
| `ZEN_DATA_DIR` | Diretório persistente para fotos/backups |
| `ZEN_PUBLIC_URL`, `CORS_ORIGINS` | URL pública HTTPS e origens exatas autorizadas |
| `STOCK_API_URL` | Backend do Estoque Pro, sem `/api` no final |
| `STOCK_API_SECRET` | Igual a `ZENCONTROL_INTEGRATION_SECRET` no Estoque Pro |
| `STOCK_SOURCE_SYSTEM` | Origem permanente, exclusiva desta base/ambiente |
| `STOCK_ENABLED` | `true` depois de configurar e publicar o adaptador |
| `ZEN_RUN_WORKER` | `true` para executar fila junto da API; não iniciar outro worker nesse modo |

A senha de bootstrap não substitui senhas de contas existentes. Não crie variáveis `VITE_*` com segredos: são incorporadas ao navegador. Domínios usados por técnicos precisam de HTTPS para acesso à câmera.

## Render

`render.yaml` prepara API e frontend no mesmo serviço com disco persistente e worker no mesmo processo. Preencha os campos privados e a URL pública; o arquivo mantém deploy automático desligado. Use uma instância com disco e `ZEN_RUN_WORKER=true`. Migrações do ZenControl rodam em `preDeployCommand`; aplicação e worker usam o mesmo diretório de mídia. Não execute um segundo worker que não compartilhe o disco.

O banco remoto deve ser criado/configurado na hospedagem antes do primeiro deploy. O adaptador do Estoque Pro precisa ser implantado em seu próprio serviço com a migração aditiva e o segredo de integração. Apenas copiar a URL do estoque não instala o adaptador.

## Docker

`docker compose up --build -d` sobe banco, API e worker separado. API e worker compartilham o volume de fotos e o mesmo banco; a API deixa a fila interna desligada. Se o Estoque Pro também roda no computador host, use um endereço alcançável pelo container e HTTPS ou configure a rede privada de desenvolvimento de forma explícita; `127.0.0.1` dentro do container aponta para o próprio container.

A imagem não contém `.env`, fotos nem dados reais. Para desenvolver sem Docker, inicie o banco local, aplique migrações e use API e frontend do README.

## Entrada em operação

1. Publicar o adaptador no Estoque Pro e verificar `/healthz`.
2. Criar o banco novo do ZenControl, configurar segredos, migrar e publicar.
3. Criar técnicos e vincular os cadastros do estoque por seleção explícita.
4. Criar contas de técnico e associá-las aos cadastros do ZenControl.
5. Ajustar fotos obrigatórias em Configurações.
6. Testar um equipamento de teste na carga correta: envio, aprovação, recibo, saldo e histórico.
7. Conferir permissões em um celular real, incluindo câmera, foco e legibilidade das etiquetas.

O CI verifica software e SQL em ambiente isolado; não ativa a integração em produção. A verificação de câmera física e a homologação no banco real dependem do ambiente de implantação.

## Continuidade

Use **Baixar backup** para exportar dados operacionais, fotos e verificação SHA-256. Teste a restauração em banco vazio com `npm run restore -- --source <pasta-extraida>`; o primeiro modo é de simulação. Contas e segredos são preservados fora do backup operacional; recrie os vínculos dos técnicos após restaurar. Consulte o script antes de aplicar `--apply`.

O reset/purge é uma ferramenta administrativa opcional e não participa da instalação. Não foi executado em nenhum banco do usuário nesta entrega. Backups anteriores e arquivos SQLite históricos permanecem fora do repositório.
