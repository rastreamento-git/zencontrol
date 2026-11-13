# Repositórios do ecossistema ZenTracking

As descrições abaixo identificam a finalidade de cada projeto e podem ser usadas no campo **Sobre → Descrição** do GitHub. Esse campo é uma configuração do GitHub e não é atualizado automaticamente pelo README ou pelo `package.json`.

| Repositório | Descrição em português |
| --- | --- |
| `zencontrol` | Central do ecossistema ZenTracking para agendamentos, ordens de serviço, conferência técnica e gestão financeira. |
| `zenfield` | Portal do técnico no ZenTracking para serviços em campo, evidências, equipamentos e acompanhamento financeiro. |
| `inventario-v2` | Estoque Pro: gestão de rastreadores e TAGs, cargas técnicas, movimentações e rastreabilidade por IMEI ou serial. |
| `invent-front` | Interface original do inventário de rastreadores e TAGs. A evolução atual do Estoque Pro está em inventario-v2. |
| `invent-back` | API original do inventário de equipamentos de rastreamento. A evolução atual do Estoque Pro está em inventario-v2. |

## Organização atual

O ZenTracking é a entrada única. O ZenControl concentra a operação e a conferência, o ZenField atende à execução técnica e o Estoque Pro controla os equipamentos.

Os três projetos atuais possuem uma branch `feat/ecossistema-homologacao` para o ecossistema integrado. A branch `main` de cada projeto pode conter uma versão anterior. Correções nessa homologação devem ser comparadas com a base correspondente antes de serem promovidas.

`invent-front` e `invent-back` preservam a estrutura original. A documentação aponta para o código atual sem arquivar, excluir ou modificar instalações antigas.

## Verificação do frontend

Com os três repositórios atuais lado a lado e as dependências instaladas, execute no ZenControl:

```bash
npm run homologation:build
npx playwright install chromium
npm run test:frontend
```

A verificação inicia uma instância local com dados fictícios e cobre isolamento da seleção do financeiro, erros e filtros do ZenField, pesquisa global do Estoque Pro e menu móvel da central.
