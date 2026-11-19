## 6.4.0 — Homologação do ecossistema (16/10/2026)

Ativação individual de técnicos, notificações internas, etapas de execução/conferência, ZenField 1.1 com estoque/financeiro/solicitações, tarifas versionadas, políticas de fechamento e pagamentos externos auditados. Inclui inicializador local isolado, dados fictícios, testes A–J, backup integral e bloqueio de deploy desta branch. Planilhas e homologação online permanecem dependentes de acesso/cotas. Ver HOMOLOGACAO.md e RELATORIO-HOMOLOGACAO.md.

# 6.3.0

- ZenField em repositório e aplicativo separados, com endereço, login, sessão e build próprios; a central continua exclusiva dos operadores/admins.
- Publicação independente do ZenField como Static Site, comunicação CORS com a API do ZenControl e endereço próprio nos PDFs.
- OS completa na tela e controles grandes para fotografar ou anexar arquivos.
- Leitura no servidor de códigos de barras, QR Code e DataMatrix, identificando TAG/rastreador pela carga no Estoque Pro, sem digitar IMEI.
- Recusa de etiquetas ilegíveis, códigos fora da carga e fotos ambíguas, com orientações para correção.
- Vistoria e checklist assinado obrigatórios nos novos registros; PDF privado ou fotos, com backup e restauração.
- Conferência explícita do checklist pela central antes da aprovação. Financeiro liberado apenas após a conclusão, mantendo a confirmação do estoque nas instalações.
- Preservação das regras para envios anteriores à atualização.

# 6.1.0

- OS baseada no gerador independente: dados do associado, veículo, atendimento e observações em tabelas, com fontes incorporadas e paginação.
- Serviço, data/horário e técnico preenchidos a partir da OS salva; botão Salvar e gerar PDF.
- Campos complementares persistidos, equipamentos previstos e orientação para o técnico levar os equipamentos.
- Consulta SGA por ID, placa ou chassi, com complementação por ID e voluntário e preservação do agendamento no formulário.
- Documento padrão com identificação parcialmente oculta; versão integral restrita à administração; download protegido da OS atribuída no portal técnico.
- Migração aditiva 003, preservação dos dados complementares em backup e testes de documento, permissões e consulta SGA.
