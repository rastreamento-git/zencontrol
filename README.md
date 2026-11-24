# ZenControl · Central de rastreamento

Central do ecossistema **ZenTracking** para agendar atendimentos, gerenciar ordens de serviço, conferir a execução dos técnicos e acompanhar fechamentos e pagamentos.

Esta revisão parte da branch `feat/ecossistema-homologacao`, versão 6.4. O ambiente de homologação usa dados fictícios. A implantação de produção tem roteiro próprio em [Implantação](docs/IMPLANTACAO.md).

## Aplicações e acesso

| Aplicação                                                        | Responsabilidade                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| ZenTracking                                                      | Entrada única. Administradores e operadores escolhem as aplicações por cards. Técnicos seguem diretamente ao ZenField. |
| ZenControl                                                       | Agenda, OS, conferência, equipe, bloqueios operacionais e financeiro.                                                  |
| [ZenField](https://github.com/rastreamento-git/zenfield)         | Execução em campo, fotos, checklist, carga e demonstrativo do técnico.                                                 |
| [Estoque Pro](https://github.com/rastreamento-git/inventario-v2) | Equipamentos, IMEIs/seriais, cargas, movimentações e rastreabilidade.                                                  |

As contas são individuais. A supervisão no ZenField preserva a identidade real do operador na auditoria. A senha exige no mínimo oito caracteres, com maiúscula, minúscula, número e símbolo.

## Fluxo da ordem de serviço

1. A central cadastra cliente, veículo, endereço, contato, agendamento, técnico e quantidade de equipamentos.
2. O técnico registra etiquetas, checklist assinado, data executada e observações no ZenField. Fotos gerais são opcionais, sem mínimo obrigatório.
3. A central confere as evidências e confirma a execução ou solicita correção. Os códigos já identificados são consultados sem uma nova leitura de IMEI.
4. Nas instalações, o Estoque Pro valida a carga e confirma os equipamentos. O recibo válido permite concluir a OS.
5. O serviço concluído torna-se elegível para o fechamento financeiro, conforme as regras do técnico.

Uma OS pode reunir vários equipamentos em um único atendimento e PDF com a marca ZEN Seguros. Cada equipamento extra tem contabilização interna vinculada. Reinstalações podem reaproveitar equipamentos sem consumir novamente a carga. A dispensa de rastreador autorizada exclui a OS da remuneração do técnico.

O cadastro aplica faixas FIPE por tipo de veículo e região, identifica veículo elétrico, separa os campos de endereço e formata o telefone. Há instalação, manutenção e retirada, com tratamento de visita improdutiva e reagendamento.

## Financeiro e serviços operacionais

- Tarifas com vigência, pedidos de reajuste, contraproposta e aceite.
- Ciclos de fechamento por técnico, prévia, aprovação e composição preservada.
- Taxa de deslocamento definida pela operação, uma vez por atendimento.
- Despesa extra vinculada à OS principal, com valor, descrição, foto do comprovante e decisão da central. Somente a aprovação gera reembolso.
- Registro de pagamentos externos parciais ou integrais, saldo e comprovantes. O sistema registra os pagamentos realizados fora da aplicação.
- Bloqueios operacionais com protocolo, situação e histórico, sem atribuição ao técnico. A integração automática com a API da Rede Veículo depende da documentação e de implementação específica.

## Estrutura

| Diretório                  | Conteúdo                                                       |
| -------------------------- | -------------------------------------------------------------- |
| `apps/web`                 | Interface React/Vite da central e entrada ZenTracking          |
| `apps/api`                 | API Express, autorização, documentos, financeiro e integrações |
| `packages/ui`              | Componentes, tema, sessão e utilitários da central             |
| `packages/domain`          | Regras compartilhadas de cadastro e classificação              |
| `integrations/estoque-pro` | Adaptador de referência e testes de compatibilidade            |
| `scripts`                  | Inicialização, homologação, backup e verificações              |
| `docs`                     | Operação, implantação e contratos de integração                |

O ZenControl e o Estoque Pro mantêm bancos próprios. A integração acontece por API autenticada entre servidores. Segredos de banco, mídia e integração ficam no backend.

## Desenvolvimento e homologação

Requer Node.js 24. Para testar o ecossistema, mantenha `zencontrol`, `zenfield` e `inventario-v2` lado a lado, com as dependências instaladas conforme [HOMOLOGACAO.md](HOMOLOGACAO.md).

```bash
npm ci --include=dev
npm run homologation:build
npm run homologation
```

Para uma instalação com PostgreSQL servidor, consulte [Implantação](docs/IMPLANTACAO.md). As migrações e os arquivos de exemplo não importam dados reais automaticamente.

## Verificação

```bash
npm run check
npm test
npm run build
npm run test:frontend
```

`test:frontend` inicia uma instância local isolada e verifica trocas de técnico, filtros, tratamento de erros e navegação móvel. Exige os três repositórios compilados e Chromium do Playwright (`npx playwright install chromium`). Nunca utiliza banco ou credenciais de produção.

## Documentação

- [Mapa dos repositórios e descrições em português](docs/REPOSITORIOS.md)
- [Entrada única e perfis](docs/ZENTRACKING.md)
- [Meu perfil, login Google e conversas](docs/PERFIL-GOOGLE-CHAT.md)
- [Portal do técnico](docs/PORTAL_TECNICO.md)
- [Ordem de serviço e PDF](docs/ORDEM_DE_SERVICO.md)
- [Integração com o Estoque Pro](docs/INTEGRACAO_ESTOQUE_PRO.md)
- [Regras de negócio](docs/REGRAS_DE_NEGOCIO.md)

Desenvolvido por Victor Rodrigues.
