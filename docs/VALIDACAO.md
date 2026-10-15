# Validação da entrega 6.0.0

Em 15/10/2026, a suíte local passou com 57 testes do ZenControl e 31 do backend Estoque Pro (88 no total), usando SQL PostgreSQL em PGlite, duas bases isoladas na integração e apenas dados fictícios. Uma verificação adicional cobriu a reatribuição de OS com rascunho aberto: o novo responsável consegue iniciar seu próprio envio e o anterior perde o acesso. Nenhum banco de produção foi conectado ou alterado.

`npm run check`, instalação `npm ci --include=dev --ignore-scripts --dry-run` e build de produção do frontend passaram. O GitHub Actions foi configurado para repetir análise, testes e build contra PostgreSQL 17 de serviço, além do fluxo específico do backend no repositório do inventário. Consulte o resultado do CI do commit antes da implantação.

O fluxo real de navegador em Chromium 153 foi executado em 390 × 844 e 1440 × 1000 pixels, com o frontend compilado, API Express, worker e adaptador de estoque locais:

- Login de técnico abre o portal, lista apenas serviços atribuídos e permite iniciar registro.
- Três fotos são selecionadas pelo controle de captura/arquivo, reprocessadas no servidor e exibidas por rotas autenticadas.
- Uma etiqueta QR de teste é decodificada pelo worker ZXing/WASM carregado localmente com a política CSP ativa; IMEI detectado é vinculado à foto da etiqueta.
- Salvar rascunho e recarregar mantém fotos, serial associado e relato.
- Envio do técnico aguarda a central; aprovação pela central aciona o worker, recebe o recibo do adaptador e conclui a OS.
- Equipe técnica, contas, configurações e tema escuro foram conferidos, sem transbordamento horizontal e sem erros JavaScript.

Os testes também verificam recusa de carga incorreta sem alteração parcial, reenvio após resposta perdida com uma só instalação, idempotência concorrente, fotos obrigatórias, isolamento de técnico, bloqueio de versões antigas, financeiro apenas após conclusão, múltiplos modelos no lote e preservação dos recibos em backup/restauração.

Câmera física, qualidade das fotos e permissões em diferentes telefones precisam ser homologadas nos aparelhos usados pela equipe. A seleção de fotos e a decodificação real foram testadas; esta validação não simula uma instalação real no veículo nem ativa a hospedagem.
