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

No ZenControl, abra **Conversas → Técnicos** para ver os cadastros ativos, pesquisar por nome ou empresa e iniciar uma conversa. Um cadastro sem conta habilitada aparece como **Offline** com a indicação **Sem acesso ao chat**. Se a conta está habilitada e a troca de senha está pendente, a central já pode enviar mensagens para o técnico ler quando concluir o primeiro acesso.

Em **Conversas → Equipe interna**, a sala abre junto da lista de colaboradores ativos. Recolha a lista no mini chat se precisar de mais espaço para ler a conversa. O histórico da sala e as conversas com cada técnico ficam separados no PostgreSQL do ZenControl.

No ZenField, o técnico usa **Chat com a central**. Cada mensagem chega à caixa compartilhada de operadores e administradores. O sino avisa a equipe e abre a conversa. A resposta mostra o nome, a função e o avatar de quem escreveu. Contas sem foto aparecem com iniciais.

Em **Meu status**, selecione **Online**, **Ausente** ou **Ocupado**. Em Online, a presença passa para Ausente quando a aba fica oculta ou após cinco minutos sem interação. A lista mostra Offline cerca de dois minutos após o último sinal do aplicativo. Os avisos ficam no sino até a leitura, inclusive para quem entrar depois.

Use **Anexar** para escolher fotos JPEG, PNG ou WebP e **Câmera** para fotografar. Cada mensagem aceita até quatro fotos com legenda opcional. Confira a prévia e remova as fotos que quiser antes de enviar. Clique em uma foto no histórico para ampliar.

As fotos usam o armazenamento privado do ZenControl. O servidor verifica a permissão da conversa antes de devolver cada imagem. O backup operacional inclui mensagens e fotos. Ao restaurar, o histórico conserva o nome e o papel de quem escreveu e desvincula os identificadores das contas antigas. Credenciais, vínculos com Google e dados privados do perfil pertencem à base de contas de destino.

## Aplicar e validar

Aplique as migrações pendentes até `015_fotos_chat.sql` e publique primeiro a API do ZenControl. No endereço configurado em `VITE_API_URL`, abra `/healthz` na raiz do serviço e confirme `"chat_directory_version": 1` e `"chat_photo_version": 1`. Em seguida, publique os frontends do ZenControl e do ZenField apontando para essa API. Valide os avisos do sino e o envio de fotos com contas de técnico, operador e administrador.

Os testes de API usam dados fictícios e simulam a confirmação de identidade do Google para verificar vínculo, reaproveitamento de credencial, edição de perfil, privacidade das conversas e entrega pelo canal em tempo real:

```bash
node --test apps/api/test/portal-engagement.test.js
npm run homologation:build
npx playwright install chromium
npm run test:portal
```
