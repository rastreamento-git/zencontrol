# Fase 1 — diagnóstico e critérios de aceite

Data: 12/11/2026. Base de código: `19d2efc` da branch `feat/ecossistema-homologacao`.

## Objetivo do próximo ciclo

Concluir a primeira versão operacional antes de ampliar módulos. O roadmap executivo v1.4 mantém a Fase 1 aberta; testes locais não substituem aceite da operação no ambiente publicado.

## Evidências verificadas

- Suíte completa `npm test`: 160 testes de API e 35 do adaptador de estoque passaram (195, nenhuma falha).
- Roteiro `scripts/homologation-ui.cjs`: passou com ativação, tela móvel de 390 px, solicitação de estoque, aprovação de valores, fotos/scanner/checklist, conferência central, recibo de estoque e pagamentos simulados. Sem rolagem horizontal ou erros JavaScript. Execução com dados sintéticos locais, sem transações financeiras reais.

- 14 testes de `ecosystem.test.js` e `media-store.test.js` passaram. Cobrem isolamento entre técnicos, permissões, regras financeiras, pagamentos, backup/restauração e contrato de armazenamento.
- O provedor de armazenamento remoto é simulado nesses testes. Isso não comprova bucket real, credenciais nem sobrevivência a reinício do serviço publicado.
- `/healthz` de `https://zencontrol-homolog.onrender.com` respondeu `status: ok`, `version: 6.4.0`, `media_storage: local`, `chat_directory_version: 1`, `chat_photo_version: 1` em 12/11/2026.
- `scripts/homologation.cjs` cria bancos próprios e fornece `ZEN_DATA_DIR` ao aplicativo. Não encaminha a configuração do provedor remoto ao `createApp`. Não usar esse inicializador como evidência de persistência de produção.
- Existe implementação de armazenamento privado em `apps/api/src/media-store.js`; não é necessário reescrevê-la para iniciar a validação de persistência.

## Pendências para aceite

| Prioridade | Entrega | Evidência necessária |
| --- | --- | --- |
| P0 | Ambiente persistente de homologação | Confirmar serviço, banco e armazenamento escolhidos; registrar versões e configuração sem segredos. |
| P0 | Anexos duráveis | Enviar foto de OS e chat, reiniciar o backend de teste, acessar e baixar como usuário autorizado; negar acesso de outro técnico. |
| P0 | Recuperação | Restaurar banco e arquivos em ambiente isolado e comparar documentos e vínculos; preservar cópias existentes. |
| P0 | Ciclo OS e estoque | Agendar, atribuir, executar no ZenField, enviar evidências, conferir no ZenControl e obter comprovante de estoque. Repetir confirmação sem gerar segunda movimentação. |
| P0 | Login integrado | Validar administrador, operador e técnico, incluindo entrada/retorno pelo Estoque Pro e bloqueios no servidor. |
| P1 | Piloto operacional | Definir participantes, executar roteiro, registrar defeitos e colher aceite por fluxo. |

## Ordem de execução

1. Consolidar os resultados automatizados e reproduzir falhas do roteiro de navegador.
2. Preparar configuração de ambiente persistente com os recursos existentes; não substituir banco ou alterar serviço publicado sem identificar o destino e preservar dados.
3. Executar persistência e recuperação com arquivos sintéticos.
4. Homologar ciclo de OS e integração com estoque no ambiente escolhido.
5. Registrar aceite do setor antes de declarar a Fase 1 encerrada.

Nenhum custo, contratação, migração de produção ou aceite operacional foi aprovado por este diagnóstico. Novos módulos não entram neste ciclo.
