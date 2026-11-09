# Meu perfil, Google e conversas no ZenTracking

O ZenTracking reúne atalhos para agenda, conferência e conversas, além dos três aplicativos. Use **Meu perfil** para editar nome de exibição e telefone. O cadastro de acesso continua definindo login e papel. No Estoque Pro integrado, o atalho de perfil abre a mesma conta no ZenTracking.

## Habilitar o acesso Google

1. Na [área de credenciais do Google Cloud](https://console.cloud.google.com/apis/credentials), configure a tela de consentimento e crie um cliente OAuth do tipo **Aplicativo da Web**.
2. Em **Origens JavaScript autorizadas**, informe as origens exatas do ZenTracking e do ZenField, sem caminho. Para homologação local, inclua `http://127.0.0.1:4320` e `http://127.0.0.1:4319`. Em um projeto Google em teste, inclua as contas de teste permitidas.
3. No ambiente da **API ZenControl**, configure `GOOGLE_CLIENT_ID` com o ID desse cliente. O acesso único precisa ter `SSO_LOGIN_URL`, `TECHNICIAN_PORTAL_URL`, `SSO_STOCK_URL` e a integração de identidade configurados.
4. Entre com a conta ZenTracking, abra **Meu perfil**, confirme sua senha atual e selecione **Vincular Google**. Depois, **Continuar com o Google** na entrada ZenTracking abre o aplicativo de acordo com o papel já cadastrado.

O fluxo usa Google Identity Services e valida a credencial assinada na API. Não precisa de segredo Google nem de URI de redirecionamento. Uma conta Google não cadastrada não cria usuário nem recebe permissões. A sessão emitida é a do ZenTracking; não são guardados tokens do Google. Sem o ID configurado, o acesso por usuário e senha segue disponível. O modo `online-demo` não habilita vínculo com contas Google reais.

## Conversas

No ZenControl, abra **Conversas** e selecione o técnico. No ZenField, use **Chat com a central**. Cada técnico lê apenas sua conversa. A central responde com o nome da conta que fez o envio. O histórico fica no PostgreSQL do ZenControl e tem páginas de 50 mensagens. O navegador recebe atualizações quando a conversa está aberta e sincroniza o histórico se a conexão cair.

O backup operacional inclui as mensagens e preserva o nome e o papel de quem escreveu; na restauração, os identificadores das contas antigas são desvinculados. O backup operacional continua sem incluir credenciais, vínculos Google ou dados privados do perfil.

## Aplicar e validar

A migração `012_perfil_google_conversas.sql` adiciona as tabelas do recurso. Aplique primeiro em um banco de homologação do ZenControl, separado do banco do Estoque Pro. Depois, publique a API e os frontends correspondentes. O login Google real exige o cliente e as origens configurados acima.

Os testes de API usam dados fictícios e simulam a confirmação de identidade do Google para verificar vínculo, reaproveitamento de credencial, edição de perfil, privacidade das conversas e entrega pelo canal em tempo real:

```bash
node --test apps/api/test/portal-engagement.test.js
npm run homologation:build
npx playwright install chromium
npm run test:portal
```
