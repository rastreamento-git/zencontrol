# Implantação e banco de dados

## Banco novo

Crie um banco PostgreSQL dedicado ao ZenControl, com usuário próprio e credenciais no ambiente do serviço. Não use a URL do banco do Estoque Pro. O repositório contém as migrações, não as credenciais de uma instância provisionada na nuvem.

`npm run setup` gera `.env` com senha inicial, sessão, webhook, chave do estoque e credenciais locais. Para desenvolvimento, `docker compose up -d db` cria o PostgreSQL local e seu volume. `npm run migrate` aplica os arquivos versionados de `apps/api/migrations` em uma transação. Repetir o comando não duplica o schema.

## Variáveis essenciais

| Variável                               | Valor / finalidade                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | Banco exclusivo do ZenControl                                                       |
| `DATABASE_SSL`                         | `verify-full` em banco remoto; `disable` somente local/rede privada apropriada      |
| `DATABASE_CA`                          | CA do provedor, quando necessária                                                   |
| `DATABASE_POOL_MAX`                    | Máximo de conexões do processo; padrão `3`, adequado ao Aiven Free compartilhado    |
| `APP_ADMIN_USER`, `APP_PASSWORD`       | Inicialização da primeira conta administrativa                                      |
| `SESSION_SECRET`, `ZEN_WEBHOOK_SECRET` | Segredos individuais, pelo menos 32 caracteres                                      |
| `ZEN_DATA_DIR`                         | Diretório de trabalho; precisa ser persistente somente quando `MEDIA_STORAGE=local` |
| `MEDIA_STORAGE`                        | `local` para disco persistente ou `supabase` para bucket privado                    |
| `SUPABASE_URL`                         | Project URL HTTPS, como `https://SEU-PROJETO.supabase.co`                           |
| `SUPABASE_SECRET_KEY`                  | Chave de servidor `sb_secret_...`, somente no ambiente privado do backend           |
| `SUPABASE_STORAGE_BUCKET`              | Nome do bucket privado, por exemplo `zencontrol-evidencias`                         |
| `ZEN_PUBLIC_URL`, `CORS_ORIGINS`       | URL pública HTTPS e origens exatas autorizadas                                      |
| `STOCK_API_URL`                        | Backend do Estoque Pro, sem `/api` no final                                         |
| `STOCK_API_SECRET`                     | Igual a `ZENCONTROL_INTEGRATION_SECRET` no Estoque Pro                              |
| `STOCK_SOURCE_SYSTEM`                  | Origem permanente, exclusiva desta base/ambiente                                    |
| `STOCK_ENABLED`                        | `true` depois de configurar e publicar o adaptador                                  |
| `ZEN_RUN_WORKER`                       | `true` para executar fila junto da API; não iniciar outro worker nesse modo         |

A senha de bootstrap não substitui senhas de contas existentes. Não crie variáveis `VITE_*` com segredos: são incorporadas ao navegador. Domínios usados por técnicos precisam de HTTPS para acesso à câmera.

## Render

`render.yaml` prepara API e frontend em um Web Service Free, com Supabase privado para fotos e worker no mesmo processo. Build: `npm ci --include=dev && npm run build`. Start: `npm run migrate && npm start`. Root Directory vazio, runtime Node 24, health check `/healthz`. Não configure disco nem pre-deploy no Free. O deploy automático começa desligado.

No Supabase Free, crie um projeto e um bucket `zencontrol-evidencias`, com Public bucket desativado. Configure `MEDIA_STORAGE=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `SUPABASE_STORAGE_BUCKET` no Render. A inicialização verifica a existência, credenciais e privacidade do bucket; uma configuração inválida impede o início. A chave fica no servidor e as imagens passam pelas rotas autenticadas existentes. Não crie políticas públicas de leitura/escrita para este fluxo.

Para o primeiro teste, mantenha `STOCK_ENABLED=false`, `INTEGRATIONS_ENABLED=false`, `AUTO_CLOSE_ENABLED=false` e `SGA_SYNC_ENABLED=false`. Depois de publicar e validar o adaptador do estoque, ative `STOCK_ENABLED=true` e `ZEN_RUN_WORKER=true`. No Render Free, a fila executa apenas enquanto o serviço está ativo. As tarefas são persistidas no Aiven e retomadas quando o servidor volta; não há promessa de processamento contínuo. Uma instalação só é concluída após o recibo do Estoque Pro.

O Render Free adormece depois de 15 minutos sem tráfego e compartilha 750 horas mensais entre os Web Services do workspace. Não guarde fotos no disco efêmero. A cota Free consultada do Supabase inclui 1 GB de arquivos e o projeto pode ser pausado por inatividade. O Aiven Free tem 1 GB total e até 20 conexões compartilhadas: o banco `zencontrol` pode ser criado dentro do serviço já usado pelo estoque; dados, usuários e tabelas da aplicação continuam no Aiven. Cada processo adicional consome seu próprio pool.

Fontes: [Render Free](https://render.com/docs/free), [Supabase](https://supabase.com/pricing), [Aiven Free](https://aiven.io/docs/products/postgresql/concepts/pg-free-tier).

Se já houver fotos no disco local, exporte o backup completo antes de qualquer redeploy e planeje sua transferência para o bucket. Alterar `MEDIA_STORAGE` não migra arquivos antigos automaticamente. A restauração completa aceita o Supabase como destino e exige uma base operacional vazia; não a execute sobre uma base em uso. Em instalação nova, valide com fotos fictícias: envie uma imagem, confira a leitura pela central e pelo técnico responsável, faça um redeploy e confirme que a imagem continua acessível. `/healthz` deve informar `media_storage: "supabase"`.

Para uma instalação paga com disco persistente, use `MEDIA_STORAGE=local` e aponte `ZEN_DATA_DIR` para o ponto de montagem. API e worker separado precisam compartilhar o mesmo diretório; não inicie um segundo worker sem acesso às fotos.

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

No Supabase, o backup baixa também as fotos originais e editadas para uma pasta temporária e a remove ao concluir. Falha na obtenção de uma foto impede um backup incompleto. Arquivos sem referência no banco (por exemplo, um upload concluído antes de uma transação recusada) não são apagados automaticamente; não esvazie o bucket para liberar espaço sem conferir referências e exportar backup. O comando de purge recusa a execução com mídia remota, antes de alterar tabelas, até que a limpeza coordenada do banco e do bucket seja planejada.

O reset/purge é uma ferramenta administrativa opcional e não participa da instalação. Não foi executado em nenhum banco do usuário nesta entrega. Backups anteriores e arquivos SQLite históricos permanecem fora do repositório.

## Portal separado

O ZenField é publicado como Static Site a partir de seu próprio repositório, com `npm run build` e diretório `dist`. A central/API permanece no Web Service existente. Veja [o passo a passo de publicação e comunicação entre os endereços](PORTAL_TECNICO.md#publicação-separada-no-render).
