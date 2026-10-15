# Integração ZenControl ↔ Estoque Pro

O adaptador reside no backend do Estoque Pro e é protegido por `ZENCONTROL_INTEGRATION_SECRET`. O ZenControl envia esse valor como Bearer por HTTPS usando `STOCK_API_SECRET`. Não são usados tokens de operadores nem credenciais do banco do inventário.

`integrations/estoque-pro` parte de `rastreamento-git/inventario-v2/invent-back`, commit de origem `a5eca405e8ea93fda535730d0e78b591c5b289c8`. A implantação definitiva do adaptador é feita nesse repositório de inventário. Esta cópia permite testar os dois sistemas em conjunto e revisar o contrato. O schema do estoque permanece separado.

## Endpoints

Prefixo: `/api/integrations/zencontrol`.

| Método / caminho | Uso |
| --- | --- |
| `GET /catalog` | Técnicos ativos e modelos; utilizado pela administração para vincular cadastros |
| `GET /technicians/:id/items` | Seriais disponíveis na carga do técnico; o portal recebe apenas seu próprio vínculo via proxy autenticado |
| `POST /installations` | Confirma a instalação com transação e recibo idempotente |

Cabeçalho obrigatório da instalação: `Idempotency-Key`, 12–160 caracteres. O ZenControl usa `stock:<origem>:<id do envio>`. O identificador de origem deve permanecer estável por base e ser único entre ambientes que compartilham o mesmo estoque.

```json
{
  "source_system": "zencontrol",
  "order_id": "OS-EXEMPLO1234",
  "submission_id": "uuid-do-envio",
  "technician_id": 1,
  "serials": ["001234567890123"],
  "operator": "Pessoa que conferiu na central"
}
```

O recibo contém `success`, `receipt_id`, `idempotency_key`, `source_system`, `order_id`, `submission_id`, `technician_id`, `serials`, `status: "INSTALADO"` e `confirmed_at`. O cliente confere esses campos antes de concluir a OS.

A mesma chave e mesmos dados devolvem o mesmo recibo. Chave reutilizada com dados diferentes ou outra chave para a mesma OS/origem retorna 409. O registro da chave, a movimentação e o recibo são confirmados na mesma transação. Duas chamadas simultâneas esperam pela mesma identidade persistida.

Migração `003_zencontrol.sql`: adiciona `zencontrol_installations`, com unicidade por chave e por origem/OS. O backend reutiliza `moveWithin(..., 'instalar', ...)` para registrar `USO_FINAL`, atualizar os seriais e recalcular a carga. Backups atuais passam a conter os recibos e a restauração aceita também os backups anteriores sem essa tabela.

## Recuperação

- Rede, timeout, respostas ambíguas, 429/5xx e bloqueio transitório do banco: a tarefa fica pendente e repete a mesma chave, com intervalo crescente limitado a 15 minutos.
- Erro de cadastro/carga ou outra recusa definitiva: envio `stock_failed`, erro visível na fila, OS não concluída.
- Corrigir cadastro/carga mantendo a evidência: administrador pode repetir a tarefa pela fila; a mesma chave e os dados aprovados são mantidos.
- Corrigir código/evidência: central solicita correção, técnico envia novo registro. A tentativa antiga não pode ser reativada após o envio ser substituído.
- Não exclua recibos para tentar repetir instalações. Não altere `STOCK_SOURCE_SYSTEM` após começar a operar.

Teste de resposta perdida: Estoque Pro confirma o primeiro POST; o cliente simula queda antes de receber a resposta; o worker repete a chave, obtém o mesmo recibo e conclui a OS com exatamente um `USO_FINAL`.
