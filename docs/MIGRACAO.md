# Migração de dados

Use um banco PostgreSQL dedicado e novo. Primeiro execute o setup e as migrações; em seguida, simule a importação e confira o relatório. Mantenha API antiga e worker parados durante a importação definitiva, para evitar que a origem receba novas alterações após o snapshot.

## Formatos aceitos

| Origem | Conteúdo importado |
| --- | --- |
| `db_hot.sqlite`, `db_warm.sqlite`, `db_cold.sqlite` | Ordens e classificação HOT/WARM/COLD, preservando as 24 posições de origem em `raw_legacy` |
| `db_tecnicos.sqlite` | Técnicos ativos, telefones, destinos e preços |
| `db_config.sqlite` | Configurações históricas de técnicos, voluntários, adicionais e histórico financeiro |
| Versão 4.0: `zencontrol.sqlite` e `media/` | Tabelas operacionais, IDs, vínculos, auditoria e fotos |

As contas antigas não são importadas. O modelo de autenticação agora é o mesmo do inventário; crie os usuários na nova instalação.

```bash
npm run import:legacy -- --source "/pasta/dos/bancos"
npm run import:legacy -- --source "/pasta/dos/bancos" --apply
```

O modo padrão simula e executa rollback. O importador lê cópias consistentes dos SQLite, sem alterar os originais. Os snapshots permanecem em `data/backups/legacy-*`. A confirmação ocorre em uma única transação no PostgreSQL.

## Preservação e conferência

- O conteúdo JSON original fica preservado integralmente, inclusive posições reservadas. Campos operacionais de datas e veículos são normalizados quando reconhecidos.
- Situações reconhecidas são mapeadas para o fluxo atual. Situações antigas que não representam um estado operacional, como `Manhã`, `Tarde` ou `INADIMPLENTE`, recebem `PENDENTE` e conservam o valor em `legacy_status`. `Manhã` e `Tarde` também preenchem turno quando necessário.
- Datas de criação não reconhecidas recebem a data da importação no campo operacional; o valor original continua em `raw_legacy`. Agendamentos antigos não reconhecidos permanecem com o texto de origem para correção.
- Técnicos encontrados apenas em configurações/histórico ficam inativos; técnicos do cadastro operacional ficam ativos. Variações de nomes com acentos e caixa seguem a equivalência ASCII do SQLite antigo, preservando seus IDs e vínculos.
- Adicionais com uma OS identificada são vinculados à ordem. Histórico financeiro e adicionais sem OS correspondente ficam em `zc_legacy_finance` para conferência; não são transformados em novos pagamentos.
- IDs repetidos com conteúdo diferente são preservados em ordens separadas, com sufixo indicando arquivo e hash. Uma mesma origem já importada é reconhecida pelo fingerprint e não é duplicada.
- Na migração da versão 4.0, o destino operacional deve estar vazio. Isso evita colisões de IDs entre técnicos, ordens e fechamentos. As contas atuais do destino são mantidas.
- Fotos ausentes na origem 4.0 geram avisos. Preserve a pasta original e corrija as referências antes de descartar a instalação antiga.
- Jobs herdados da 4.0 que possam ter produzido um efeito externo ficam para conferência; downloads podem ser retomados. Confira a fila antes de habilitar integrações.

## Conferência de uma importação opcional

O projeto inicia uma base nova e não exige importação para funcionar. Se for necessário migrar um sistema anterior, simule em ambiente privado, compare o relatório com a origem e valide vínculos, situações, datas e preços antes de aplicar. O importador não faz parte do fluxo de implantação padrão.

As verificações automáticas do importador usam exclusivamente fixtures fictícias. Bancos, fotos, relatórios operacionais e credenciais devem permanecer fora do repositório.
