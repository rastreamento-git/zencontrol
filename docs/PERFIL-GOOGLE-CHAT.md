# Meu perfil, Google e conversas no ZenTracking

O ZenTracking reúne atalhos para agenda, conferência e conversas, além dos três aplicativos. Use **Meu perfil** para editar nome de exibição, telefone e foto. O cadastro de acesso define login e papel. No Estoque Pro integrado, o atalho de perfil abre a mesma conta no ZenTracking.

## Habilitar o acesso Google

1. Na [área de credenciais do Google Cloud](https://console.cloud.google.com/apis/credentials), configure a tela de consentimento e crie um cliente OAuth do tipo **Aplicativo da Web**.
2. Em **Origens JavaScript autorizadas**, informe as origens exatas do ZenTracking e do ZenField, sem caminho. Para homologação local, inclua `http://127.0.0.1:4320` e `http://127.0.0.1:4319`. Em um projeto Google em teste, inclua as contas de teste permitidas.
3. No ambiente da **API ZenControl**, configure `GOOGLE_CLIENT_ID` com o ID desse cliente. O acesso único precisa ter `SSO_LOGIN_URL`, `TECHNICIAN_PORTAL_URL`, `SSO_STOCK_URL` e a integração de identidade configurados.
4. Entre com a conta ZenTracking, abra **Meu perfil**, confirme sua senha atual e selecione **Vincular Google**. Depois, **Continuar com o Google** na entrada ZenTracking abre o aplicativo de acordo com o papel já cadastrado.

O fluxo usa Google Identity Services e valida a credencial assinada na API. Não precisa de segredo Google nem de URI de redirecionamento. Uma conta Google não cadastrada não cria usuário nem recebe permissões. A sessão emitida é a do ZenTracking; não são guardados tokens do Google. Sem o ID configurado, o acesso por usuário e senha segue disponível. O modo `online-demo` não habilita vínculo com contas Google reais.

## Primeiro acesso e recuperação

Em **Equipe e acessos**, cadastre o e-mail de recuperação da conta. Ao criar um técnico ou gerar nova senha temporária, entregue os dados por um canal verificado. A senha vence em 24 horas e permite apenas abrir a etapa de troca. Para contas ainda pendentes da ativação antiga, gere uma nova senha temporária ou use a recuperação com o e-mail cadastrado.

Configure `RESEND_API_KEY` e `PASSWORD_RESET_FROM` na API do ZenControl. Use um remetente de domínio verificado e mantenha o rastreamento de cliques desativado para esses e-mails. O endereço confiável do ZenTracking vem de `SSO_LOGIN_URL` ou, quando a API serve a interface, de `ZEN_PUBLIC_URL`. [Configuração de domínio no Resend](https://resend.com/docs/dashboard/domains/introduction)

Em **Esqueci minha senha**, o link segue para o e-mail da conta, vale por 30 minutos e só pode ser usado uma vez. A troca invalida as sessões anteriores. A demonstração precisa de um e-mail cadastrado e de remetente configurado para fazer um envio real.

## Conversas

No ZenControl, abra **Conversas → Caixa da operação** para ver os técnicos cadastrados e sua presença. Técnicos ativos que ainda precisam liberar o acesso aparecem como Offline, com a indicação **Sem acesso ao chat**. No ZenField, o técnico usa **Chat com a central**. Cada mensagem entra na conversa desse técnico na caixa compartilhada e gera um aviso no sino de operadores e administradores, com leitura por conta. O aviso abre a conversa. Na resposta, o técnico vê o nome, a função e a foto de quem respondeu. Contas sem foto aparecem com iniciais.

Use **Conversas → Equipe interna → Sala da operação** para conversar com os demais operadores e administradores. A lista da sala mostra os colaboradores e seu status. O histórico da sala e as conversas de cada técnico ficam separados no PostgreSQL do ZenControl.

Use **Técnicos** na janela do chat para abrir a lista e iniciar uma mensagem mesmo com uma conversa aberta. O técnico recebe o aviso no sino do ZenField e pode abrir a conversa por ele.

Em **Meu status**, selecione **Online**, **Ausente** ou **Ocupado**. Em Online, a presença passa para Ausente quando a aba fica oculta ou após cinco minutos sem interação. A lista mostra Offline cerca de dois minutos após o último sinal do aplicativo. Os avisos ficam no sino até a leitura, inclusive para quem entrar depois.

O backup operacional inclui as mensagens e preserva o nome e o papel de quem escreveu; na restauração, os identificadores das contas antigas são desvinculados. O backup operacional continua sem incluir credenciais, vínculos Google ou dados privados do perfil.

## Aplicar e validar

Aplique as migrações pendentes, incluindo `014_primeiro_acesso_recuperacao.sql`, em um banco de homologação do ZenControl, separado do banco do Estoque Pro. Publique primeiro a API e depois os frontends do ZenControl e ZenField. Valide o primeiro acesso, a recuperação e os avisos no sino com contas de técnico, operador e administrador.

Os testes de API usam dados fictícios e simulam a confirmação de identidade do Google para verificar vínculo, reaproveitamento de credencial, edição de perfil, privacidade das conversas e entrega pelo canal em tempo real:

```bash
node --test apps/api/test/portal-engagement.test.js
npm run homologation:build
npx playwright install chromium
npm run test:portal
```
