# ZenField — Integração com o ZenControl 6.3

O Portal do Técnico é um **aplicativo web separado**, com página inicial, login, build e hospedagem próprios (repositório próprio ZenField). O técnico abre somente seu endereço no navegador do celular. A central continua em `apps/web`, no endereço do ZenControl.

Os dois aplicativos se comunicam com a mesma API autenticada. Banco Aiven, fotos privadas no Supabase, leitura das etiquetas, aprovação e financeiro permanecem sob responsabilidade do backend ZenControl. Não é necessário criar outro banco nem outro backend para o portal. O código e as publicações ficam em repositórios independentes.

## Operação em campo

1. Entrar com a conta individual criada pela central.
2. Abrir o serviço atribuído e conferir a OS completa: associado, veículo, endereço, serviço, agendamento, técnico e instruções. O PDF continua disponível; documentos pessoais permanecem protegidos.
3. Tocar em **Começar registro** e enviar as fotos exigidas para o serviço e as fotos da vistoria. Há botões separados para tirar uma foto e escolher uma foto já existente no celular.
4. Nas instalações/reinstalações, fotografar a etiqueta de **cada** rastreador/TAG. O servidor lê códigos de barras, QR Code e DataMatrix, consulta a carga do técnico no Estoque Pro e salva automaticamente o serial, o tipo e o modelo. Não é necessário escanear ao vivo, digitar IMEI ou classificar o aparelho.
5. Anexar o próprio checklist preenchido e assinado, em PDF ou fotos de todas as páginas. Confirmar que o documento está assinado.
6. Conferir o quadro **Falta completar**, revisar os arquivos e enviar. O retorno é **Confirmação pendente**.
7. A central abre as evidências em **Validações**, verifica as fotos e o checklist, confirma a assinatura e aprova ou solicita correção com um motivo claro.
8. O serviço aprovado entra no fechamento financeiro após ficar **CONCLUÍDO**. Nas instalações, essa conclusão também exige o recibo real do Estoque Pro. O portal não registra pagamento automático.

## Regras da identificação

- O código precisa estar visível e legível na foto; uma foto sem etiqueta/código legível será recusada com orientações para fotografar novamente.
- O tipo do aparelho vem do cadastro correspondente no estoque, não de uma estimativa pela aparência. O cadastro deve ter categoria `RASTREADOR` ou `TAG`.
- A foto pode ter códigos auxiliares (por exemplo, SIM/ICCID); só é aceito o serial correspondente à carga do técnico. Fotos com mais de um equipamento correspondente são recusadas: envie uma foto por equipamento.
- Aceita códigos simples e payloads QR comuns com `imei`, `serial`, `codigo_serial` ou `sn`, em JSON, parâmetros de URL ou texto identificado. O servidor nunca visita URLs lidas nas etiquetas.
- Se a OS especificar rastreador, rastreador extra e/ou TAG, as quantidades por tipo precisam estar presentes. O mesmo equipamento fotografado duas vezes não satisfaz dois aparelhos.
- A central continua conferindo a correspondência entre etiqueta, aparelho, veículo e serviço. A leitura automática identifica o código; não comprova a execução física da instalação.
- Não há uso de API paga de IA/OCR. O decodificador e seu arquivo WASM são fornecidos com o backend, sem CDN.

## Checklist e fotos

- Novos registros exigem pelo menos uma foto de vistoria e um checklist, além das evidências configuradas por serviço. A central pode aumentar as fotos da vistoria em **Configurações → Evidências**.
- Checklist: PDF sem senha, até 8 MB e 30 páginas, ou fotos JPEG/PNG/WebP. O PDF original é preservado, inclusive para conferência de assinatura digital pelo operador quando aplicável. A aplicação não valida assinatura digital nem detecta assinatura manuscrita automaticamente.
- Fotos: escolha arquivos de até 24 MB no celular; a interface converte para JPEG com lado máximo de 2400 px. O servidor valida e normaliza a imagem antes de armazenar.
- Limite total de 30 arquivos por registro. Arquivos ficam no bucket privado configurado e integram o backup/restauração operacional.
- Cada arquivo fica salvo após a resposta de sucesso. **Salvar e continuar depois** preserva o relato e as confirmações do rascunho. Se a rede falhar, o portal atualiza o estado e oferece nova tentativa. Uma foto ainda não recebida não fica disponível offline.
- Outro técnico não consegue baixar as fotos ou o checklist de uma OS que não lhe foi atribuída.
- PDFs são baixados como anexos e não são enviados como imagens à integração de fotos do SGA.
- Envios feitos antes desta atualização continuam disponíveis para conferência pelas regras anteriores. Novos rascunhos usam as novas exigências.

## Repositório independente: ZenField

O ZenField tem repositório próprio, dependências locais e build independente do ZenControl. O código do frontend não fica no repositório da central. A integração continua pela API autenticada: o banco, as fotos privadas, a leitura das etiquetas, a aprovação e o financeiro pertencem ao backend ZenControl.

### Backend ZenControl

No Web Service existente, mantenha `npm ci --include=dev && npm run build` como build e `npm run migrate && npm start` como início. Configure o endereço real do ZenField:

```dotenv
TECHNICIAN_PORTAL_URL=https://ENDERECO-REAL-DO-ZENFIELD.onrender.com
```

A variável autoriza a origem na API, atualiza os links dos PDFs e redireciona o caminho antigo `/tecnico`. Preserve os demais valores de `CORS_ORIGINS`. As chaves Supabase, o banco Aiven e a integração Estoque Pro continuam somente no backend.

### Frontend ZenField

No repositório independente `zenfield`, crie um Static Site no Render com:

| Campo             | Valor                                                   |
| ----------------- | ------------------------------------------------------- |
| Root Directory    | Vazio                                                   |
| Build Command     | `npm ci --include=dev && npm run build`                 |
| Publish Directory | `dist`                                                  |
| `NODE_VERSION`    | `24`                                                    |
| `VITE_API_URL`    | `https://zencontrol.onrender.com` (URL real do backend) |

Adicione a regra Rewrite `/*` → `/index.html`. O nome do site pode ser `zenfield` ou outro disponível; use o endereço efetivamente gerado pelo Render em `TECHNICIAN_PORTAL_URL`.

O frontend tem apenas uma configuração pública de API. Não recebe banco ou segredos. Mudanças na URL exigem reconstruir/publicar o frontend. O README do repositório ZenField contém o procedimento completo.

### Habilitação da operação

1. Manter `MEDIA_STORAGE=supabase` e o bucket privado existente. Caso o bucket restrinja MIME, permitir `application/pdf` e `image/jpeg`.
2. Confirmar a integração do Estoque Pro: `STOCK_ENABLED=true`, `STOCK_API_URL` e `STOCK_API_SECRET`. O técnico deve estar vinculado e os aparelhos, na carga correta.
3. Usar `ZEN_RUN_WORKER=true` para processar instalações após aprovação. A fila fica no PostgreSQL e processa enquanto a API está ativa.
4. Criar/vincular as contas em **Equipe técnica** e **Equipe e acessos** e definir os valores dos serviços.
5. Testar o fluxo entre o endereço do ZenField e o da central, conferindo a conclusão e a inclusão no financeiro.

A suíte do ZenControl usa PostgreSQL/PGlite e Supabase simulado. A homologação no Render/Supabase reais continua necessária antes do uso em produção.
